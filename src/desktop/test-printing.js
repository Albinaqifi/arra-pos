// An attempt is persisted before dispatch. A missing result after interruption
// is deliberately uncertain.
const { hasPermissions } = require('./permissions');
const { ownsOrder, canRecoverLegacyPrint } = require('./order-ownership');
const validId = n => Number.isSafeInteger(n) && n > 0;
const token = s => typeof s === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(s);
const destination = s => ['kitchen', 'kitchen2', 'bar', 'bill', 'bill-A', 'bill-B'].includes(s);
const preparationDestination = s => ['kitchen', 'kitchen2', 'bar'].includes(s);
const inFlight = new Set();

function createPreparationJob(db, ticketId, preparationMode) {
  const ticket = db.prepare(`SELECT t.destination, r.table_id AS tableId, r.number AS round, r.sent_at AS sentAt, u.username AS waiterName FROM preparation_tickets t JOIN preparation_rounds r ON r.id=t.round_id JOIN local_users u ON u.id=r.actor_id WHERE t.id=?`).get(ticketId);
  const sentAt = new Date(ticket.sentAt);
  ticket.sentTime = String(sentAt.getHours()).padStart(2, '0') + ':' + String(sentAt.getMinutes()).padStart(2, '0');
  const lines = db.prepare(`SELECT i.id, i.name, i.note, ti.quantity FROM preparation_ticket_items ti JOIN order_items i ON i.id=ti.item_id WHERE ti.ticket_id=? ORDER BY i.id`).all(ticketId);
  for (const line of lines) line.modifiers = db.prepare('SELECT group_name AS groupName, option_name AS optionName FROM order_item_modifiers WHERE item_id=? ORDER BY rowid').all(line.id);
  return db.prepare('INSERT INTO test_print_jobs(destination,ticket_id,snapshot,created_at) VALUES(?,?,?,?)').run(ticket.destination, ticketId, JSON.stringify({ ...ticket, lines, preparationMode }), Date.now()).lastInsertRowid;
}

