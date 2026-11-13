const { untouchedOrder } = require('./untouched-order');
const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:business-days';
function issues(db) {
  return {
    orders: db.prepare(`SELECT o.id, o.table_id AS tableId FROM orders o WHERE o.status='open' AND o.retired_empty = 0 AND NOT (${untouchedOrder('o')}) ORDER BY o.id`).all(),
    printJobs: db.prepare(`SELECT j.id, COALESCE(a.result, 'unattempted') AS result FROM print_jobs j
      LEFT JOIN print_attempts a ON a.id=(SELECT id FROM print_attempts WHERE job_id=j.id ORDER BY id DESC LIMIT 1)
      WHERE a.result IS NULL OR a.result != 'success' ORDER BY j.id`).all()
  };
}
function projectIssues(value, scope) {
  if (value === null || scope === 'combined') return value;
  return { orders: value.orders.map(() => ({})), printJobs: value.printJobs.map(job => ({ result: job.result })) };
}
const flights = new WeakMap();
function inFlight(db) { if (!flights.has(db)) flights.set(db,new Set()); return flights.get(db); }
function reserve(db, job, requestId, actor, scope) {
  const prior = db.prepare('SELECT job_id AS jobId, scope FROM day_print_attempts WHERE request_id=?').get(requestId);
  if (prior) { if (prior.jobId !== job.id || prior.scope !== scope) throw Error('Invalid request'); return null; }
  const queue = db.prepare('SELECT queue FROM day_print_settings WHERE id=1').get().queue;
  const attemptId = db.prepare('INSERT INTO day_print_attempts(job_id,request_id,actor_id,queue,started_at,scope) VALUES(?,?,?,?,?,?)').run(job.id,requestId,actor,queue,Date.now(),scope).lastInsertRowid;
  const snapshot = JSON.parse(job.snapshot);
  if (scope !== 'combined') { snapshot.records = snapshot.records.filter(row => row.account === scope); snapshot.total = snapshot.records.reduce((sum,row) => sum + row.amount, 0); }
  return { attemptId, queue, destination:'turnover', scope, snapshot };
}
function dispatch(db, adapter, attempt) {
  if (!attempt) return;
  inFlight(db).add(attempt.attemptId);
  Promise.resolve().then(() => adapter(attempt)).then(result => {
    db.prepare('INSERT INTO day_print_results VALUES(?,?,?)').run(attempt.attemptId,result === 'accepted' ? 'accepted' : 'failed',Date.now());
  }).catch(() => {}).finally(() => inFlight(db).delete(attempt.attemptId));
}
function registerBusinessDays(ipcMain, isAllowedSender, db, session, adapter = () => 'failed') {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype ||
      !((req.action === 'list' && Reflect.ownKeys(req).length === 1) ||
        (req.action === 'close' && Reflect.ownKeys(req).length === 2 && Number.isSafeInteger(req.dayId) && req.dayId > 0) ||
        (req.action === 'retry' && (Reflect.ownKeys(req).length === 4 || (Reflect.ownKeys(req).length === 5 && ['A','B','combined'].includes(req.scope))) && Number.isSafeInteger(req.dayId) && req.dayId > 0 && req.checked === true && typeof req.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(req.requestId)) ||
        (req.action === 'configure' && Reflect.ownKeys(req).length === 2 && typeof req.queue === 'string' && req.queue === req.queue.trim() && req.queue.length > 0 && req.queue.length <= 255 && !/[\x00-\x1f\x7f]/.test(req.queue)))) return { ok: false };
    try {
      const actor = session.currentUserId();
      const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope;
      if (!actor || actor !== session.authenticatedUserId() || !['A','B','combined'].includes(scope) ||
          !hasPermissions(db, session, scope === 'combined' ? 'business_days.close' : 'employees.view')) return { ok: false };
      if ((req.action === 'configure' || (req.action === 'retry' && Object.hasOwn(req, 'scope'))) && scope !== 'combined') return { ok: false };
      if (req.action === 'list') return { ok: true, data: {
        days: db.prepare(`SELECT d.id, d.opened_at AS openedAt, d.closed_at AS closedAt, d.closed_by AS closedBy, d.issues, j.id AS reportId, COALESCE(r.result, CASE WHEN a.id IS NOT NULL THEN 'uncertain' END) AS printResult, (SELECT count(*) FROM day_print_attempts WHERE job_id=j.id AND scope=?) AS printAttempts FROM business_days d LEFT JOIN day_print_jobs j ON j.day_id=d.id LEFT JOIN day_print_attempts a ON a.id=(SELECT max(id) FROM day_print_attempts WHERE job_id=j.id AND scope=?) LEFT JOIN day_print_results r ON r.attempt_id=a.id ORDER BY d.id DESC`).all(scope, scope).map(x => ({ ...x, issues: projectIssues(x.issues === null ? null : JSON.parse(x.issues), scope), otherPrints: scope === 'combined' && x.reportId ? ['A','B'].map(reportScope => { const status = db.prepare(`SELECT COUNT(*) AS printAttempts, COALESCE((SELECT COALESCE(r.result,'uncertain') FROM day_print_attempts a LEFT JOIN day_print_results r ON r.attempt_id=a.id WHERE a.job_id=? AND a.scope=? ORDER BY a.id DESC LIMIT 1),NULL) AS printResult FROM day_print_attempts WHERE job_id=? AND scope=?`).get(x.reportId,reportScope,x.reportId,reportScope); return {scope:reportScope,...status}; }).filter(status => status.printAttempts) : [] })),
        scope, issues: projectIssues(issues(db), scope), queue: db.prepare('SELECT queue FROM day_print_settings WHERE id=1').get().queue
      } };
      if (req.action === 'configure') {
        db.prepare('UPDATE day_print_settings SET queue=? WHERE id=1').run(req.queue);
        return {ok:true};
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        if (req.action === 'retry') {
          const job = db.prepare('SELECT id,snapshot FROM day_print_jobs WHERE day_id=?').get(req.dayId);
          if (!job) throw Error('Report unavailable');
          const last = db.prepare('SELECT max(id) AS id FROM day_print_attempts WHERE job_id=?').get(job.id).id;
          if (inFlight(db).has(last)) throw Error('Printing in progress');
          const attempt = reserve(db,job,'retry-'+req.requestId,actor,req.scope || scope);
          db.exec('COMMIT'); dispatch(db,adapter,attempt);
          return {ok:true};
        }
        const day = db.prepare('SELECT id,opened_at AS openedAt FROM business_days WHERE id=? AND closed_at IS NULL').get(req.dayId);
        if (!day) { db.exec('ROLLBACK'); return { ok: false }; }
        const outstanding = issues(db), now = Date.now();
        const records = db.prepare(`SELECT p.id AS paymentId,p.bill_id AS billId,p.paid_at AS paidAt,p.amount,p.method,o.table_id AS tableId,COALESCE(c.account,p.account) AS account FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id JOIN bills b ON b.id=p.bill_id JOIN orders o ON o.id=b.order_id LEFT JOIN (SELECT payment_id,'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE pd.business_day_id=? ORDER BY p.paid_at,p.id`).all(day.id);
        let total=0;
        for (const row of records) { total += row.amount; if (!Number.isSafeInteger(row.amount) || row.amount < 0 || !Number.isSafeInteger(total)) throw Error('Invalid report total'); }
        const snapshot=JSON.stringify({dayId:day.id,openedAt:day.openedAt,closedAt:now,records,total});
        const jobId=db.prepare('INSERT INTO day_print_jobs(day_id,snapshot,created_at) VALUES(?,?,?)').run(day.id,snapshot,now).lastInsertRowid;
        const attempt=reserve(db,{id:jobId,snapshot},'close-'+day.id,actor,scope);
        db.prepare('UPDATE business_days SET closed_at=?, closed_by=?, issues=? WHERE id=?').run(now, actor, JSON.stringify(outstanding), day.id);
        db.prepare('INSERT INTO business_days(opened_at) VALUES (?)').run(now);
        recordAudit(db, actor, 'close', 'business_day', day.id, null, {});
        db.exec('COMMIT');
        dispatch(db,adapter,attempt);
        return { ok: true, data: { dayId: day.id, closedAt: now, issues: projectIssues(outstanding, scope) } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { CHANNEL, registerBusinessDays };
