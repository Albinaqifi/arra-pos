const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:print-jobs';

function registerPrintJobs(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    const fields = { list: ['action'], simulate: ['action', 'destination', 'result'], retry: ['action', 'jobId', 'requestId'] };
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
        !Object.hasOwn(fields, request.action) || Reflect.ownKeys(request).length !== fields[request.action].length || !fields[request.action].every(k => Object.hasOwn(request, k)) ||
        (request.action === 'simulate' && (!['kitchen', 'bar'].includes(request.destination) || !['success', 'failed', 'uncertain'].includes(request.result))) ||
        (request.action === 'retry' && (!Number.isSafeInteger(request.jobId) || request.jobId <= 0 || typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.requestId)))) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, ...(request.action === 'list' ? ['orders.view'] : ['orders.view', 'orders.change']))) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (request.action === 'simulate') db.prepare('UPDATE simulated_printers SET result = ? WHERE destination = ?').run(request.result, request.destination);
        if (request.action === 'retry') {
          const job = db.prepare(`SELECT j.id, r.order_id AS orderId, t.destination, a.result FROM print_jobs j JOIN preparation_tickets t ON t.id=j.ticket_id JOIN preparation_rounds r ON r.id=t.round_id JOIN print_attempts a ON a.id=(SELECT MAX(id) FROM print_attempts WHERE job_id=j.id) WHERE j.id=?`).get(request.jobId);
          const token = 'retry-' + request.requestId;
          const prior = db.prepare('SELECT job_id FROM print_attempts WHERE request_id=?').get(token);
          if (!job || (prior && prior.job_id !== job.id) || (!prior && job.result === 'success')) throw Error('Invalid retry');
          if (!prior) {
            const result = db.prepare('SELECT result FROM simulated_printers WHERE destination=?').get(job.destination).result;
            const attemptId = db.prepare('INSERT INTO print_attempts (job_id, request_id, actor_id, occurred_at, result) VALUES (?, ?, ?, ?, ?)').run(job.id, token, session.currentUserId(), Date.now(), result).lastInsertRowid;
            recordAudit(db, session.currentUserId(), 'print_retry', 'print_attempt', attemptId, job.orderId, { jobId: job.id, result, adapter: 'simulated' });
          }
        }
        const jobs = db.prepare(`SELECT j.id, r.order_id AS orderId, r.table_id AS tableId, r.number AS round, t.destination, a.result, (SELECT count(*) FROM print_attempts WHERE job_id=j.id) AS attempts, EXISTS(SELECT 1 FROM print_attempts WHERE job_id=j.id AND result='uncertain') AS hadUncertain FROM print_jobs j JOIN preparation_tickets t ON t.id=j.ticket_id JOIN preparation_rounds r ON r.id=t.round_id JOIN print_attempts a ON a.id=(SELECT MAX(id) FROM print_attempts WHERE job_id=j.id) ORDER BY j.id DESC`).all();
        const printers = db.prepare('SELECT destination, result FROM simulated_printers ORDER BY destination').all();
        db.exec('COMMIT');
        return { ok: true, data: { jobs, printers } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false, error: 'Print jobs unavailable. Try again.' }; }
  });
}
module.exports = { CHANNEL, registerPrintJobs };
