const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {textForJob}=require('../src/desktop/windows-test-printer');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('close snapshots reconciled payments, protects reports and recovers uncertain print attempts',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-day-print-')); let db=openDatabase(dir);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'admin',x'01',x'01'),(2,'a',x'01',x'01'),(3,'b',x'01',x'01');
 INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'business_days.close'),(3,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B');
 UPDATE business_days SET opened_at=86300000 WHERE closed_at IS NULL;
 INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
 INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
 INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b');
 INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,86399999,100,'cash','B'),(2,1,86400001,200,'card','A');
 INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,86400002,'sample');`);
 let actor=1, handler, outcome='failed', calls=[]; const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
 function setup(){registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,session,job=>{calls.push(job);if(outcome==='uncertain') throw Error('unknown');return outcome;});}
 setup(); const call=req=>handler({},req); const day=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
 for(actor of [2,3]) {assert.equal(call({action:'close',dayId:day}).ok,false);assert.equal(call({action:'list'}).ok,false);assert.equal(call({action:'retry',dayId:day,requestId:'x',checked:true}).ok,false);assert.equal(call({action:'configure',queue:'Other'}).ok,false);}
 actor=1; assert.equal(call({action:'configure',queue:'bad\nqueue'}).ok,false); assert.equal(call({action:'configure',queue:'Local Printer'}).ok,true); assert.equal(call({action:'list'}).data.queue,'Local Printer'); assert.equal(db.prepare("SELECT queue FROM test_printer_queues WHERE destination='bill'").get().queue,'Arra Test Printer');
 assert.equal(call({action:'close',dayId:day}).ok,true); assert.equal(call({action:'close',dayId:day}).ok,false); await tick();
 assert.equal(calls.length,1); assert.equal(calls[0].queue,'Local Printer'); const report=calls[0].snapshot; assert.equal(report.openedAt,86300000); assert.ok(report.closedAt>86400001); assert.equal(report.total,300); assert.deepEqual(report.records.map(x=>[x.billId,x.tableId,x.account,x.amount]),[[1,1,'A',100],[2,2,'A',200]]);
 const output=textForJob(calls[0]); for(const value of ['NON-FISCAL','Bill #1','Bill #2','TOTAL: 300']) assert.ok(output.includes(value));
 assert.equal(call({action:'list'}).data.days.find(x=>x.id===day).printResult,'failed');
 assert.equal(call({action:'retry',dayId:day,requestId:'r1',checked:false}).ok,false);
 outcome='uncertain'; assert.equal(call({action:'retry',dayId:day,requestId:'r1',checked:true}).ok,true); await tick();
 assert.equal(call({action:'list'}).data.days.find(x=>x.id===day).printResult,'uncertain');
 db.close(); db=openDatabase(dir); setup(); assert.equal(call({action:'list'}).data.days.find(x=>x.id===day).printResult,'uncertain');
 outcome='accepted'; assert.equal(call({action:'retry',dayId:day,requestId:'r1',checked:true}).ok,true); await tick(); assert.equal(calls.length,2);
 assert.equal(call({action:'retry',dayId:day,requestId:'r2',checked:true}).ok,true); await tick(); assert.equal(calls.length,3); assert.deepEqual(calls[2].snapshot,report);
 assert.equal(call({action:'list'}).data.days.find(x=>x.id===day).printResult,'accepted'); assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,2); assert.equal(db.prepare('SELECT count(*) n FROM business_days').get().n,2);
 assert.throws(()=>db.prepare('UPDATE day_print_jobs SET snapshot=?').run('{}'));
});
