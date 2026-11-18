const shifts = require('./shifts');

const amount = value => Number.isSafeInteger(value) && value >= 0;
const id = value => Number.isSafeInteger(value) && value > 0;
const token = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const keys = (req, names) => Reflect.ownKeys(req).length === names.length && names.every(name => Object.hasOwn(req, name));
const plain = value => value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
function valid(req) {
  if (req.action === 'walletStatus' || req.action === 'walletHistory') return keys(req,['action']);
  if (req.action === 'walletPrepare') return keys(req,['action','operation']) && plain(req.operation) && ['walletStart','walletMovement','walletShiftClose','walletDayClose'].includes(req.operation.action) && valid(req.operation);
  if (req.action === 'walletExecute' || req.action === 'walletRequestStatus' || req.action === 'walletCancel') return keys(req,['action','requestId']) && token(req.requestId);
  if (req.action === 'walletStart') return keys(req,['action','amount','revision','requestId']) && amount(req.amount) && typeof req.revision === 'string' && token(req.requestId);
  if (req.action === 'walletMovement') return keys(req,['action','shiftId','direction','amount','reason','requestId']) && id(req.shiftId) && ['in','out'].includes(req.direction) && amount(req.amount) && req.amount > 0 && typeof req.reason === 'string' && req.reason === req.reason.trim() && req.reason.length > 0 && req.reason.length <= 200 && !/[\x00-\x1f\x7f]/.test(req.reason) && token(req.requestId);
  if (req.action === 'walletShiftClose') return keys(req,['action','shiftId','counted','retained','revision','requestId']) && id(req.shiftId) && amount(req.counted) && amount(req.retained) && req.retained <= req.counted && typeof req.revision === 'string' && token(req.requestId);
  if (req.action === 'walletDayClose') return keys(req,['action','dayId','shiftId','counted','revision','requestId']) && id(req.dayId) && id(req.shiftId) && amount(req.counted) && typeof req.revision === 'string' && token(req.requestId);
  return false;
}
function payload(req) {
  const values = {walletStart:['amount','revision'],walletMovement:['shiftId','direction','amount','reason'],walletShiftClose:['shiftId','counted','retained','revision'],walletDayClose:['dayId','shiftId','counted','revision']}[req.action];
  return JSON.stringify(values.map(key => req[key]));
}
function replay(db,req,actor) {
  const prepared=db.prepare('SELECT actor_id AS actor,action,payload FROM wallet_prepared WHERE request_id=?').get(req.requestId);
  if (prepared && (prepared.actor!==actor || prepared.action!==req.action || prepared.payload!==payload(req))) throw Error('Invalid request');
  if (db.prepare('SELECT 1 FROM wallet_cancellations WHERE request_id=?').get(req.requestId)) throw Error('Request cancelled');
  const row=db.prepare('SELECT actor_id AS actor,action,payload,result FROM wallet_requests WHERE request_id=?').get(req.requestId);
  if (!row) return null;
  if (row.actor!==actor || row.action!==req.action || row.payload!==payload(req)) throw Error('Invalid request');
  return {...JSON.parse(row.result),replayed:true};
}
function requestStatus(db,requestId,actor) {
  const prepared=db.prepare('SELECT actor_id AS actor FROM wallet_prepared WHERE request_id=?').get(requestId);
  const done=db.prepare('SELECT actor_id AS actor,result FROM wallet_requests WHERE request_id=?').get(requestId);
  const cancelled=db.prepare('SELECT actor_id AS actor FROM wallet_cancellations WHERE request_id=?').get(requestId);
  if ((prepared && prepared.actor!==actor) || (done && done.actor!==actor) || (cancelled && cancelled.actor!==actor)) throw Error('Invalid request');
  if (done) return {status:'completed',result:JSON.parse(done.result)};
  if (cancelled) return {status:'cancelled'};
  return {status:prepared?'prepared':'absent'};
}
function prepare(db,operation,actor) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row=db.prepare('SELECT actor_id AS actor,action,payload FROM wallet_prepared WHERE request_id=?').get(operation.requestId);
    if (row && (row.actor!==actor || row.action!==operation.action || row.payload!==payload(operation))) throw Error('Invalid request');
    if (row && db.prepare('SELECT 1 FROM wallet_cancellations WHERE request_id=?').get(operation.requestId)) { db.exec('COMMIT'); return {ok:true,data:{status:'cancelled'}}; }
    const prior=replay(db,operation,actor);
    if (!row) db.prepare('INSERT INTO wallet_prepared VALUES(?,?,?,?,?)').run(operation.requestId,actor,operation.action,payload(operation),JSON.stringify(operation));
    const result=prior?{status:'completed',result:prior}:{status:'prepared'};
    db.exec('COMMIT'); return {ok:true,data:result};
  } catch (error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
function cancel(db,requestId,actor) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=requestStatus(db,requestId,actor);
    if (existing.status==='prepared') {
      db.prepare('INSERT INTO wallet_cancellations VALUES(?,?,?)').run(requestId,actor,Date.now());
      db.exec('COMMIT'); return {ok:true,data:{status:'cancelled'}};
    }
    db.exec('COMMIT'); return {ok:true,data:existing};
  } catch (error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
function preparedOperation(db,requestId,actor) {
  const row=db.prepare('SELECT actor_id AS actor,operation FROM wallet_prepared WHERE request_id=?').get(requestId);
  if (!row || row.actor!==actor) throw Error('Invalid request');
  const operation=JSON.parse(row.operation);
  if (!plain(operation) || !['walletStart','walletMovement','walletShiftClose','walletDayClose'].includes(operation.action) || !valid(operation) || operation.requestId!==requestId) throw Error('Invalid request');
  return operation;
}
function saveRequest(db,req,actor,result) {
  db.prepare('INSERT INTO wallet_requests VALUES(?,?,?,?,?)').run(req.requestId,actor,req.action,payload(req),JSON.stringify(result));
}
function current(db) {
  const day=shifts.currentDay(db);
  const shift=day && shifts.currentShift(db,day.id);
  return {day,shift};
}
function snapshot(db,shift) {
  const base=db.prepare('SELECT amount,kind,payment_boundary AS boundary FROM wallet_baselines WHERE shift_id=?').get(shift.id);
  const close=db.prepare('SELECT expected,counted,variance,retained,taken,day_close AS dayClose FROM wallet_closings WHERE shift_id=?').get(shift.id);
  if (!base) return {baseline:null,baselineKind:null,openingFloat:null,expected:null,revision:null,closing:null};
  let expected=base.amount, lastPayment=base.boundary, lastMovement=0;
  for (const p of db.prepare("SELECT p.id,p.amount FROM payments p JOIN payment_shifts ps ON ps.payment_id=p.id WHERE ps.shift_id=? AND p.method='cash' AND p.id>? ORDER BY p.id").all(shift.id,base.boundary)) {
    expected+=p.amount; lastPayment=p.id;
    if (!Number.isSafeInteger(expected)) throw Error('Invalid wallet total');
  }
  for (const m of db.prepare('SELECT id,direction,amount FROM wallet_movements WHERE shift_id=? ORDER BY id').all(shift.id)) {
    expected+=m.direction==='in'?m.amount:-m.amount; lastMovement=m.id;
    if (!Number.isSafeInteger(expected)) throw Error('Invalid wallet total');
  }
  return {baseline:base.amount,baselineKind:base.kind,openingFloat:base.kind==='midshift'?null:base.amount,expected,revision:`${shift.id}:${base.boundary}:${lastPayment}:${lastMovement}`,closing:close ? {...close,dayClose:!!close.dayClose} : null};
}
function status(db) {
  const {day,shift}=current(db);
  if (!day) throw Error('No open day');
  const available=!db.prepare('SELECT 1 FROM shift_coverage_unavailable WHERE day_id=?').get(day.id);
  const state=shift?snapshot(db,shift):{baseline:null,baselineKind:null,openingFloat:null,expected:null,revision:null,closing:null};
  if (state.baseline===null) {
    const cash=db.prepare("SELECT COALESCE(max(p.id),0) AS id FROM payments p JOIN payment_business_days pd ON pd.payment_id=p.id WHERE pd.business_day_id=? AND p.method='cash'").get(day.id).id;
    state.revision=`untracked:${day.id}:${shift?.id ?? 0}:${cash}`;
  }
  return {dayId:day.id,shiftId:shift?.id ?? null,reportable:!!shift?.reportable,available,...state};
}
function history(db) {
  return db.prepare(`SELECT s.id AS shiftId,s.day_id AS dayId,s.opened_at AS openedAt,s.reportable,b.actor_id AS baselineActor,b.recorded_at AS baselineAt FROM restaurant_shifts s JOIN wallet_baselines b ON b.shift_id=s.id ORDER BY s.id DESC`).all().map(shift=>({
    ...shift,reportable:!!shift.reportable,...historical(db,{id:shift.shiftId}),
    movements:db.prepare('SELECT actor_id AS actorId,recorded_at AS recordedAt,direction,amount,reason FROM wallet_movements WHERE shift_id=? ORDER BY id').all(shift.shiftId),
    closing:db.prepare('SELECT actor_id AS actorId,recorded_at AS recordedAt FROM wallet_closings WHERE shift_id=?').get(shift.shiftId) ?? null
  }));
}
function historical(db,shift) {
  const state=snapshot(db,shift);
  if (state.baseline===null) return null;
  const {baseline,baselineKind,openingFloat,closing}=state;
  return {baseline,baselineKind,openingFloat,expected:closing?.expected ?? null,counted:closing?.counted ?? null,variance:closing?.variance ?? null,retained:closing?.retained ?? null,taken:closing?.taken ?? null,dayClose:closing?.dayClose ?? null};
}
function verifyCount(db,req) {
  const {day,shift}=current(db);
  if (!day || !shift || shift.id!==req.shiftId || (req.dayId && day.id!==req.dayId) || db.prepare('SELECT 1 FROM shift_closes WHERE shift_id=?').get(shift.id)) throw Error('Invalid shift');
  const state=snapshot(db,shift);
  if (state.expected===null) throw Error('Wallet is not tracked');
  if (state.revision!==req.revision) return null;
  const variance=req.counted-state.expected;
  if (!Number.isSafeInteger(variance)) throw Error('Invalid variance');
  return {day,shift,state,variance};
}
function insertClosing(db,req,actor,checked,dayClose) {
  const retained=dayClose?null:req.retained, taken=dayClose?null:req.counted-req.retained;
  db.prepare('INSERT INTO wallet_closings VALUES(?,?,?,?,?,?,?,?,?)').run(req.shiftId,actor,Date.now(),checked.state.expected,req.counted,checked.variance,retained,taken,dayClose?1:0);
}
function handle(req,db,scope,actor) {
  if (scope!=='combined' || !valid(req) || req.action==='walletDayClose') return {ok:false};
  if (req.action==='walletStatus' || req.action==='walletHistory') {
    db.exec('BEGIN');
    try { const data=req.action==='walletStatus'?status(db):{wallets:history(db)}; db.exec('COMMIT'); return {ok:true,data}; }
    catch (error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior=replay(db,req,actor);
    if (prior) { db.exec('COMMIT'); return {ok:true,data:prior}; }
    let {day,shift}=current(db);
    if (!day || db.prepare('SELECT 1 FROM shift_coverage_unavailable WHERE day_id=?').get(day.id)) throw Error('Unavailable');
    let result;
    if (req.action==='walletStart') {
      const before=status(db);
      if (before.baseline!==null) throw Error('Already tracked');
      if (before.revision!==req.revision) { db.exec('ROLLBACK'); return {ok:false,error:'stale'}; }
      if (!shift) {
        const shiftId=db.prepare('INSERT INTO restaurant_shifts(day_id,opened_at,reportable) VALUES(?,?,0)').run(day.id,Date.now()).lastInsertRowid;
        shift={id:shiftId,dayId:day.id,reportable:0};
      }
      if (db.prepare('SELECT 1 FROM shift_closes WHERE shift_id=?').get(shift.id) || db.prepare('SELECT 1 FROM wallet_baselines WHERE shift_id=?').get(shift.id)) throw Error('Already tracked');
      const boundary=db.prepare('SELECT COALESCE(max(id),0) AS id FROM payments').get().id;
      db.prepare('INSERT INTO wallet_baselines VALUES(?,?,?,?,?,?)').run(shift.id,actor,Date.now(),req.amount,boundary,shift.reportable?'midshift':'opening');
      result={shiftId:shift.id,replayed:false};
    } else if (req.action==='walletMovement') {
      if (!shift || shift.id!==req.shiftId || db.prepare('SELECT 1 FROM shift_closes WHERE shift_id=?').get(shift.id) || snapshot(db,shift).baseline===null) throw Error('Invalid shift');
      db.prepare('INSERT INTO wallet_movements(shift_id,actor_id,recorded_at,direction,amount,reason) VALUES(?,?,?,?,?,?)').run(shift.id,actor,Date.now(),req.direction,req.amount,req.reason);
      snapshot(db,shift); result={shiftId:shift.id,replayed:false};
    } else {
      const checked=verifyCount(db,req);
      if (!checked) { db.exec('ROLLBACK'); return {ok:false,error:'stale'}; }
      if (!checked.shift.reportable) throw Error('Empty shift');
      const now=Date.now(); shifts.finalize(db,checked.shift,actor,now); insertClosing(db,req,actor,checked,false);
      const next=db.prepare('INSERT INTO restaurant_shifts(day_id,opened_at,reportable) VALUES(?,?,0)').run(day.id,now).lastInsertRowid;
      const boundary=db.prepare('SELECT COALESCE(max(id),0) AS id FROM payments').get().id;
      db.prepare('INSERT INTO wallet_baselines VALUES(?,?,?,?,?,?)').run(next,actor,now,req.retained,boundary,'carry');
      result={shift:shifts.visibleShift(db,checked.shift,scope),replayed:false};
    }
    saveRequest(db,req,actor,result); db.exec('COMMIT'); return {ok:true,data:result};
  } catch (error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
module.exports={valid,handle,status,historical,replay,saveRequest,verifyCount,insertClosing,prepare,preparedOperation,requestStatus,cancel};