// Capture the adapter as well as the destination from the original send.
// Older Windows sample tickets have a queue job without a mode. A ticket
// with only a legacy simulated job never went to Windows.
function originalTicket(db, itemId) {
  return db.prepare(`SELECT t.destination, r.table_id AS tableId, r.number AS round, i.name, i.note,
    CASE WHEN j.id IS NOT NULL THEN COALESCE(json_extract(j.snapshot,'$.preparationMode'),'sample')
         WHEN legacy.id IS NOT NULL THEN 'training' ELSE 'unresolved' END AS preparationMode
    FROM preparation_ticket_items ti JOIN preparation_tickets t ON t.id=ti.ticket_id
    JOIN preparation_rounds r ON r.id=t.round_id JOIN order_items i ON i.id=ti.item_id
    LEFT JOIN test_print_jobs j ON j.ticket_id=t.id LEFT JOIN print_jobs legacy ON legacy.ticket_id=t.id
    WHERE ti.item_id=?`).get(itemId);
}
function createCancellationJob(db, correctionId, itemId, quantity) {
  const source = originalTicket(db,itemId);
  if (!source) throw Error('Original preparation ticket unavailable');
  const modifiers = db.prepare('SELECT group_name AS groupName, option_name AS optionName FROM order_item_modifiers WHERE item_id=? ORDER BY rowid').all(itemId);
  const snapshot = { tableId:source.tableId, round:source.round, lines:[{name:source.name,note:source.note,quantity,modifiers}], cancellation:true, preparationMode:source.preparationMode };
  return db.prepare('INSERT INTO cancellation_notice_jobs(correction_id,destination,snapshot,created_at) VALUES(?,?,?,?)').run(correctionId,source.destination,JSON.stringify(snapshot),Date.now()).lastInsertRowid;
}
function noticeMode(db, noticeId, snapshot) {
  if (snapshot.preparationMode) return snapshot.preparationMode;
  // Before S-098, cancellation notices did not store the adapter. Read the
  // original ticket. Any older Windows attempt on a simulator-only original
  // leaves conflicting evidence; keep that notice for manual follow-up.
  const correction = db.prepare(`SELECT c.item_id FROM cancellation_notice_jobs j
    JOIN sent_item_corrections c ON c.id=j.correction_id WHERE j.id=?`).get(noticeId);
  const mode = originalTicket(db,correction.item_id)?.preparationMode || 'unresolved';
  if (mode === 'training' && db.prepare(`SELECT 1 FROM cancellation_notice_attempts
    WHERE job_id=? AND request_id NOT GLOB 'training-retry-*'`).get(noticeId)) return 'unresolved';
  return mode;
}
function canDispatchNotice(mode, preparationMode) {
  return mode !== 'unresolved' && (mode === 'training') === (preparationMode === 'training');
}
function initialCancellationOutput(db, correctionId, actor, printer, replay) {
  const notice = db.prepare('SELECT id,snapshot FROM cancellation_notice_jobs WHERE correction_id=?').get(correctionId);
  if (!notice) return {}; // Corrections from before cancellation printing.
  const mode = noticeMode(db,notice.id,JSON.parse(notice.snapshot));
  if (replay) {
    const attempted = db.prepare('SELECT 1 FROM cancellation_notice_attempts WHERE job_id=? LIMIT 1').get(notice.id);
    return attempted && mode !== 'unresolved' ? {} : {deferred:true};
  }
  if (!printer || !canDispatchNotice(mode,printer.preparationMode)) return {deferred:true};
  return {attempt:reserveCancellationAttempt(db,notice.id,'initial-' + notice.id,actor)};
}
function reserveCancellationAttempt(db, jobId, requestId, actorId) {
  const job=db.prepare('SELECT destination,snapshot FROM cancellation_notice_jobs WHERE id=?').get(jobId);
  if (!job) throw Error('Job unavailable');
  const snapshot=JSON.parse(job.snapshot);
  const mode=noticeMode(db,jobId,snapshot);
  if (mode === 'unresolved') throw Error('Notice output unavailable');
  const training=mode === 'training';
  if (training && !snapshot.preparationMode) requestId = 'training-' + requestId;
  const prior = db.prepare('SELECT job_id AS jobId FROM cancellation_notice_attempts WHERE request_id=?').get(requestId);
  if (prior) { if (prior.jobId !== jobId) throw Error('Invalid retry'); return null; }
  const queue=training ? job.destination : db.prepare('SELECT queue FROM test_printer_queues WHERE destination=?').get(job.destination).queue;
  const beep=training ? 0 : db.prepare('SELECT beep FROM cancellation_alert_settings WHERE destination=?').get(job.destination).beep;
  const attemptId=db.prepare('INSERT INTO cancellation_notice_attempts(job_id,request_id,actor_id,queue,beep,started_at) VALUES(?,?,?,?,?,?)').run(jobId,requestId,actorId,queue,beep,Date.now()).lastInsertRowid;
  return {attemptId,queue,destination:job.destination,snapshot,cancellation:true,beep:!!beep};
}
function dispatchCancellation(db,adapter,attempt) {
  if (!attempt) return;
  const key='c'+attempt.attemptId; inFlight.add(key);
  Promise.resolve().then(()=>attempt.queue ? adapter(attempt) : 'failed').then(result=>db.prepare('INSERT INTO cancellation_notice_results(attempt_id,result,occurred_at) VALUES(?,?,?)').run(attempt.attemptId,result === 'accepted' ? 'accepted' : 'failed',Date.now())).catch(()=>{}).finally(()=>inFlight.delete(key));
}

