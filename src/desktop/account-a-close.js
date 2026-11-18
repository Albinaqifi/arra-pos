const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const flights = new WeakMap();
function active(db) { if (!flights.has(db)) flights.set(db, new Set()); return flights.get(db); }
function summarize(snapshot) {
  const records = snapshot.records.filter(r => r.method === 'card' || r.account === 'A');
  let cash = 0, card = 0;
  for (const r of records) {
    if (!Number.isSafeInteger(r.amount) || r.amount < 0 || !['cash','card'].includes(r.method)) throw Error('Invalid payment');
    if (r.method === 'cash') cash += r.amount; else card += r.amount;
    if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(card) || !Number.isSafeInteger(cash + card)) throw Error('Invalid total');
  }
  return {...snapshot, records:records.map(r => ({...r,account:'A'})), count:records.length, cash, card, total:cash + card};
}
function attempt(db, close, actor, requestId) {
  const prior = db.prepare('SELECT close_id AS closeId FROM account_a_attempts WHERE request_id=?').get(requestId);
  if (prior) { if (prior.closeId !== close.id) throw Error('Request conflict'); return null; }
  const latest = db.prepare('SELECT id FROM account_a_attempts WHERE close_id=? ORDER BY id DESC LIMIT 1').get(close.id);
  if (latest && active(db).has(latest.id)) throw Error('Printing in progress');
  const queue = db.prepare('SELECT queue FROM account_a_settings WHERE id=1').get().queue;
  const id = db.prepare('INSERT INTO account_a_attempts(close_id,request_id,actor_id,queue,started_at) VALUES(?,?,?,?,?)').run(close.id,requestId,actor,queue,Date.now()).lastInsertRowid;
  return {attemptId:id,queue,destination:'account-a-close',scope:'A',snapshot:JSON.parse(close.snapshot)};
}
function dispatch(db,adapter,job) {
  if (!job) return;
  active(db).add(job.attemptId);
  Promise.resolve().then(()=>adapter(job)).then(result=>db.prepare('INSERT INTO account_a_results VALUES(?,?,?)').run(job.attemptId,result === 'accepted' ? 'accepted' : 'failed',Date.now())).catch(()=>{}).finally(()=>active(db).delete(job.attemptId));
}
function handleAccountA(event, req, allowed, db, session, adapter) {
  if (!allowed(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype) return {ok:false};
  const keys = Reflect.ownKeys(req).length;
  const valid = (req.action === 'accountAList' && keys === 1) || (req.action === 'accountAClose' && keys === 3 && Number.isSafeInteger(req.dayId) && req.dayId > 0 && ['en','sq'].includes(req.language)) ||
    (req.action === 'accountARetry' && keys === 4 && Number.isSafeInteger(req.dayId) && req.dayId > 0 && req.checked === true && typeof req.requestId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(req.requestId)) ||
    (req.action === 'accountAConfigure' && keys === 2 && typeof req.queue === 'string' && req.queue === req.queue.trim() && req.queue.length > 0 && req.queue.length <= 255 && !/[\x00-\x1f\x7f]/.test(req.queue));
  if (!valid) return {ok:false};
  try {
    const actor = session.currentUserId();
    if (!actor || actor !== session.authenticatedUserId() || db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope !== 'combined' || !hasPermissions(db,session,'business_days.close')) return {ok:false,denied:true};
    if (req.action === 'accountAConfigure') { db.prepare('UPDATE account_a_settings SET queue=? WHERE id=1').run(req.queue); return {ok:true}; }
    if (req.action === 'accountAList') {
      const settings=db.prepare('SELECT boundary,queue FROM account_a_settings WHERE id=1').get();
      const days=db.prepare(`SELECT d.id,d.opened_at AS openedAt,d.closed_at AS closedAt,j.snapshot AS source,c.snapshot,c.actor_id AS closedBy,c.closed_at AS accountClosedAt,c.id AS closeId,
        (SELECT COUNT(*) FROM account_a_attempts WHERE close_id=c.id) AS printAttempts,
        (SELECT COALESCE(r.result,'uncertain') FROM account_a_attempts a LEFT JOIN account_a_results r ON r.attempt_id=a.id WHERE a.close_id=c.id ORDER BY a.id DESC LIMIT 1) AS printResult
        FROM business_days d JOIN day_print_jobs j ON j.day_id=d.id LEFT JOIN account_a_closes c ON c.day_id=d.id WHERE d.closed_at IS NOT NULL AND d.id>? ORDER BY d.id DESC`).all(settings.boundary).map(d=>{
          const report=d.snapshot ? JSON.parse(d.snapshot) : summarize(JSON.parse(d.source));
          return {id:d.id,openedAt:d.openedAt,closedAt:d.closedAt,status:d.closeId ? 'complete':'pending',count:report.count,total:report.total,cash:report.cash,card:report.card,closedBy:d.closedBy,accountClosedAt:d.accountClosedAt,printAttempts:d.printAttempts,printResult:d.printResult};
        });
      return {ok:true,data:{queue:settings.queue,days}};
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      let close=db.prepare('SELECT id,snapshot FROM account_a_closes WHERE day_id=?').get(req.dayId);
      if (req.action === 'accountAClose') {
        if (close) { db.exec('COMMIT'); return {ok:true}; }
        const day=db.prepare(`SELECT j.snapshot FROM business_days d JOIN day_print_jobs j ON j.day_id=d.id JOIN account_a_settings s ON s.id=1 WHERE d.id=? AND d.id>s.boundary AND d.closed_at IS NOT NULL`).get(req.dayId);
        if (!day) throw Error('Day unavailable');
        const now=Date.now(), snapshot=JSON.stringify({...summarize(JSON.parse(day.snapshot)),accountClosedAt:now,closedBy:actor,language:req.language});
        const id=db.prepare('INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(?,?,?,?)').run(req.dayId,actor,now,snapshot).lastInsertRowid;
        close={id,snapshot};
        const job=attempt(db,close,actor,'close-'+req.dayId);
        recordAudit(db,actor,'close','account_a_day',req.dayId,null,{});
        db.exec('COMMIT'); dispatch(db,adapter,job); return {ok:true};
      }
      if (!close) throw Error('Close unavailable');
      const job=attempt(db,close,actor,'retry-'+req.requestId);
      db.exec('COMMIT'); dispatch(db,adapter,job); return {ok:true};
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  } catch (_) { return {ok:false}; }
}
module.exports={handleAccountA};
