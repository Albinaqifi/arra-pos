const { removeFiscalSchemaSql } = require('./support/historical-database');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerBusinessDays}=require('../src/desktop/business-days');
const {registerPayments}=require('../src/desktop/payments');
const {markService}=require('../src/desktop/shifts');

test('handover snapshots are scoped and immutable; payment replay and day close preserve boundaries', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-')); let db=openDatabase(dir), actor=1, days, pay;
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const register=()=>{const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};registerBusinessDays({handle:(_,fn)=>days=fn},()=>true,db,session); registerPayments({handle:(_,fn)=>pay=fn},()=>true,db,session);}; register();
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'),(2,'a',x'00',x'00'),(3,'b',x'00',x'00'),(4,'waiter',x'00',x'00');
 INSERT INTO user_permissions VALUES(1,'business_days.close'),(1,'orders.view'),(1,'orders.change'),(2,'employees.view'),(3,'employees.view'),(4,'orders.view'),(4,'orders.change');
 INSERT INTO financial_scopes VALUES(1,'combined'),(2,'A'),(3,'B'),(4,'waiter');
 INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample'),(3,'sample');
 INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open'); INSERT INTO order_waiter_ownership SELECT id,4,4,1,'open' FROM orders WHERE id NOT IN (SELECT order_id FROM order_waiter_ownership);
 INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'one'),(2,2,1,1,200,'two'),(3,3,1,1,300,'three');`);
 const call=req=>days({},req), payment=req=>{const previous=actor; actor=4; try { return pay({},req); } finally { actor=previous; }};
 assert.equal(call({action:'shiftList'}).data.shifts.length,0);
 db.exec('BEGIN IMMEDIATE'); markService(db,Date.now()); db.exec('COMMIT');
 let shift=call({action:'shiftList'}).data.shifts[0]; assert.equal(shift.reportable,true); assert.equal(shift.total,0);
 assert.equal(payment({billId:1,method:'cash',account:'B'}).ok,true);
 const first=call({action:'shiftClose',shiftId:shift.id}); assert.equal(first.ok,true); assert.equal(first.data.shift.total,100); assert.equal(first.data.shift.cash,100);
 assert.equal(payment({billId:1,method:'cash',account:'B'}).ok,true);
 let list=call({action:'shiftList'}).data.shifts; assert.equal(list.length,2); assert.equal(list[0].reportable,false);
 assert.equal(call({action:'shiftClose',shiftId:list[0].id}).ok,false);
 assert.equal(call({action:'shiftClose',shiftId:shift.id}).data.replayed,true); assert.equal(call({action:'shiftList'}).data.shifts.length,2);
 db.prepare("INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,?,'sample')").run(Date.now());
 actor=2; let a=call({action:'shiftList'}).data.shifts.find(s=>s.id===shift.id); assert.equal(a.total,0); assert.equal(call({action:'shiftClose',shiftId:shift.id}).data.shift.total,0);
 actor=3; let b=call({action:'shiftList'}).data.shifts.find(s=>s.id===shift.id); assert.equal(b.total,100);
 actor=4; assert.equal(call({action:'shiftList'}).ok,false);
 actor=1; assert.equal(payment({billId:2,method:'card',account:'A'}).ok,true);
 const second=call({action:'shiftList'}).data.shifts[0]; assert.equal(second.reportable,true); assert.equal(second.total,200); assert.equal(second.card,200);
 const dayId=call({action:'list'}).data.days[0].id;
 db.exec("CREATE TRIGGER fail_shift_day BEFORE INSERT ON application_audit WHEN NEW.entity_type='business_day' BEGIN SELECT RAISE(ABORT,'sample'); END");
 assert.equal(call({action:'close',dayId}).ok,false); assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes').get().n,1);
 db.exec('DROP TRIGGER fail_shift_day'); assert.equal(call({action:'close',dayId}).ok,true);
 assert.equal(call({action:'close',dayId}).ok,false); assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes').get().n,2);
 const report=JSON.parse(db.prepare('SELECT snapshot FROM day_print_jobs WHERE day_id=?').get(dayId).snapshot); assert.equal(report.total,300); assert.deepEqual(report.records.map(r=>r.account),['A','A']);
 db.close(); db=openDatabase(dir); register(); assert.equal(call({action:'shiftClose',shiftId:shift.id}).data.replayed,true); assert.equal(call({action:'shiftList'}).data.shifts.length,2);
 assert.equal(payment({billId:3,method:'cash',account:'A'}).ok,true); assert.equal(call({action:'shiftList'}).data.shifts[0].total,300);
});

test('an idle successor is not finalized at day close',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-idle-')), db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');");
 let handler;registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1}); const call=req=>handler({},req);
 db.exec('BEGIN IMMEDIATE');markService(db,1);db.exec('COMMIT'); const shift=call({action:'shiftList'}).data.shifts[0];
 assert.equal(call({action:'shiftClose',shiftId:shift.id}).ok,true);const dayId=call({action:'list'}).data.days[0].id;assert.equal(call({action:'close',dayId}).ok,true);
 assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes').get().n,1);
});

test('upgrade marks an already used day unavailable and starts tracking on the next day',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-upgrade-')); let db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec(removeFiscalSchemaSql + `INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');
 INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,context) VALUES(1,unixepoch()*1000+1000,'add','order_item','1','{}');
 DROP TABLE IF EXISTS order_waiter_ownership; DROP TABLE IF EXISTS legacy_unassigned_orders; DROP TABLE IF EXISTS wallet_cancellations; DROP TABLE IF EXISTS wallet_prepared; DROP TABLE IF EXISTS wallet_requests; DROP TABLE IF EXISTS wallet_closings; DROP TABLE IF EXISTS wallet_movements; DROP TABLE IF EXISTS wallet_baselines; DROP TABLE IF EXISTS shift_print_results; DROP TABLE IF EXISTS shift_print_attempts; DROP TABLE payment_shifts; DROP TABLE shift_closes; DROP TABLE restaurant_shifts; DROP TABLE shift_coverage_unavailable; DROP TABLE IF EXISTS verified_waiter_pins; PRAGMA user_version=38;`);
 db.close();db=openDatabase(dir);let handler;registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});const call=req=>handler({},req);
 assert.equal(call({action:'shiftList'}).data.coverage,'unavailable');db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');assert.equal(call({action:'shiftList'}).data.shifts.length,0);
 const dayId=call({action:'list'}).data.days[0].id; assert.equal(call({action:'close',dayId}).ok,true);assert.equal(call({action:'shiftList'}).data.coverage,'available');
 db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');assert.equal(call({action:'shiftList'}).data.shifts.length,1);
});

test('successive handovers cross midnight without closing the business day',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-midnight-')); const db=openDatabase(dir);const originalNow=Date.now;
 t.after(()=>{Date.now=originalNow;db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');");
 let handler;registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>1,authenticatedUserId:()=>1});const call=req=>handler({},req);
 Date.now=()=>Date.parse('2026-11-18T20:00:00Z');db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');let first=call({action:'shiftList'}).data.shifts[0];
 Date.now=()=>Date.parse('2026-11-18T22:00:00Z');assert.equal(call({action:'shiftClose',shiftId:first.id}).ok,true);let second=call({action:'shiftList'}).data.shifts[0];assert.equal(second.openedAt,Date.now());
 db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');Date.now=()=>Date.parse('2026-11-19T01:00:00Z');assert.equal(call({action:'shiftClose',shiftId:second.id}).ok,true);assert.equal(call({action:'shiftClose',shiftId:first.id}).data.replayed,true);
 let list=call({action:'shiftList'}).data;assert.equal(list.shifts.length,3);assert.equal(list.shifts.find(x=>x.id===second.id).closedAt,Date.now());assert.equal(list.shifts[0].reportable,false);
 const dayId=list.dayId;assert.equal(call({action:'close',dayId}).ok,true);assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes').get().n,2);
});

test('a competing write cannot close or rotate a locked shift',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-lock-')), db=openDatabase(dir), other=openDatabase(dir);t.after(()=>{other.close();db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'combined',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');");
 let handler;registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,other,{currentUserId:()=>1,authenticatedUserId:()=>1});const call=req=>handler({},req);
 db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');const shift=call({action:'shiftList'}).data.shifts[0];
 db.exec('BEGIN IMMEDIATE'); assert.equal(call({action:'shiftClose',shiftId:shift.id}).ok,false);assert.equal(db.prepare('SELECT count(*) AS n FROM shift_closes').get().n,0);db.exec('COMMIT');
 assert.equal(call({action:'shiftClose',shiftId:shift.id}).ok,true);assert.equal(call({action:'shiftClose',shiftId:shift.id}).data.replayed,true);assert.equal(db.prepare('SELECT count(*) AS n FROM restaurant_shifts').get().n,2);
});

test('A and B owners can hand over with only their scoped totals and grants',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-shift-owner-')); const db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'a',x'00',x'00'),(2,'b',x'00',x'00'); INSERT INTO user_permissions VALUES(1,'employees.view'),(2,'employees.view'); INSERT INTO financial_scopes VALUES(1,'A'),(2,'B');`);
 let actor=1,handler;registerBusinessDays({handle:(_,fn)=>handler=fn},()=>true,db,{currentUserId:()=>actor,authenticatedUserId:()=>actor});const call=req=>handler({},req);
 db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');let shift=call({action:'shiftList'}).data.shifts[0];assert.equal(call({action:'shiftClose',shiftId:shift.id}).ok,true);
 db.exec('BEGIN IMMEDIATE');markService(db,Date.now());db.exec('COMMIT');actor=2;shift=call({action:'shiftList'}).data.shifts[0];assert.equal(call({action:'shiftClose',shiftId:shift.id}).ok,true);
 db.exec("DELETE FROM user_permissions WHERE user_id=2 AND permission='employees.view'");assert.equal(call({action:'shiftList'}).ok,false);assert.equal(call({action:'shiftClose',shiftId:shift.id}).ok,false);
});
