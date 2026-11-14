const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {textForJob}=require('../src/desktop/windows-test-printer');
const tick=()=>new Promise(r=>setImmediate(r));
for (const closer of ['A','B','combined']) test(`shared close by ${closer} scopes output and safely recovers`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-scoped-day-'));let db=openDatabase(dir),actor=1,calls=[],outcome='failed',handler;
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'01',x'01'),(2,'owner-a',x'01',x'01'),(3,'owner-b',x'01',x'01'),(4,'staff',x'01',x'01');
 INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B'),(4,'waiter');
 INSERT INTO user_permissions VALUES(1,'business_days.close'),(1,'employees.view'),(2,'employees.view'),(3,'employees.view'),(4,'business_days.close');
 UPDATE business_days SET opened_at=86300000 WHERE closed_at IS NULL;
 INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
 INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
 INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'x'),(2,2,1,1,200,'y'),(3,3,1,1,300,'z');
 INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,86399999,100,'cash','B'),(2,1,86400001,200,'card','A'),(3,1,86400002,300,'cash','B');
 INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,86400003,'sample');`);
 const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
 function setup(){registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,session,j=>{calls.push(j);if(outcome==='uncertain')throw Error('unknown');return outcome})}setup();
 const call=req=>handler({},req),day=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
 actor=4;assert.equal(call({action:'close',dayId:day}).ok,false); actor={A:2,B:3,combined:1}[closer];
 assert.equal(call({action:'list'}).ok,true);assert.equal(call({action:'close',dayId:day}).ok,true);assert.equal(call({action:'close',dayId:day}).ok,false); await tick();
 assert.equal(calls[0].scope,closer);assert.match(textForJob(calls[0]),closer==='combined'?/FULL REPORT - ACCOUNTS A AND B/:new RegExp('ACCOUNT '+closer+' REPORT ONLY'));assert.equal(calls[0].snapshot.total,closer==='combined'?600:300);assert.deepEqual(calls[0].snapshot.records.map(x=>x.billId),closer==='A'?[1,2]:closer==='B'?[3]:[1,2,3]);
 assert.equal(db.prepare('SELECT count(*) n FROM business_days').get().n,2); assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,3);
 actor=2;assert.equal(call({action:'configure',queue:'other'}).ok,false);let d=call({action:'list'}).data.days.find(x=>x.id===day);assert.equal(d.printAttempts,closer==='A'?1:0);
 outcome='uncertain';assert.equal(call({action:'retry',dayId:day,checked:true,requestId:'a1'}).ok,true);await tick();assert.deepEqual(calls.at(-1).snapshot.records.map(x=>x.billId),[1,2]);assert.equal(call({action:'list'}).data.days.find(x=>x.id===day).printResult,'uncertain');
 db.close();db=openDatabase(dir);setup();assert.equal(call({action:'list'}).data.days.find(x=>x.id===day).printResult,'uncertain');
 actor=3;assert.equal(call({action:'retry',dayId:day,checked:true,requestId:'a1'}).ok,false);assert.equal(call({action:'retry',dayId:day,checked:false,requestId:'b1'}).ok,false);outcome='accepted';assert.equal(call({action:'retry',dayId:day,checked:true,requestId:'b1'}).ok,true);await tick();assert.deepEqual(calls.at(-1).snapshot.records.map(x=>x.billId),[3]);
 actor=1;assert.equal(call({action:'retry',dayId:day,checked:true,requestId:'full1'}).ok,true);await tick();assert.deepEqual(calls.at(-1).snapshot.records.map(x=>x.billId),[1,2,3]);assert.equal(calls.at(-1).snapshot.total,600);
 assert.equal(db.prepare('SELECT count(*) n FROM day_print_jobs').get().n,1); assert.equal(db.prepare('SELECT count(*) n FROM payment_account_corrections').get().n,1);
});
test('v29 report and attempts survive upgrade and cannot expose a full report to an owner',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-v29-report-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'01',x'01'),(2,'owner-a',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'); INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'employees.view');`);
 const day=db.prepare('SELECT id FROM business_days').get().id;const snapshot=JSON.stringify({dayId:day,openedAt:1,closedAt:2,records:[{billId:1,account:'A',amount:10},{billId:2,account:'B',amount:20}],total:30});
 db.prepare('INSERT INTO day_print_jobs(day_id,snapshot,created_at) VALUES(?,?,?)').run(day,snapshot,2);db.exec(`DROP TABLE IF EXISTS order_cancellations; DROP TABLE IF EXISTS restaurant_accounts; INSERT INTO day_print_attempts(job_id,request_id,actor_id,queue,started_at,scope) VALUES(1,'old',1,'old queue',3,'combined'); INSERT INTO day_print_results VALUES(1,'failed',4); ALTER TABLE day_print_attempts DROP COLUMN scope; PRAGMA user_version=29;`);db.close();db=openDatabase(dir);
 assert.equal(db.prepare('SELECT snapshot FROM day_print_jobs').get().snapshot,snapshot);assert.equal(db.prepare('SELECT scope FROM day_print_attempts').get().scope,'combined');
 let handler,actor=2,calls=[];const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,session,j=>{calls.push(j);return 'accepted'});const call=r=>handler({},r);
 let data=call({action:'list'}).data.days.find(d=>d.id===day);assert.equal(data.printAttempts,0);assert.equal(data.printResult,null);
 assert.equal(call({action:'retry',dayId:day,requestId:'owner',checked:true}).ok,true);await tick();assert.equal(calls[0].snapshot.total,10);assert.deepEqual(calls[0].snapshot.records.map(r=>r.billId),[1]);
 actor=1;data=call({action:'list'}).data.days.find(d=>d.id===day);assert.equal(data.printResult,'failed');assert.equal(call({action:'retry',dayId:day,requestId:'full',checked:true}).ok,true);await tick();assert.deepEqual(calls[1].snapshot.records.map(r=>r.billId),[1,2]);assert.equal(db.prepare('SELECT snapshot FROM day_print_jobs').get().snapshot,snapshot);
});
test('empty reports clearly identify their scope',()=>{
 const snapshot={dayId:1,openedAt:1,closedAt:2,records:[],total:0};
 for(const scope of ['A','B','combined']) {
  const output=textForJob({destination:'turnover',scope,snapshot});
  if(scope==='combined') {assert.match(output,/FULL REPORT - ACCOUNTS A AND B/);assert.match(output,/No paid bills for accounts A and B/)}
  else {assert.match(output,new RegExp('ACCOUNT '+scope+' REPORT ONLY'));assert.match(output,new RegExp('No paid bills for account '+scope))}
 }
 assert.throws(()=>textForJob({destination:'turnover',snapshot}),/Invalid report scope/);
});
test('combined sees and retries owner failures on older days while owners cannot inspect or select other scopes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-oversee-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'01',x'01'),(2,'owner-a',x'01',x'01'),(3,'owner-b',x'01',x'01'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B'); INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'employees.view'),(3,'employees.view');`);
 let handler,actor=2,outcome='uncertain',calls=[];const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,session,j=>{calls.push(j);if(outcome==='uncertain')throw Error('unknown');return outcome});const call=r=>handler({},r);
 const first=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;assert.equal(call({action:'close',dayId:first}).ok,true);await tick();actor=3;outcome='failed';const second=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;assert.equal(call({action:'close',dayId:second}).ok,true);await tick();
 let d=call({action:'list'}).data.days.find(x=>x.id===first);assert.deepEqual(d.otherPrints,[]);assert.equal(d.printAttempts,0);assert.equal(call({action:'retry',dayId:first,requestId:'forbidden',checked:true,scope:'A'}).ok,false);
 actor=1;let days=call({action:'list'}).data.days;assert.deepEqual(days.find(x=>x.id===first).otherPrints,[{scope:'A',printAttempts:1,printResult:'uncertain'}]);assert.deepEqual(days.find(x=>x.id===second).otherPrints,[{scope:'B',printAttempts:1,printResult:'failed'}]);
 outcome='accepted';assert.equal(call({action:'retry',dayId:first,requestId:'retry-a',checked:true,scope:'A'}).ok,true);await tick();assert.equal(calls.at(-1).scope,'A');assert.equal(call({action:'list'}).data.days.find(x=>x.id===first).otherPrints[0].printResult,'accepted');
});
