const { project } = require('./shifts');

// Key by database file so another connection cannot send the same report concurrently.
const flights = new Map();
function key(db, id) { return db.prepare('PRAGMA database_list').all().find(x=>x.name==='main').file + ':' + id; }
function sending(db, id) { return flights.has(key(db,id)); }
function status(db, shiftId, scope) {
  const last=db.prepare(`SELECT a.id,r.result FROM shift_print_attempts a LEFT JOIN shift_print_results r ON r.attempt_id=a.id WHERE a.shift_id=? AND a.scope=? ORDER BY a.id DESC LIMIT 1`).get(shiftId,scope);
  const count=db.prepare('SELECT count(*) AS n FROM shift_print_attempts WHERE shift_id=? AND scope=?').get(shiftId,scope).n;
  const all=db.prepare('SELECT id FROM shift_print_attempts WHERE shift_id=? ORDER BY id DESC LIMIT 1').get(shiftId);
  return {printAttempts:count,printResult:last ? (sending(db,last.id)?'pending':last.result || 'uncertain') : null,reportSending:!!all && sending(db,all.id)};
}
function handle(req,db,actor,scope,adapter) {
  if(req.action==='shiftPrintStatus') {
    const row=db.prepare(`SELECT a.id,r.result FROM shift_print_attempts a LEFT JOIN shift_print_results r ON r.attempt_id=a.id WHERE a.shift_id=? AND a.request_id=? AND a.actor_id=? AND a.scope=?`).get(req.shiftId,req.requestId,actor,scope);
    return {ok:true,data:row ? {found:true,result:sending(db,row.id)?'pending':row.result || 'uncertain'} : {found:false}};
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior=db.prepare('SELECT shift_id AS shiftId,actor_id AS actor,scope FROM shift_print_attempts WHERE request_id=?').get(req.requestId);
    if(prior) {
      if(prior.shiftId!==req.shiftId || prior.actor!==actor || prior.scope!==scope) throw Error('Invalid request');
      db.exec('COMMIT'); return {ok:true,data:{replayed:true}};
    }
    const shift=db.prepare(`SELECT s.id,s.day_id AS dayId,s.opened_at AS openedAt,c.closed_at AS closedAt,c.snapshot FROM restaurant_shifts s JOIN shift_closes c ON c.shift_id=s.id WHERE s.id=?`).get(req.shiftId);
    if(!shift) throw Error('Report unavailable');
    const last=db.prepare('SELECT id FROM shift_print_attempts WHERE shift_id=? ORDER BY id DESC LIMIT 1').get(shift.id);
    if(last && sending(db,last.id)) throw Error('Printing in progress');
    const queue=db.prepare('SELECT queue FROM day_print_settings WHERE id=1').get().queue;
    const snapshot={id:shift.id,dayId:shift.dayId,openedAt:shift.openedAt,closedAt:shift.closedAt,...project(JSON.parse(shift.snapshot),scope)};
    const attemptId=Number(db.prepare('INSERT INTO shift_print_attempts(shift_id,request_id,actor_id,scope,queue,started_at) VALUES(?,?,?,?,?,?)').run(shift.id,req.requestId,actor,scope,queue,Date.now()).lastInsertRowid);
    db.exec('COMMIT');
    const flightKey=key(db,attemptId); flights.set(flightKey,true);
    Promise.resolve().then(()=>adapter({attemptId,queue,destination:'shift-report',scope,snapshot})).then(result=>{
      db.prepare('INSERT INTO shift_print_results VALUES(?,?,?)').run(attemptId,result==='accepted'?'accepted':'failed',Date.now());
    }).catch(()=>{}).finally(()=>flights.delete(flightKey));
    return {ok:true,data:{replayed:false}};
  } catch(error) { if(db.isTransaction) db.exec('ROLLBACK'); throw error; }
}
module.exports={handle,status};
