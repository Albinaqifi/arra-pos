const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {randomBytes,randomInt,randomUUID}=require('node:crypto');
const {openDatabase}=require('../src/desktop/database');
const {seedSampleIdentities}=require('../src/desktop/sample-accounts');
const {seedTables}=require('../src/desktop/tables'); const {seedMenu}=require('../src/desktop/menu');
const {seedScenarios}=require('../src/desktop/seed-sample-scenarios');
const {registerSession}=require('../src/desktop/session');
const {registerAdminSentCorrection}=require('../src/desktop/admin-sent-correction');
const {registerBills}=require('../src/desktop/bills');
const {registerOrderHistory}=require('../src/desktop/order-history');
test('Combined alone can inspect and correct unbilled sent items with audited, retry-safe changes', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-admin-correction-')),db=openDatabase(dir); t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const passwords=Array.from({length:4},()=>randomBytes(24).toString('hex')), waiterPin=String(randomInt(10000)).padStart(4,'0'), transferPin=String(randomInt(1000000)).padStart(6,'0');
 seedSampleIdentities(db,passwords,waiterPin,transferPin); seedTables(db); seedMenu(db); seedScenarios(db);
 const handlers={},event={},ipc={handle:(name,fn)=>{handlers[name]=fn;}};const session=registerSession(ipc,e=>e===event,db);registerAdminSentCorrection(ipc,e=>e===event,db,session);registerBills(ipc,e=>e===event,db,session);registerOrderHistory(ipc,e=>e===event,db,session);
 const call=(name,req,sender=event)=>handlers['arra:'+name](sender,req), login=(name,password)=>call('sign-in',{username:name,password});
 for(const [name,pw] of [['sample-owner-a',passwords[1]],['sample-owner-b',passwords[2]]]) {assert.equal(login(name,pw).ok,true);assert.equal(call('admin-sent-correction',{action:'list'}).ok,false);}
 assert.equal(login('sample-restaurant',passwords[0]).ok,true);const staff=session.listWaiters().data;
 for(const user of staff) {assert.equal(session.selectWaiter({id:user.id,pin:user.isTransfer?transferPin:waiterPin}).ok,true);assert.equal(call('admin-sent-correction',{action:'list'}).ok,false);}
 assert.equal(login('sample-combined',passwords[3]).ok,true);assert.equal(call('admin-sent-correction',{action:'list'},{}).ok,false);
 const list=call('admin-sent-correction',{action:'list'});assert.equal(list.ok,true);assert.ok(list.data.items.length);const item=list.data.items[0];
 const unpaid=db.prepare('SELECT b.order_id AS id FROM bills b LEFT JOIN payments p ON p.bill_id=b.id WHERE p.id IS NULL LIMIT 1').get().id;
 for(const [name,pw] of [['sample-owner-a',passwords[1]],['sample-owner-b',passwords[2]]]) {login(name,pw);assert.equal(call('order-history',{orderId:item.orderId}).ok,false);assert.equal(call('order-history',{orderId:unpaid}).ok,true);assert.ok(!call('order-history',{orderId:null}).data.orders.some(o=>o.id===item.orderId));}
 login('sample-combined',passwords[3]);assert.equal(call('order-history',{orderId:item.orderId}).ok,true);
 assert.equal(db.prepare('SELECT count(*) AS n FROM bills WHERE order_id=?').get(item.orderId).n,0);
 const request={action:'correct',orderId:item.orderId,itemId:item.itemId,quantity:1,reason:'sample reason',requestId:randomUUID()};
 const billed=db.prepare("SELECT o.id AS orderId,i.id AS itemId FROM orders o JOIN bills b ON b.order_id=o.id JOIN order_items i ON i.order_id=o.id AND i.status='sent' LIMIT 1").get();
 assert.ok(billed); assert.equal(call('admin-sent-correction',{...request,...billed,requestId:randomUUID()}).ok,false);
 assert.equal(login('sample-owner-a',passwords[1]).ok,true); assert.equal(call('admin-sent-correction',request).ok,false);
 assert.equal(login('sample-combined',passwords[3]).ok,true);
 for(const bad of [{...request,quantity:0},{...request,reason:' '},{...request,quantity:item.remaining+1},{...request,extra:true}]) assert.equal(call('admin-sent-correction',bad).ok,false);
 assert.equal(call('admin-sent-correction',request).ok,true);assert.equal(call('admin-sent-correction',request).ok,true);assert.equal(call('admin-sent-correction',{...request,quantity:2}).ok,false);
 assert.equal(db.prepare('SELECT count(*) AS n FROM sent_item_corrections WHERE request_id=?').get(request.requestId).n,1);
 assert.equal(db.prepare("SELECT count(*) AS n FROM application_audit WHERE action='correct_sent' AND order_id=? AND actor_id=?").get(item.orderId,session.currentUserId()).n,1);
 db.prepare("DELETE FROM user_permissions WHERE user_id=? AND permission='orders.correct_sent'").run(session.currentUserId()); assert.equal(call('admin-sent-correction',{action:'list'}).ok,false);
});