function createBillJob(db, billId, billPrinter) {
  const bill = db.prepare(`SELECT b.id, b.total, o.table_id AS tableId FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(billId);
  if (!bill) throw Error('Bill unavailable');
  if (billPrinter === 'bar') bill.billPrinter = 'bar';
  bill.lines = db.prepare('SELECT name, unit_price AS unitPrice, quantity, modifiers FROM bill_lines WHERE bill_id=? ORDER BY id').all(billId).map(l => ({ ...l, modifiers: JSON.parse(l.modifiers) }));
  return db.prepare("INSERT INTO test_print_jobs(destination,bill_id,snapshot,created_at) VALUES('bill',?,?,?)").run(billId, JSON.stringify(bill), Date.now()).lastInsertRowid;
}

function canPrintBill(db, session, billId, preparationMode) {
  const bill = db.prepare(`SELECT o.id AS orderId, o.status, p.id AS paymentId, p.method, COALESCE(c.account,p.account) AS account,
    json_extract(j.snapshot,'$.billPrinter') AS billPrinter FROM bills b JOIN orders o ON o.id=b.order_id
    LEFT JOIN test_print_jobs j ON j.bill_id=b.id LEFT JOIN payments p ON p.bill_id=b.id
    LEFT JOIN (SELECT payment_id,'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE b.id=?`).get(billId);
  if (!bill) return false;
  // Older unpaid, sample and fiscal jobs cannot be replayed on the Bar printer.
  // After a transfer to A, a B customer copy can no longer be requested.
  if (preparationMode || bill.billPrinter === 'bar') {
    if (preparationMode !== 'routine' || bill.billPrinter !== 'bar' || bill.method !== 'cash' || bill.account !== 'B') return false;
  }
  if (!bill.paymentId && bill.status === 'open' && hasPermissions(db,session,'orders.view','orders.change') && ownsOrder(db,session,bill.orderId)) return true;
  const id=session.currentUserId();
  if (!id || session.authenticatedUserId() !== id || !hasPermissions(db,session,'employees.view')) return false;
  const scope=db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(id)?.scope;
  return bill.paymentId ? (scope === 'combined' || scope === bill.account) : ['A','B','combined'].includes(scope);
}

function reserveAttempt(db, jobId, requestId, actorId) {
  const prior = db.prepare('SELECT id,job_id AS jobId FROM test_print_attempts WHERE request_id=?').get(requestId);
  if (prior) { if (prior.jobId !== jobId) throw Error('Invalid retry'); return null; }
  const job = db.prepare('SELECT destination,snapshot FROM test_print_jobs WHERE id=?').get(jobId);
  if (!job) throw Error('Job unavailable');
  const snapshot = JSON.parse(job.snapshot);
  const payment = job.destination === 'bill' ? db.prepare("SELECT COALESCE(c.account,p.account) AS account FROM payments p LEFT JOIN (SELECT payment_id,'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE p.bill_id=(SELECT bill_id FROM test_print_jobs WHERE id=?)").get(jobId) : null;
  let queue;
  if (snapshot.preparationMode === 'training') queue = job.destination;
  else if (job.destination === 'bill' && snapshot.billPrinter === 'bar')
    queue = db.prepare("SELECT queue FROM test_printer_queues WHERE destination='bar'").get()?.queue || '';
  else if (payment) queue = db.prepare('SELECT queue FROM bill_printer_queues WHERE account=?').get(payment.account).queue;
  else queue = db.prepare('SELECT queue FROM test_printer_queues WHERE destination=?').get(job.destination).queue;
  const attemptId = db.prepare('INSERT INTO test_print_attempts(job_id,request_id,actor_id,queue,started_at) VALUES(?,?,?,?,?)').run(jobId, requestId, actorId, queue, Date.now()).lastInsertRowid;
  return { attemptId, queue, destination: job.destination, snapshot };
}

function dispatch(db, adapter, attempt) {
  if (!attempt) return;
  inFlight.add(attempt.attemptId);
  Promise.resolve().then(() => attempt.queue ? adapter(attempt) : 'failed').then(result => {
    db.prepare('INSERT INTO test_print_results(attempt_id,result,occurred_at) VALUES(?,?,?)').run(attempt.attemptId, result === 'accepted' ? 'accepted' : 'failed', Date.now());
  }).catch(() => { /* unknown: leave the durable attempt without a result */ }).finally(() => inFlight.delete(attempt.attemptId));
}

function registerTestPrinting(ipcMain, isAllowedSender, db, session, adapter, enabled, billOnly = false, preparationMode) {
  const training = preparationMode === 'training';
  ipcMain.handle('arra:test-printing', (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype) return { ok:false };
    if (!enabled) return {ok:false,disabled:true};
    const shape = { list:['action'], configure:['action','destination','queue'], configureAlert:['action','destination','beep'], bill:['action','billId','requestId'], retry:['action','jobId','requestId','checked'], retryNotice:['action','jobId','requestId','checked'] };
    if (!Object.hasOwn(shape,req.action) || Reflect.ownKeys(req).length !== shape[req.action].length || !shape[req.action].every(k=>Object.hasOwn(req,k)) ||
      (req.action === 'configure' && (!destination(req.destination) || typeof req.queue !== 'string' || req.queue !== req.queue.trim() || !req.queue || req.queue.length > 255 || /[\x00-\x1f\x7f]/.test(req.queue))) ||
      (req.action === 'configureAlert' && (!['kitchen','kitchen2','bar'].includes(req.destination) || typeof req.beep !== 'boolean')) ||
      (req.action === 'bill' && (!validId(req.billId) || !token(req.requestId))) ||
      (['retry','retryNotice'].includes(req.action) && (!validId(req.jobId) || !token(req.requestId) || req.checked !== true))) return {ok:false};
    if (billOnly && (req.action === 'configureAlert' || req.action === 'retryNotice' || (req.action === 'configure' && !['bill-A','bill-B'].includes(req.destination)))) return {ok:false};
    if (preparationMode && (req.action === 'bill' || (req.action === 'configure' && !preparationDestination(req.destination)))) return {ok:false};
    if (training && ['configure','configureAlert'].includes(req.action)) return {ok:false};
    const operational = hasPermissions(db,session,'orders.view','orders.change');
    const financial = session.currentUserId() && session.authenticatedUserId() === session.currentUserId() && hasPermissions(db,session,'employees.view') && ['A','B','combined'].includes(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(session.currentUserId())?.scope);
    const correctionAdmin = session.currentUserId() && session.authenticatedUserId() === session.currentUserId() && db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(session.currentUserId())?.scope === 'combined' && !!db.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission='orders.correct_sent'").get(session.currentUserId());
    if (['configure','configureAlert'].includes(req.action) && !(hasPermissions(db,session,'orders.view','employees.change') || (financial && hasPermissions(db,session,'employees.change')))) return {ok:false};
    if (req.action === 'list' && !operational && !financial && !correctionAdmin) return {ok:false};
    if (['bill','retry'].includes(req.action) && !operational && !financial) return {ok:false};
    try {
      let attempt;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (req.action === 'configure') {
          if (req.destination === 'bill-A' || req.destination === 'bill-B') db.prepare('UPDATE bill_printer_queues SET queue=? WHERE account=?').run(req.queue,req.destination.slice(-1));
          else {
            const old=db.prepare('SELECT queue FROM test_printer_queues WHERE destination=?').get(req.destination);
            db.prepare('UPDATE test_printer_queues SET queue=? WHERE destination=?').run(req.queue,req.destination);
            if (old.queue !== req.queue) db.prepare('UPDATE cancellation_alert_settings SET beep=0 WHERE destination=?').run(req.destination);
          }
        }
        if (req.action === 'configureAlert') db.prepare('UPDATE cancellation_alert_settings SET beep=? WHERE destination=?').run(req.beep ? 1 : 0,req.destination);
        if (req.action === 'bill') {
          if (!canPrintBill(db,session,req.billId,preparationMode)) throw Error('Bill unavailable');
          let job = db.prepare('SELECT id FROM test_print_jobs WHERE bill_id=?').get(req.billId);
          if (!job) job = { id:createBillJob(db,req.billId) };
          // An existing job can only be retried with explicit paper check.
          const requestId = 'bill-' + req.requestId;
          const prior = db.prepare('SELECT job_id FROM test_print_attempts WHERE request_id=?').get(requestId);
          if (!prior && db.prepare('SELECT 1 FROM test_print_attempts WHERE job_id=?').get(job.id)) throw Error('Use retry');
          attempt = reserveAttempt(db,job.id,requestId,session.currentUserId());
        }
        if (req.action === 'retry') {
          const job = db.prepare(`SELECT j.bill_id AS billId, json_extract(j.snapshot,'$.preparationMode') AS mode, (SELECT pr.order_id FROM preparation_tickets pt JOIN preparation_rounds pr ON pr.id=pt.round_id WHERE pt.id=j.ticket_id) AS orderId, (SELECT pr.actor_id FROM preparation_tickets pt JOIN preparation_rounds pr ON pr.id=pt.round_id WHERE pt.id=j.ticket_id) AS roundActor, (EXISTS(SELECT 1 FROM preparation_tickets pt JOIN preparation_rounds pr ON pr.id=pt.round_id JOIN order_cancellations c ON c.order_id=pr.order_id WHERE pt.id=j.ticket_id) OR EXISTS(SELECT 1 FROM preparation_ticket_items ti JOIN sent_item_corrections c ON c.item_id=ti.item_id WHERE ti.ticket_id=j.ticket_id)) AS cancelled, (SELECT max(id) FROM test_print_attempts WHERE job_id=j.id) AS lastAttempt FROM test_print_jobs j WHERE j.id=?`).get(req.jobId);
          if (!job || (job.mode === 'training') !== training || (billOnly && !job.billId) || job.cancelled || inFlight.has(job.lastAttempt) || (job.billId ? !canPrintBill(db,session,job.billId,preparationMode) : !operational || !(ownsOrder(db,session,job.orderId) || canRecoverLegacyPrint(db,session,job.orderId,job.roundActor)))) throw Error('Job unavailable');
          attempt = reserveAttempt(db,req.jobId,'retry-' + req.requestId,session.currentUserId());
        }
        let noticeAttempt;
        if (req.action === 'retryNotice') {
          const job=db.prepare('SELECT j.id,j.snapshot,c.order_id AS orderId,c.actor_id AS correctionActor,(SELECT MAX(id) FROM cancellation_notice_attempts WHERE job_id=j.id) AS lastAttempt FROM cancellation_notice_jobs j JOIN sent_item_corrections c ON c.id=j.correction_id WHERE j.id=?').get(req.jobId);
          if (!(operational || correctionAdmin) || !job || !canDispatchNotice(noticeMode(db,job.id,JSON.parse(job.snapshot)),preparationMode) || (!correctionAdmin && !(ownsOrder(db,session,job.orderId) || canRecoverLegacyPrint(db,session,job.orderId,job.correctionActor))) || inFlight.has('c'+job.lastAttempt)) throw Error('Job unavailable');
          noticeAttempt=reserveCancellationAttempt(db,req.jobId,'retry-'+req.requestId,session.currentUserId());
        }
        const notices = !billOnly && (operational || correctionAdmin) ? db.prepare(`SELECT j.id,j.destination,j.snapshot,c.order_id AS orderId,c.actor_id AS correctionActor,a.queue,a.beep,COALESCE(r.result,CASE WHEN a.id IS NULL THEN 'unattempted' ELSE 'uncertain' END) AS result,(SELECT count(*) FROM cancellation_notice_attempts WHERE job_id=j.id) AS attempts FROM cancellation_notice_jobs j JOIN sent_item_corrections c ON c.id=j.correction_id LEFT JOIN cancellation_notice_attempts a ON a.id=(SELECT MAX(id) FROM cancellation_notice_attempts WHERE job_id=j.id) LEFT JOIN cancellation_notice_results r ON r.attempt_id=a.id ORDER BY j.id DESC`).all().filter(j=>correctionAdmin || ownsOrder(db,session,j.orderId) || canRecoverLegacyPrint(db,session,j.orderId,j.correctionActor)).map(({correctionActor,...j}) => {
          const snapshot = JSON.parse(j.snapshot);
          const mode = noticeMode(db,j.id,snapshot);
          return {...j,...snapshot,preparationMode:mode,retryBlocked:mode === 'unresolved'};
        }).filter(j=>j.retryBlocked || canDispatchNotice(j.preparationMode,preparationMode)) : [];
        const queues = db.prepare("SELECT q.destination,q.queue,s.beep FROM test_printer_queues q LEFT JOIN cancellation_alert_settings s ON s.destination=q.destination UNION ALL SELECT 'bill-' || account AS destination,queue,NULL AS beep FROM bill_printer_queues ORDER BY destination").all().filter(q => (!billOnly || ['bill-A','bill-B'].includes(q.destination)) && (!preparationMode || preparationDestination(q.destination)))
          .map(q => training ? {destination:q.destination, queue:q.destination, beep:0} : q);
        const jobs = db.prepare(`SELECT j.id,j.destination,json_extract(j.snapshot,'$.preparationMode') AS mode,json_extract(j.snapshot,'$.billPrinter') AS billPrinter,j.ticket_id AS ticketId,j.bill_id AS billId,pr.order_id AS orderId,pr.actor_id AS roundActor,pr.table_id AS tableId,pr.number AS round,(EXISTS(SELECT 1 FROM order_cancellations c WHERE c.order_id=pr.order_id) OR EXISTS(SELECT 1 FROM preparation_ticket_items ti JOIN sent_item_corrections c ON c.item_id=ti.item_id WHERE ti.ticket_id=j.ticket_id)) AS cancelled,COALESCE(a.queue,'') AS queue,a.started_at AS startedAt,COALESCE(r.result,CASE WHEN a.id IS NULL THEN 'unattempted' ELSE 'uncertain' END) AS result,(SELECT count(*) FROM test_print_attempts WHERE job_id=j.id) AS attempts FROM test_print_jobs j LEFT JOIN test_print_attempts a ON a.id=(SELECT MAX(id) FROM test_print_attempts WHERE job_id=j.id) LEFT JOIN test_print_results r ON r.attempt_id=a.id LEFT JOIN preparation_tickets pt ON pt.id=j.ticket_id LEFT JOIN preparation_rounds pr ON pr.id=pt.round_id ORDER BY j.id DESC`).all().filter(job => {
          if (job.billId) {
            if (preparationMode && (preparationMode !== 'routine' || !financial || job.billPrinter !== 'bar')) return false;
            return canPrintBill(db,session,job.billId,preparationMode);
          }
          return (job.mode === 'training') === training && !billOnly && operational &&
            (ownsOrder(db,session,job.orderId) || canRecoverLegacyPrint(db,session,job.orderId,job.roundActor));
        }).map(({roundActor,mode,billPrinter,...job}) => job);
        db.exec('COMMIT');
        dispatch(db,adapter,attempt);
        dispatchCancellation(db,adapter,noticeAttempt);
        const data = {queues,jobs,notices,preparationMode};
        if (preparationMode === 'routine') {
          data.barBills = jobs.filter(job => job.billId);
          data.jobs = jobs.filter(job => !job.billId);
        }
        return {ok:true,data};
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } catch (_) { return {ok:false,error:'Test printing unavailable. Check the job before retrying.'}; }
  });
}
module.exports = {createCancellationJob,initialCancellationOutput,reserveCancellationAttempt,dispatchCancellation,createPreparationJob,createBillJob,reserveAttempt,dispatch,registerTestPrinting};
