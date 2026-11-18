const { recordAudit } = require('./audit');

// These functions are called inside the caller's existing write transaction.
function currentDay(db) { return db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get(); }
function currentShift(db, dayId) { return db.prepare('SELECT id,day_id AS dayId,opened_at AS openedAt,reportable FROM restaurant_shifts WHERE day_id=? ORDER BY id DESC LIMIT 1').get(dayId); }
function markService(db, now) {
  const day = currentDay(db);
  if (!day) throw Error('No open day');
  if (db.prepare('SELECT 1 FROM shift_coverage_unavailable WHERE day_id=?').get(day.id)) return;
  const shift = currentShift(db, day.id);
  if (!shift) db.prepare('INSERT INTO restaurant_shifts(day_id,opened_at,reportable) VALUES(?,?,1)').run(day.id, now);
  else if (!shift.reportable) db.prepare('UPDATE restaurant_shifts SET reportable=1 WHERE id=?').run(shift.id);
}
function assignPayment(db, paymentId) {
  const day = currentDay(db);
  if (!day || db.prepare('SELECT 1 FROM shift_coverage_unavailable WHERE day_id=?').get(day.id)) return;
  const shift = currentShift(db, day.id);
  if (!shift || !shift.reportable) throw Error('Missing active shift');
  const paymentDay = db.prepare('SELECT business_day_id AS id FROM payment_business_days WHERE payment_id=?').get(paymentId);
  if (!paymentDay || paymentDay.id !== day.id) throw Error('Payment day mismatch');
  db.prepare('INSERT INTO payment_shifts(payment_id,shift_id) VALUES(?,?)').run(paymentId, shift.id);
}
function summary(db, shift) {
  const rows = db.prepare(`SELECT p.amount,p.method,COALESCE(c.account,p.account) AS account FROM payments p JOIN payment_shifts ps ON ps.payment_id=p.id LEFT JOIN (SELECT payment_id,'A' AS account FROM payment_account_corrections) c ON c.payment_id=p.id WHERE ps.shift_id=? ORDER BY p.id`).all(shift.id);
  const amounts = { A:{count:0,total:0,cash:0,card:0}, B:{count:0,total:0,cash:0,card:0} };
  for (const row of rows) {
    if (!amounts[row.account] || !['cash','card'].includes(row.method) || !Number.isSafeInteger(row.amount) || row.amount < 0) throw Error('Invalid payment');
    const a=amounts[row.account]; a.count++; a.total+=row.amount; a[row.method]+=row.amount;
    if (![a.count,a.total,a.cash,a.card].every(Number.isSafeInteger)) throw Error('Invalid total');
  }
  return amounts;
}
function project(amounts, scope) {
  if (scope !== 'combined') return amounts[scope];
  const result={}; for (const key of ['count','total','cash','card']) { result[key]=amounts.A[key]+amounts.B[key]; if(!Number.isSafeInteger(result[key])) throw Error('Invalid total'); } return result;
}
function finalize(db, shift, actor, now) {
  const snapshot=JSON.stringify(summary(db,shift));
  db.prepare('INSERT INTO shift_closes(shift_id,closed_at,actor_id,snapshot) VALUES(?,?,?,?)').run(shift.id,now,actor,snapshot);
  recordAudit(db,actor,'close','restaurant_shift',shift.id,null,{});
  return snapshot;
}
function finalizeDay(db, dayId, actor, now) {
  const shift=currentShift(db,dayId);
  if (shift && shift.reportable && !db.prepare('SELECT 1 FROM shift_closes WHERE shift_id=?').get(shift.id)) finalize(db,shift,actor,now);
}
function visibleShift(db, shift, scope) {
  const close=db.prepare('SELECT closed_at AS closedAt,actor_id AS closedBy,snapshot FROM shift_closes WHERE shift_id=?').get(shift.id);
  const amounts=close ? JSON.parse(close.snapshot) : summary(db,shift);
  return {id:shift.id,dayId:shift.dayId,openedAt:shift.openedAt,reportable:!!shift.reportable,closedAt:close?.closedAt ?? null,closedBy:close?.closedBy ?? null,...project(amounts,scope)};
}
function handle(req, db, session, scope, actor) {
  if (req.action === 'shiftList') {
    if (Reflect.ownKeys(req).length !== 1) return {ok:false};
    const day=currentDay(db);
    const unavailable=!!db.prepare('SELECT 1 FROM shift_coverage_unavailable WHERE day_id=?').get(day.id);
    const shifts=db.prepare('SELECT id,day_id AS dayId,opened_at AS openedAt,reportable FROM restaurant_shifts WHERE reportable=1 OR day_id=? ORDER BY id DESC').all(day.id).map(s=>visibleShift(db,s,scope));
    return {ok:true,data:{dayId:day.id,coverage:unavailable?'unavailable':'available',shifts}};
  }
  if (req.action !== 'shiftClose' || Reflect.ownKeys(req).length !== 2 || !Number.isSafeInteger(req.shiftId) || req.shiftId<=0) return {ok:false};
  db.exec('BEGIN IMMEDIATE');
  try {
    const shift=db.prepare('SELECT id,day_id AS dayId,opened_at AS openedAt,reportable FROM restaurant_shifts WHERE id=?').get(req.shiftId);
    if (!shift) { db.exec('ROLLBACK'); return {ok:false}; }
    const closed=db.prepare('SELECT 1 FROM shift_closes WHERE shift_id=?').get(shift.id);
    if (closed) { const data=visibleShift(db,shift,scope); db.exec('COMMIT'); return {ok:true,data:{shift:data,replayed:true}}; }
    const day=currentDay(db), latest=day && currentShift(db,day.id);
    if (!day || shift.dayId!==day.id || latest.id!==shift.id || !shift.reportable) {db.exec('ROLLBACK');return {ok:false};}
    const now=Date.now(); finalize(db,shift,actor,now);
    db.prepare('INSERT INTO restaurant_shifts(day_id,opened_at,reportable) VALUES(?,?,0)').run(day.id,now);
    const data=visibleShift(db,shift,scope); db.exec('COMMIT'); return {ok:true,data:{shift:data,replayed:false}};
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
module.exports={markService,assignPayment,finalizeDay,finalize,visibleShift,currentDay,currentShift,handle,project};