test('upgrade preserves a previously revoked Combined correction grant', t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-correction-upgrade-'));let db=openDatabase(dir);
 const passwords=Array.from({length:4},()=>randomBytes(24).toString('hex'));
 seedSampleIdentities(db,passwords,String(randomInt(10000)).padStart(4,'0'),String(randomInt(1000000)).padStart(6,'0'));
 const actor=db.prepare("SELECT user_id AS id FROM financial_scopes WHERE scope='combined'").get().id;
 db.prepare("DELETE FROM user_permissions WHERE user_id=? AND permission='orders.correct_sent'").run(actor);
 db.exec('DROP TABLE order_cancellations; DROP TABLE restaurant_accounts; PRAGMA user_version=30');db.close();db=openDatabase(dir);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,32);
 assert.equal(db.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission='orders.correct_sent'").get(actor),undefined);
});

test('day warnings preserve counts and snapshots while hiding operational identifiers from owners A and B',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-warning-scope-')),db=openDatabase(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const passwords=Array.from({length:4},()=>randomBytes(24).toString('hex'));seedSampleIdentities(db,passwords,String(randomInt(10000)).padStart(4,'0'),String(randomInt(1000000)).padStart(6,'0'));seedTables(db);seedMenu(db);seedScenarios(db);
 const job=db.prepare('SELECT id FROM print_jobs LIMIT 1').get().id;
 const combined=db.prepare("SELECT user_id AS id FROM financial_scopes WHERE scope='combined'").get().id;
 db.prepare("INSERT INTO print_attempts(job_id,request_id,actor_id,occurred_at,result) VALUES(?,?,?,?,?)").run(job,randomUUID(),combined,Date.now(),'failed');
 const handlers={},event={},ipc={handle:(name,fn)=>handlers[name]=fn},session=registerSession(ipc,e=>e===event,db);
 require('../src/desktop/business-days').registerBusinessDays(ipc,e=>e===event,db,session,()=> 'failed');
 const call=(name,req)=>handlers['arra:'+name](event,req), login=(name,pw)=>call('sign-in',{username:name,password:pw});
 login('sample-combined',passwords[3]);let raw=call('business-days',{action:'list'}).data;assert.ok(raw.issues.orders.length);assert.ok(raw.issues.printJobs.length);assert.ok(raw.issues.orders[0].id);assert.ok(raw.issues.printJobs[0].id);
 for(const [name,pw] of [['sample-owner-a',passwords[1]],['sample-owner-b',passwords[2]]]){login(name,pw);const data=call('business-days',{action:'list'}).data;assert.equal(data.issues.orders.length,raw.issues.orders.length);assert.deepEqual(data.issues.orders[0],{});assert.equal(data.issues.printJobs[0].id,undefined);}
 login('sample-owner-a',passwords[1]);const day=raw.days.find(x=>x.closedAt===null).id,closed=call('business-days',{action:'close',dayId:day});assert.equal(closed.ok,true);assert.deepEqual(closed.data.issues.orders[0],{});
 login('sample-owner-b',passwords[2]);const historical=call('business-days',{action:'list'}).data.days.find(x=>x.id===day).issues;assert.deepEqual(historical.orders[0],{});assert.equal(historical.printJobs[0].id,undefined);
 login('sample-combined',passwords[3]);const full=call('business-days',{action:'list'}).data.days.find(x=>x.id===day).issues;assert.equal(JSON.stringify(full),JSON.stringify(raw.issues));
});
