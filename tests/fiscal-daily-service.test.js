const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { historicalDatabase } = require('./support/historical-database');

function localDate() {
  const d = new Date();
  return [d.getDate(),d.getMonth()+1,d.getFullYear()%100].map(n=>String(n).padStart(2,'0')).join('');
}
const baseline = {previousClosure:12,previousDocumentNumber:'0000022',deviceDate:localDate()};
const accepted = {status:'accepted',reference:'0013',evidence:{closure:13,documentNumber:'0000023'}};
function fixture(t, adapter, open = openDatabase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'arra-z-'));
  let db = open(dir), actor = 1, generation = 0;
  const trusted = {};
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES
    (1,'combined',x'00',x'00'),(2,'owner',x'00',x'00'),(3,'combined-unprivileged',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'combined');
    INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'business_days.close');`);
  function connect(connection, daily) {
    let handler;
    registerBusinessDays({handle:(_,fn)=>{handler=fn;}},event=>event===trusted,connection,
      {currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>generation},()=> 'accepted',daily);
    return (req,event=trusted)=>handler(event,req);
  }
  let handler = connect(db,adapter);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {
    get db(){return db;}, get dir(){return dir;},connect, call:(...args)=>handler(...args),
    switchActor(id){actor=id;generation++;},
    restart(nextAdapter){db.close();db=openDatabase(dir);handler=connect(db,nextAdapter);},
    async closeDay(){
      const id=handler({action:'list'}).data.days.find(d=>d.closedAt===null).id;
      assert.equal(handler({action:'close',dayId:id}).ok,true);
      await new Promise(setImmediate);
      return id;
    },
    list:()=>handler({action:'accountAList'}).data.days,
  };
}
// Seed a synthetic verified checkout including the same device baseline and
// tender that normal settlement must persist. Amounts here are whole MKD.
function payment(db,id,{kind='device',method='cash',amount=70,receiptCount=1,document=22}={}) {
  db.prepare("INSERT INTO dining_tables(id,area) VALUES(?,'sample')").run(id);
  db.prepare("INSERT INTO orders(id,table_id,opened_at,status) VALUES(?,?,1,'open')").run(id,id);
  db.prepare('INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(?,?,1,1,?,?)').run(id,id,amount,'b'+id);
  if (kind==='device' || kind==='simulation' || kind==='unresolved') {
    const mode=kind==='unresolved'?'simulation':kind;
    const receipt={billId:id,method,account:'A',currency:'MKD',total:amount,
      lines:[{quantity:1,unitPrice:amount,taxGroup:'В',taxRate:10}],domesticProduct:true};
    const deviceId=mode==='device'?'sample-device':null;
    db.prepare('INSERT INTO fiscal_checkout_sales VALUES(?,1,?,?,?,?,1)').run(id,mode,deviceId,method,JSON.stringify(receipt));
    db.prepare('INSERT INTO fiscal_checkout_attempts VALUES(?,?,1)').run(id,id);
    if (kind==='unresolved') return;
    const ref=mode==='device'?String(document).padStart(7,'0'):'SIM-'+id;
    const evidence=mode==='device'?JSON.stringify({documentNumber:ref,fiscalReceiptCount:receiptCount,reversalCount:0}):null;
    if (mode==='device') db.prepare('INSERT INTO fiscal_checkout_baselines VALUES(?,?,?)').run(id,deviceId,String(document-1).padStart(7,'0'));
    db.prepare("INSERT INTO fiscal_checkout_results VALUES(?,'accepted',?,?,?,1)").run(id,deviceId?'device-'+deviceId:'simulation',ref,evidence);
  }
  db.prepare('INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(?,?,1,1,?,?,?)')
    .run(id,id,amount,method,['B','corrected'].includes(kind)?'B':'A');
  if (kind==='corrected') db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(?,1,1,'sample')").run(id);
}

function device(issueDailyReport,reconcileDailyReport=()=>{throw Error('No read expected');}) {
  return {mode:'device',deviceId:'sample-device',issueDailyReport,reconcileDailyReport};
}
const issue = dayId=>({action:'accountAFiscalClose',mode:'device',dayId,confirmed:true});
const check = dayId=>({action:'accountAFiscalReconcile',mode:'device',dayId});
const internal = dayId=>({action:'accountAClose',dayId,language:'en'});
const notIssued = {status:'not-issued',evidence:{
  closure:baseline.previousClosure,documentNumber:baseline.previousDocumentNumber,deviceDate:baseline.deviceDate
}};

test('only matching read-only nonissuance proof releases checkout and permits one newly confirmed retry after restart', async t=>{
  let sends=0, proof;
  const adapter=device((_expected,{beforeIssue})=>{
    beforeIssue(baseline);
    return ++sends === 1 ? {status:'uncertain'} : accepted;
  },()=>proof);
  const f=fixture(t,adapter);
  payment(f.db,1);
  const dayId=await f.closeDay();
  const original=issue(dayId);
  assert.deepEqual(await f.call(original),{ok:false,error:'uncertain'});
  for (const evidence of [null,{...notIssued.evidence,closure:13},
    {...notIssued.evidence,documentNumber:'0000023'},{...notIssued.evidence,deviceDate:'000000'}]) {
    proof={status:'not-issued',evidence};
    assert.deepEqual(await f.call(check(dayId)),{ok:false,error:'uncertain'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_nonissuances').get().n,0);
  }
  // A reservation that has not yet been disproved still blocks other sales.
  f.db.exec('BEGIN');
  try { assert.throws(()=>payment(f.db,2,{kind:'unresolved'}),/outstanding daily report/); }
  finally { f.db.exec('ROLLBACK'); }
  proof=notIssued;
  assert.deepEqual(await f.call(check(dayId)),{ok:true,outcome:'not-issued'});
  assert.equal(sends,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM account_a_closes').get().n,0);
  f.restart(adapter);
  const {retryAfter}=f.list()[0].fiscal;
  assert.ok(Number.isSafeInteger(retryAfter) && retryAfter>0);
  assert.deepEqual({...f.db.prepare('SELECT attempt_id,actor_id FROM fiscal_daily_nonissuances').get()},
    {attempt_id:retryAfter,actor_id:1});
  f.db.exec('BEGIN');
  try { payment(f.db,2,{kind:'unresolved'}); } finally { f.db.exec('ROLLBACK'); }
  for (const request of [original,{...original,retryAfter:retryAfter+1},{...original,retryAfter,confirmed:false}]) {
    assert.equal((await f.call(request)).ok,false);
  }
  assert.equal(sends,1);
  const retry={...original,retryAfter};
  assert.deepEqual(await f.call(retry),{ok:true});
  assert.deepEqual(await f.call(retry),{ok:true});
  assert.equal(sends,2);
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'complete',reportNumber:'0013'});
  for (const [table,n] of [['fiscal_daily_reports',2],['fiscal_daily_nonissuances',1],
    ['fiscal_daily_confirmations',1],['account_a_closes',1],['payments',1]]) {
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,n);
  }
  for (const change of ['DELETE FROM fiscal_daily_nonissuances','UPDATE fiscal_daily_nonissuances SET actor_id=2',
    'INSERT OR REPLACE INTO fiscal_daily_nonissuances SELECT * FROM fiscal_daily_nonissuances']) {
    assert.throws(()=>f.db.exec(change));
  }
});

test('a delayed recovery on a second connection cannot clear or confirm the next attempt with identical device counters',async t=>{
  for (const lateResult of [notIssued,accepted]) {
    let sends=0,resolveOldRead;
    const adapter=device((_expected,{beforeIssue})=>{
      beforeIssue(baseline);
      return ++sends<3 ? {status:'uncertain'} : accepted;
    },()=>notIssued);
    const f=fixture(t,adapter);
    payment(f.db,1);
    const dayId=await f.closeDay();
    assert.equal((await f.call(issue(dayId))).error,'uncertain');
    const otherDb=openDatabase(f.dir);
    try {
      const other=f.connect(otherDb,device(assert.fail,()=>new Promise(resolve=>{resolveOldRead=resolve;})));
      const delayed=other(check(dayId));
      assert.deepEqual(await f.call(check(dayId)),{ok:true,outcome:'not-issued'});
      const firstToken=f.list()[0].fiscal.retryAfter;
      const oldConfirmation={...issue(dayId),retryAfter:firstToken};
      assert.equal((await f.call(oldConfirmation)).error,'uncertain');
      resolveOldRead(lateResult);
      assert.deepEqual(await delayed,{ok:false,error:'uncertain'});
      assert.equal(f.list()[0].fiscal.status,'uncertain');
      assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_nonissuances').get().n,1);
      assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_confirmations').get().n,0);
      assert.deepEqual(await f.call(check(dayId)),{ok:true,outcome:'not-issued'});
      const nextToken=f.list()[0].fiscal.retryAfter;
      assert.ok(Number.isSafeInteger(nextToken) && nextToken>firstToken);
      assert.equal((await f.call(oldConfirmation)).ok,false);
      assert.equal((await f.call(issue(dayId))).ok,false);
      assert.equal(sends,2);
      assert.equal((await f.call({...issue(dayId),retryAfter:nextToken})).ok,true);
      assert.equal(sends,3);
      assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_nonissuances').get().n,2);
      assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_confirmations').get().n,1);
    } finally { otherDb.close(); }
  }
});

test('a confirmation already in preflight must still match the last resolved attempt at the write boundary',async t=>{
  let allowPreflight, localWrites=0, parallelWrites=0;
  const local=device(async (_expected,{beforeIssue})=>{
    await new Promise(resolve=>{allowPreflight=resolve;});
    beforeIssue(baseline);
    localWrites++;
    return accepted;
  });
  const f=fixture(t,local);
  payment(f.db,1);
  const dayId=await f.closeDay();
  const delayed=f.call(issue(dayId));
  const otherDb=openDatabase(f.dir);
  try {
    const other=f.connect(otherDb,device((_expected,{beforeIssue})=>{
      beforeIssue(baseline); parallelWrites++; return {status:'uncertain'};
    },()=>notIssued));
    assert.equal((await other(issue(dayId))).error,'uncertain');
    assert.deepEqual(await other(check(dayId)),{ok:true,outcome:'not-issued'});
    allowPreflight();
    assert.equal((await delayed).ok,false);
    assert.equal(localWrites,0);
    assert.equal(parallelWrites,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_confirmations').get().n,0);
    assert.ok(f.list()[0].fiscal.retryAfter>0);
  } finally {otherDb.close();}
});

test('explicit Combined confirmation issues only aggregate data for both tenders; success persists without an internal queue job', async t=>{
  let writes=0;
  const f=fixture(t,device((expected,{beforeIssue})=>{
    assert.deepEqual(expected,{receiptCount:2,cash:70,card:80,total:150,taxTotals:[0,0,150,0],lastDocumentNumber:'0000022'});
    beforeIssue(baseline); writes++; return accepted;
  }));
  payment(f.db,1,{document:21}); payment(f.db,2,{receiptCount:2,method:'card',amount:80}); payment(f.db,3,{kind:'B'});
  assert.equal((await f.call(issue(1))).ok,false);
  const id=await f.closeDay();
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'ready'});
  assert.equal(f.call({action:'accountAConfigure',queue:'sample queue'}).ok,true);
  for (const req of [internal(id),check(id),{...issue(id),confirmed:false},{...issue(id),mode:'simulation'},{...issue(id),other:1},
    {action:'accountARetry',dayId:id,checked:true,requestId:'ignored'}]) assert.equal((await f.call(req)).ok,false);
  assert.equal((await f.call(issue(id),{})).ok,false);
  for (const user of [2,3]) {
    f.switchActor(user);
    assert.equal((await f.call(issue(id))).ok,false);
    assert.equal((await f.call(check(id))).ok,false);
  }
  f.switchActor(1);
  assert.equal(writes,0);
  assert.equal((await f.call(issue(id))).ok,true);
  assert.equal((await f.call(issue(id))).ok,true);
  assert.equal(writes,1);
  f.restart(null);
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'complete',reportNumber:'0013'});
  assert.equal(f.list()[0].status,'complete');
  assert.equal((await f.call({action:'accountARetry',dayId:id,checked:true,requestId:'reprint'})).ok,false);
  for (const [table,n] of [['payments',3],['fiscal_daily_reports',1],['fiscal_daily_confirmations',1],['account_a_closes',1],['account_a_attempts',0]]) {
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,n);
  }
  for(const table of ['fiscal_daily_reports','fiscal_daily_confirmations']){
    assert.throws(()=>f.db.exec('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table));
    assert.throws(()=>f.db.exec('DELETE FROM '+table));
    assert.throws(()=>f.db.exec('UPDATE '+table+' SET actor_id=2'));
  }
});

test('unknown and malformed acknowledgements never resend, exclude a concurrent sale, and recover through verified read-only evidence',async t=>{
  let finish, writes=0, reads=0, proof={...accepted,reference:'0012'};
  const adapter=device((expected,{beforeIssue})=>{
    beforeIssue(baseline); writes++; return new Promise(resolve=>{finish=resolve;});
  },(expected,old)=>{reads++;assert.deepEqual(old,baseline);assert.equal(expected.total,70);return proof;});
  const f=fixture(t,adapter);
  payment(f.db,1);
  const id=await f.closeDay();
  const initial=f.call(issue(id));
  assert.equal(f.list()[0].fiscal.status,'pending');
  const parallel=openDatabase(f.dir);
  try {
    const second=f.connect(parallel,adapter);
    assert.equal((await second(issue(id))).ok,false);
    assert.equal(second({action:'accountAList'}).data.days[0].fiscal.status,'uncertain');
    assert.throws(()=>payment(parallel,2,{kind:'unresolved'}),/outstanding daily report/);
  } finally {parallel.close();}
  finish({status:'failed'}); // An alleged pre-write failure after the durable boundary is unknown.
  assert.equal((await initial).error,'uncertain');
  f.restart(null);
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'uncertain',canReconcile:false});
  assert.equal(f.call(internal(id)).ok,false);
  assert.equal((await f.call(check(id))).ok,false);
  f.restart({...adapter,deviceId:'other-device'});
  assert.equal((await f.call(check(id))).ok,false);
  f.restart(adapter);
  assert.equal(f.list()[0].fiscal.canReconcile,true);
  assert.equal((await f.call(issue(id))).error,'uncertain');
  assert.equal((await f.call(check(id))).error,'uncertain');
  // A failed local finalization must roll back the close, keeping the reservation.
  f.db.exec("CREATE TRIGGER reject_confirmation BEFORE INSERT ON fiscal_daily_confirmations BEGIN SELECT RAISE(ABORT,'sample'); END");
  proof=accepted;
  assert.equal((await f.call(check(id))).error,'uncertain');
  assert.equal(f.db.prepare('SELECT count(*) n FROM account_a_closes').get().n,0);
  f.db.exec('DROP TRIGGER reject_confirmation');
  assert.equal((await f.call(check(id))).ok,true);
  assert.equal((await f.call(check(id))).ok,true);
  assert.equal(writes,1); assert.equal(reads,3);
});

test('empty days, uncovered corrections, same-valued sales on other days and interrupted checkouts block before preflight',async t=>{
  let probes=0;
  const adapter=device(()=>{probes++;});
  for(const reason of ['empty','coverage','period','unresolved']){
    const f=fixture(t,adapter);
    if(reason!=='empty') payment(f.db,1);
    if(reason==='coverage') payment(f.db,2,{kind:'corrected'});
    const id=await f.closeDay();
    if(reason==='period') payment(f.db,2,{document:23,receiptCount:2});
    if(reason==='unresolved') payment(f.db,2,{kind:'unresolved'});
    assert.equal(f.list()[0].fiscal.reason,reason);
    assert.equal((await f.call(issue(id))).error,reason);
    if(reason==='period') {
      const next=await f.closeDay();
      assert.deepEqual(f.list().map(d=>d.fiscal.reason),['period','period']);
      assert.equal((await f.call(issue(next))).error,'period');
    }
  }
  assert.equal(probes,0);
});

test('preflight validates clock and repeats proof and authorization before the irreversible command',async t=>{
  let scenario='date',writes=0;
  const adapter=device((_expected,{beforeIssue})=>{
    if(scenario==='selection') payment(f.db,2,{document:23,receiptCount:2});
    if(scenario==='identity') f.switchActor(3);
    beforeIssue(scenario==='date'?{...baseline,deviceDate:'000000'}:baseline);
    writes++;return accepted;
  });
  const f=fixture(t,adapter);
  payment(f.db,1);
  const id=await f.closeDay();
  assert.equal((await f.call(issue(id))).error,'preflight');
  scenario='identity';
  assert.equal((await f.call(issue(id))).denied,true);
  f.switchActor(1);scenario='selection';
  assert.equal((await f.call(issue(id))).error,'preflight');
  assert.equal(writes,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n,0);
});

test('a physical receipt from a longer period and an incomplete or reordered training journal cannot anchor the selected day',async t=>{
  const physical=fixture(t,device(()=>{throw Error('No preflight');}));
  payment(physical.db,1,{receiptCount:2});
  await physical.closeDay();
  assert.equal(physical.list()[0].fiscal.reason,'period');

  let first=null;
  const adapter={mode:'simulation',simulatedDocumentNumber:id=>id===1?first:'0000022',
    issueDailyReport(){throw Error('No preflight');},reconcileDailyReport(){throw Error('No query');}};
  const sim=fixture(t,adapter);
  payment(sim.db,1,{kind:'simulation'});payment(sim.db,2,{kind:'simulation'});
  const id=await sim.closeDay();
  assert.equal(sim.list()[0].fiscal.reason,'coverage');
  assert.equal((await sim.call({...issue(id),mode:'simulation'})).error,'coverage');
  first='0000023';
  assert.equal(sim.list()[0].fiscal.reason,'period');
  first='0000021';
  assert.equal(sim.list()[0].fiscal.status,'ready');
});

test('upgrade preserves v45 internal history and requires the physical profile for a pending day with device receipts',async t=>{
  const f=fixture(t,null,historicalDatabase(45).openDatabase);
  const old=await f.closeDay();
  // Seed the completed v45 summary directly. Its old schema has no fiscal journal.
  const snapshot=JSON.stringify({dayId:old,records:[],count:0,total:0,cash:0,card:0});
  f.db.prepare('INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(?,1,1,?)').run(old,snapshot);
  payment(f.db,1);
  const pending=await f.closeDay();
  f.restart(null);
  assert.equal(f.list().find(d=>d.id===old).fiscal,undefined);
  assert.equal(f.db.prepare('SELECT snapshot FROM account_a_closes WHERE day_id=?').get(old).snapshot,snapshot);
  assert.deepEqual(f.list().find(d=>d.id===pending).fiscal,{mode:'device',status:'blocked',reason:'unavailable'});
  assert.equal(f.call(internal(pending)).ok,false);
  f.restart(device(()=>{throw Error('No dispatch');}));
  assert.equal(f.list().find(d=>d.id===old).fiscal,undefined);
  assert.deepEqual(f.list().find(d=>d.id===pending).fiscal,{mode:'device',status:'ready'});
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('a v45 internally closed fiscal day gains a separately confirmed Z without changing its original close or queue history',async t=>{
  let writes=0;
  const adapter=device((_expected,{beforeIssue})=>{beforeIssue(baseline);writes++;return accepted;});
  const f=fixture(t,null,historicalDatabase(45).openDatabase);
  payment(f.db,1);
  const dayId=await f.closeDay();
  const shared=JSON.parse(f.db.prepare('SELECT snapshot FROM day_print_jobs WHERE day_id=?').get(dayId).snapshot);
  const original=JSON.stringify({...shared,count:1,cash:70,card:0,total:70,accountClosedAt:1111,closedBy:3,language:'sq'});
  const closeId=f.db.prepare('INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(?,3,1111,?)')
    .run(dayId,original).lastInsertRowid;
  f.db.prepare("INSERT INTO account_a_attempts(close_id,request_id,actor_id,queue,started_at) VALUES(?,'initial',3,'old queue',1111)").run(closeId);
  f.db.exec("INSERT INTO account_a_results VALUES(1,'accepted',1112)");
  f.restart(null);
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'blocked',reason:'unavailable'});
  f.restart(adapter);
  assert.deepEqual([f.list()[0].status,f.list()[0].fiscal.status,f.list()[0].closedBy],['complete','ready',3]);
  assert.equal((await f.call(issue(dayId))).ok,true);
  assert.equal((await f.call(issue(dayId))).ok,true);
  assert.deepEqual({...f.db.prepare('SELECT day_id,actor_id,closed_at,snapshot FROM account_a_closes').get()},
    {day_id:dayId,actor_id:3,closed_at:1111,snapshot:original});
  assert.deepEqual({...f.db.prepare('SELECT close_id,actor_id,report_number FROM fiscal_daily_confirmations').get()},
    {close_id:closeId,actor_id:1,report_number:'0013'});
  assert.equal(f.db.prepare('SELECT actor_id FROM fiscal_daily_reports').get().actor_id,1);
  assert.equal(f.list()[0].printAttempts,1);
  assert.equal(f.list()[0].printResult,'accepted');
  assert.equal(f.call({action:'accountARetry',dayId,checked:true,requestId:'old-summary'}).ok,true);
  await new Promise(setImmediate);f.restart(null);
  assert.deepEqual([writes,f.list()[0].printAttempts,f.list()[0].accountClosedAt,f.list()[0].fiscal.reportNumber],[1,2,1111,'0013']);
});

test('equal total in a historical summary for another receipt cannot authorize the Z',async t=>{
  let probes=0;
  const f=fixture(t,null,historicalDatabase(45).openDatabase);
  payment(f.db,1);
  const dayId=await f.closeDay();
  const shared=JSON.parse(f.db.prepare('SELECT snapshot FROM day_print_jobs WHERE day_id=?').get(dayId).snapshot);
  shared.records[0].billId=22;
  f.db.prepare('INSERT INTO account_a_closes(day_id,actor_id,closed_at,snapshot) VALUES(?,3,1,?)')
    .run(dayId,JSON.stringify({...shared,count:1,cash:70,card:0,total:70}));
  f.restart(device(()=>{probes++;}));
  assert.equal(f.list()[0].fiscal.reason,'coverage');
  assert.equal((await f.call(issue(dayId))).error,'coverage');
  assert.equal(probes,0);
});

test('legacy simulated receipts absent from the new printer do not contaminate a later registered training day',async t=>{
  let writes=0;
  const adapter={mode:'simulation',simulatedDocumentNumber:id=>id===2?'0000022':null,
    issueDailyReport(expected,{beforeIssue}){beforeIssue(baseline);writes++;return accepted;},reconcileDailyReport(){throw Error('No read');}};
  const f=fixture(t,null,historicalDatabase(45).openDatabase);
  payment(f.db,1,{kind:'simulation'});
  await f.closeDay();f.restart(adapter);
  payment(f.db,2,{kind:'simulation'});
  const id=await f.closeDay();
  assert.equal(f.list()[0].fiscal.status,'ready');
  assert.equal((await f.call({...issue(id),mode:'simulation'})).ok,true);
  assert.equal(writes,1);
});

test('permanently enrolled databases reject local-only closes even for corrected B-only days when reopened outside the physical profile',async t=>{
  const f=fixture(t,null);
  require('../src/desktop/pf700-commissioning').enroll(f.db);
  payment(f.db,1,{kind:'corrected'});
  const id=await f.closeDay();
  f.restart(null);
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'blocked',reason:'unavailable'});
  assert.equal(f.call(internal(id)).ok,false);
  f.restart(device(()=>{throw Error('No preflight');}));
  assert.deepEqual(f.list()[0].fiscal,{mode:'device',status:'blocked',reason:'coverage'});
  assert.equal((await f.call(issue(id))).error,'coverage');
  assert.equal(f.db.prepare('SELECT count(*) n FROM account_a_closes').get().n,0);
});
test('document warning is rejected when the printer date or authorization is stale',async t=>{
  let date='000000';
  const f=fixture(t,device(expected=>({status:'document-warning',saleDocument:expected.lastDocumentNumber,printerDocument:'0000023',deviceDate:date})));
  payment(f.db,1); const id=await f.closeDay();
  assert.equal((await f.call(issue(id))).error,'preflight');
  date=localDate(); const warning=await f.call(issue(id));
  assert.equal(warning.error,'document-warning');
  f.switchActor(3); assert.equal((await f.call({...issue(id),warningDocument:'0000023'})).ok,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n,0);
});
