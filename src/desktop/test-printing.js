// Sample-only print jobs. An attempt is persisted before handing anything to
// Windows; a missing result after interruption is deliberately uncertain.
const { hasPermissions } = require('./permissions');
const validId = n => Number.isSafeInteger(n) && n > 0;
const token = s => typeof s === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(s);
const destination = s => ['kitchen', 'bar', 'bill'].includes(s);
const inFlight = new Set();

function createPreparationJob(db, ticketId) {
  const ticket = db.prepare(`SELECT t.destination, r.table_id AS tableId, r.number AS round FROM preparation_tickets t JOIN preparation_rounds r ON r.id=t.round_id WHERE t.id=?`).get(ticketId);
  const lines = db.prepare(`SELECT i.id, i.name, i.note, ti.quantity FROM preparation_ticket_items ti JOIN order_items i ON i.id=ti.item_id WHERE ti.ticket_id=? ORDER BY i.id`).all(ticketId);
  for (const line of lines) line.modifiers = db.prepare('SELECT group_name AS groupName, option_name AS optionName FROM order_item_modifiers WHERE item_id=? ORDER BY rowid').all(line.id);
  return db.prepare('INSERT INTO test_print_jobs(destination,ticket_id,snapshot,created_at) VALUES(?,?,?,?)').run(ticket.destination, ticketId, JSON.stringify({ ...ticket, lines }), Date.now()).lastInsertRowid;
}

function createBillJob(db, billId) {
  const bill = db.prepare(`SELECT b.id, b.total, o.table_id AS tableId FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=?`).get(billId);
  if (!bill) throw Error('Bill unavailable');
  bill.lines = db.prepare('SELECT name, unit_price AS unitPrice, quantity, modifiers FROM bill_lines WHERE bill_id=? ORDER BY id').all(billId).map(l => ({ ...l, modifiers: JSON.parse(l.modifiers) }));
  return db.prepare("INSERT INTO test_print_jobs(destination,bill_id,snapshot,created_at) VALUES('bill',?,?,?)").run(billId, JSON.stringify(bill), Date.now()).lastInsertRowid;
}

function canPrintBill(db, session, billId) {
  const bill = db.prepare(`SELECT o.status, p.id AS paymentId, COALESCE(c.account,p.account) AS account FROM bills b JOIN orders o ON o.id=b.order_id LEFT JOIN payments p ON p.bill_id=b.id LEFT JOIN (SELECT payment_id,'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE b.id=?`).get(billId);
  if (!bill) return false;
  if (!bill.paymentId && bill.status === 'open' && hasPermissions(db,session,'orders.view','orders.change')) return true;
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
  const queue = db.prepare('SELECT queue FROM test_printer_queues WHERE destination=?').get(job.destination).queue;
  const attemptId = db.prepare('INSERT INTO test_print_attempts(job_id,request_id,actor_id,queue,started_at) VALUES(?,?,?,?,?)').run(jobId, requestId, actorId, queue, Date.now()).lastInsertRowid;
  return { attemptId, queue, destination: job.destination, snapshot: JSON.parse(job.snapshot) };
}

function dispatch(db, adapter, attempt) {
  if (!attempt) return;
  inFlight.add(attempt.attemptId);
  Promise.resolve().then(() => adapter(attempt)).then(result => {
    db.prepare('INSERT INTO test_print_results(attempt_id,result,occurred_at) VALUES(?,?,?)').run(attempt.attemptId, result === 'accepted' ? 'accepted' : 'failed', Date.now());
  }).catch(() => { /* unknown: leave the durable attempt without a result */ }).finally(() => inFlight.delete(attempt.attemptId));
}

