const { removeFiscalSchemaSql } = require('./support/historical-database');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {markService}=require('../src/desktop/shifts');
const {textForJob}=require('../src/desktop/windows-test-printer');

test('saved shift reports preserve scopes and original snapshots through retry, day close and restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-s090-'));let db=openDatabase(dir),actor=1,handler,jobs=[],release;
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'),(2,'a',x'00',x'00'),(3,'b',x'00',x'00'),(4,'waiter',x'00',x'00');
 INSERT INTO user_permissions VALUES(1,'business_days.close'),(2,'employees.view'),(3,'employees.view'); INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B'),(4,'waiter');
 INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'sample');`);
 const register=()=>registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>actor,authenticatedUserId:()=>actor},job=>{jobs.push(job);return new Promise(resolve=>{release=resolve})});
 const call=req=>handler({},req);register(); db.exec('BEGIN IMMEDIATE');markService(db,1);const id=db.prepare('SELECT id FROM restaurant_shifts').get().id;
 db.exec("INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,2,100,'cash','B'); INSERT INTO payment_shifts VALUES(1,1); COMMIT");
 assert.equal(call({action:'shiftClose',shiftId:id}).ok,true); assert.equal(jobs.length,0);
 db.exec("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,3,'sample')");
 actor=2; assert.equal(call({action:'shiftList'}).data.shifts.find(s=>s.id===id).total,0);
 assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'a1',checked:false}).ok,false);
 assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'a1',checked:true}).ok,true);
 assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'a1',checked:true}).data.replayed,true);
 assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'a2',checked:true}).ok,false);
 assert.equal(call({action:'shiftPrintStatus',shiftId:id,requestId:'a1'}).data.result,'pending');
 await Promise.resolve(); assert.equal(jobs.length,1);assert.equal(jobs[0].snapshot.total,0);assert.equal(jobs[0].scope,'A');
 actor=3;assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'a1',checked:true}).ok,false);assert.equal(call({action:'shiftPrintStatus',shiftId:id,requestId:'a1'}).data.found,false);
 release('accepted');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'b1',checked:true}).ok,true);await Promise.resolve();assert.equal(jobs[1].snapshot.total,100);assert.equal(jobs[1].snapshot.cash,100);
 assert.match(textForJob(jobs[1]),/NON-FISCAL SHIFT REPORT/);assert.match(textForJob(jobs[1]),/100 MKD/);assert.doesNotMatch(textForJob(jobs[1]),/ACCOUNT A/);
 release('failed');await new Promise(resolve=>setImmediate(resolve));assert.equal(call({action:'shiftList'}).data.shifts.find(s=>s.id===id).printResult,'failed');
 actor=4;assert.equal(call({action:'shiftPrint',shiftId:id,requestId:'x',checked:true}).ok,false);
 actor=1;db.exec('BEGIN IMMEDIATE');markService(db,5);db.exec('COMMIT');const dayId=call({action:'list'}).data.days[0].id;assert.equal(call({action:'close',dayId}).ok,true);await Promise.resolve();assert.equal(jobs.filter(x=>x.destination==='turnover').length,1);assert.equal(jobs.filter(x=>x.destination==='shift-report').length,2);release('accepted');await new Promise(resolve=>setImmediate(resolve));
 const history=call({action:'shiftList'}).data.shifts;assert.equal(history.filter(s=>s.closedAt!==null).length,2);assert.equal(history.find(s=>s.id===id).total,100);
 db.close();db=openDatabase(dir);register();actor=3;assert.equal(call({action:'shiftList'}).data.shifts.find(s=>s.id===id).printResult,'failed');assert.equal(call({action:'shiftPrintStatus',shiftId:id,requestId:'b1'}).data.result,'failed');
});

test('an interrupted attempt is discoverable as uncertain after restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-s090-restart-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');");
 let handler;const register=()=>registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});register();db.exec('BEGIN IMMEDIATE');markService(db,1);db.exec('COMMIT');const id=handler({},{action:'shiftList'}).data.shifts[0].id;handler({},{action:'shiftClose',shiftId:id});db.prepare("INSERT INTO shift_print_attempts(shift_id,request_id,actor_id,scope,queue,started_at) VALUES(?,'lost',1,'combined','sample',1)").run(id);db.close();db=openDatabase(dir);register();
 assert.equal(handler({},{action:'shiftList'}).data.shifts.find(s=>s.id===id).printResult,'uncertain');assert.equal(handler({},{action:'shiftPrintStatus',shiftId:id,requestId:'lost'}).data.result,'uncertain');assert.equal(handler({},{action:'shiftPrint',shiftId:id,requestId:'lost',checked:true}).data.replayed,true);
});

test('populated version 39 shift close survives upgrade and prints its saved snapshot',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-s090-v39-'));let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');");
 let handler,jobs=[];const register=()=>registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1},job=>{jobs.push(job);return 'accepted'});register();db.exec('BEGIN IMMEDIATE');markService(db,1);db.exec('COMMIT');const shift=handler({},{action:'shiftList'}).data.shifts[0];assert.equal(handler({},{action:'shiftClose',shiftId:shift.id}).ok,true);const before=db.prepare('SELECT * FROM shift_closes').get();
 db.exec(removeFiscalSchemaSql + 'DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE shift_print_results; DROP TABLE shift_print_attempts; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=39');db.close();db=openDatabase(dir);register();assert.equal(db.prepare('PRAGMA user_version').get().user_version,45);assert.deepEqual(db.prepare('SELECT * FROM shift_closes').get(),before);assert.equal(handler({},{action:'shiftPrint',shiftId:shift.id,requestId:'upgraded',checked:true}).ok,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(jobs.length,1);assert.equal(jobs[0].snapshot.id,shift.id);assert.equal(jobs[0].snapshot.total,0);assert.equal(handler({},{action:'shiftList'}).data.shifts.find(s=>s.id===shift.id).printResult,'accepted');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