function registerTestPrinting(ipcMain, isAllowedSender, db, session, adapter, enabled) {
  ipcMain.handle('arra:test-printing', (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype) return { ok:false };
    if (!enabled) return {ok:false,disabled:true};
    const shape = { list:['action'], configure:['action','destination','queue'], bill:['action','billId','requestId'], retry:['action','jobId','requestId','checked'] };
    if (!Object.hasOwn(shape,req.action) || Reflect.ownKeys(req).length !== shape[req.action].length || !shape[req.action].every(k=>Object.hasOwn(req,k)) ||
      (req.action === 'configure' && (!destination(req.destination) || typeof req.queue !== 'string' || req.queue !== req.queue.trim() || !req.queue || req.queue.length > 255 || /[\x00-\x1f\x7f]/.test(req.queue))) ||
      (req.action === 'bill' && (!validId(req.billId) || !token(req.requestId))) ||
      (req.action === 'retry' && (!validId(req.jobId) || !token(req.requestId) || req.checked !== true))) return {ok:false};
    const operational = hasPermissions(db,session,'orders.view','orders.change');
    const financial = session.currentUserId() && session.authenticatedUserId() === session.currentUserId() && hasPermissions(db,session,'employees.view') && ['A','B','combined'].includes(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(session.currentUserId())?.scope);
    if (req.action === 'configure' && !(hasPermissions(db,session,'orders.view','employees.change') || (financial && hasPermissions(db,session,'employees.change')))) return {ok:false};
    if (req.action === 'list' && !operational && !financial) return {ok:false};
    if (['bill','retry'].includes(req.action) && !operational && !financial) return {ok:false};
    try {
      let attempt;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (req.action === 'configure') db.prepare('UPDATE test_printer_queues SET queue=? WHERE destination=?').run(req.queue,req.destination);
        if (req.action === 'bill') {
          if (!canPrintBill(db,session,req.billId)) throw Error('Bill unavailable');
          let job = db.prepare('SELECT id FROM test_print_jobs WHERE bill_id=?').get(req.billId);
          if (!job) job = { id:createBillJob(db,req.billId) };
          // An existing job can only be retried with explicit paper check.
          const requestId = 'bill-' + req.requestId;
          const prior = db.prepare('SELECT job_id FROM test_print_attempts WHERE request_id=?').get(requestId);
          if (!prior && db.prepare('SELECT 1 FROM test_print_attempts WHERE job_id=?').get(job.id)) throw Error('Use retry');
          attempt = reserveAttempt(db,job.id,requestId,session.currentUserId());
        }
        if (req.action === 'retry') {
          const job = db.prepare(`SELECT j.bill_id AS billId, (SELECT max(id) FROM test_print_attempts WHERE job_id=j.id) AS lastAttempt FROM test_print_jobs j WHERE j.id=?`).get(req.jobId);
          if (!job || inFlight.has(job.lastAttempt) || (job.billId ? !canPrintBill(db,session,job.billId) : !operational)) throw Error('Job unavailable');
          attempt = reserveAttempt(db,req.jobId,'retry-' + req.requestId,session.currentUserId());
        }
        const queues = db.prepare('SELECT destination,queue FROM test_printer_queues ORDER BY destination').all();
        const jobs = db.prepare(`SELECT j.id,j.destination,j.ticket_id AS ticketId,j.bill_id AS billId,pr.table_id AS tableId,pr.number AS round,a.queue,a.started_at AS startedAt,COALESCE(r.result,'uncertain') AS result,(SELECT count(*) FROM test_print_attempts WHERE job_id=j.id) AS attempts FROM test_print_jobs j JOIN test_print_attempts a ON a.id=(SELECT MAX(id) FROM test_print_attempts WHERE job_id=j.id) LEFT JOIN test_print_results r ON r.attempt_id=a.id LEFT JOIN preparation_tickets pt ON pt.id=j.ticket_id LEFT JOIN preparation_rounds pr ON pr.id=pt.round_id ORDER BY j.id DESC`).all().filter(j=>j.billId ? canPrintBill(db,session,j.billId) : operational);
        db.exec('COMMIT');
        dispatch(db,adapter,attempt);
        return {ok:true,data:{queues,jobs}};
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } catch (_) { return {ok:false,error:'Test printing unavailable. Check the job before retrying.'}; }
  });
}
module.exports = {createPreparationJob,createBillJob,reserveAttempt,dispatch,registerTestPrinting};
