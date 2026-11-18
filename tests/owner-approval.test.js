const {randomInt}=require('node:crypto');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../src/desktop/database'),{authorizedDatabase}=require('./support/authorized-database'),{seedTables}=require('../src/desktop/tables'),{seedMenu}=require('../src/desktop/menu'),{registerOrderItems}=require('../src/desktop/order-items'),{registerEmployeeConfig}=require('../src/desktop/employee-config');

test('owner PIN setup, late approval, persistent throttle and replay',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-owner-approval-'));let db=authorizedDatabase(openDatabase(dir));seedTables(db);seedMenu(db);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'combined-owner',x'00',x'00'); INSERT INTO financial_scopes(user_id,scope) VALUES(2,'combined'); INSERT INTO user_permissions(user_id,permission) VALUES(2,'orders.correct_sent'); INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open')");
 const pin=String(randomInt(0,1000000)).padStart(6,'0'),wrong=String((Number(pin)+1)%1000000).padStart(6,'0');
 let actor=2,handlers={};const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,invalidateUser:()=>{}};const register=()=>{handlers={};const ipc={handle:(c,f)=>handlers[c]=f};registerOrderItems(ipc,()=>true,db,session);registerEmployeeConfig(ipc,()=>true,db,session)};register();
 const call=(c,r)=>handlers[c]({},r),setup=pin=>call('arra:employee-config',{action:'ownApprovalPin',pin});
 assert.equal(setup('x').ok,false); assert.equal(setup(pin).ok,true); let row=db.prepare('SELECT pin_salt,pin_hash FROM local_users WHERE id=2').get();assert.ok(row.pin_hash&&row.pin_salt);assert.deepEqual(Object.keys(db.prepare('SELECT * FROM employee_credential_audit').get()).sort(),['actor_id','id','occurred_at','password_changed','pin_changed','target_id']);
 actor=1;assert.equal(setup(wrong).ok,false);
 let now=1000000;const old=Date.now;Date.now=()=>now;t.after(()=>Date.now=old);
 const items=r=>call('arra:order-items',r); assert.equal(items({action:'add',orderId:1,productId:'qebapa'}).ok,true);assert.equal(items({action:'send',orderId:1,requestId:'send'}).ok,true);let itemId=items({action:'list',orderId:1}).data.items[0].id;now=1120000;
 const req={action:'correct',orderId:1,itemId,quantity:1,reason:'Mistake',requestId:'late'};assert.equal(items(req).code,'window_expired');
 const authorize=pin=>call('arra:authorize-cancellation',{orderId:1,itemId,pin});
 db.exec("DELETE FROM user_permissions WHERE user_id=2 AND permission='orders.correct_sent'");assert.equal(authorize(pin).ok,false);db.exec("INSERT INTO user_permissions(user_id,permission) VALUES(2,'orders.correct_sent')");
 db.exec("UPDATE local_users SET active=0 WHERE id=2");assert.equal(authorize(pin).ok,false);db.exec("UPDATE local_users SET active=1 WHERE id=2");
 now+=60000;
 for(let i=0;i<3;i++) assert.equal(authorize(wrong).ok,false);
 db.close();db=openDatabase(dir);register();assert.equal(authorize(pin).ok,false);now+=60000;
 const approval=authorize(pin);assert.equal(approval.ok,true);
 assert.equal(items({...req,approvalToken:approval.token}).ok,true);
 const audit=db.prepare("SELECT * FROM application_audit WHERE action='correct_sent'").get();assert.equal(audit.actor_id,1);assert.equal(JSON.parse(audit.context).approvingOwnerId,2);assert.deepEqual(Object.keys(JSON.parse(audit.context)).sort(),['approvingOwnerId','correctionId','quantity','reason','source']);
 db.exec("UPDATE local_users SET active=0 WHERE id=2");assert.equal(items(req).ok,true);assert.equal(items({...req,reason:'Changed'}).code,'invalid_input');assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM cancellation_notice_jobs').get().n,1);
});

test('lost PIN setup reply clears administrator identity after the service commits',async t=>{
 const vm=require('node:vm'),pin=String(randomInt(0,1000000)).padStart(6,'0');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-owner-lost-'));const db=authorizedDatabase(openDatabase(dir));t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'combined-owner',x'00',x'00'); INSERT INTO financial_scopes(user_id,scope) VALUES(2,'combined'); INSERT INTO user_permissions(user_id,permission) VALUES(2,'orders.correct_sent')");
 let actor=2,handler,api;const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,invalidateUser:()=>{actor=null}};registerEmployeeConfig({handle:(_,f)=>handler=f},()=>true,db,session);
 const ipcRenderer={invoke:async(_channel,req)=>{const result=handler({},JSON.parse(JSON.stringify(req)));assert.equal(result.ok,true);throw Error('reply lost')}};
 vm.runInNewContext(fs.readFileSync('src/desktop/preload.js','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,v)=>api=v},ipcRenderer})});
 class Component{constructor(props){this.props=props}setState(p){Object.assign(this.state,p)}};let refreshes=0;
 const window={confirm:()=>true,arra:api},context={React:{Component,createElement(){}},window,TextEncoder};vm.runInNewContext(require('./support/admin-bundle')(),context);
 const page=new context.ArraComponents.AdminSentCorrections({language:'en',onAccessChanged:async()=>{refreshes++;return actor!==null}}),input={value:pin};await page.setOwnerPin({preventDefault(){},currentTarget:{elements:{pin:input}}});
 assert.equal(input.value,'');assert.equal(refreshes,1);assert.equal(actor,null);assert.ok(db.prepare('SELECT pin_hash FROM local_users WHERE id=2').get().pin_hash);assert.equal(db.prepare('SELECT count(*) n FROM employee_credential_audit').get().n,1);
});

test('real session requires an authenticated privileged Combined owner for setup and reset',t=>{
 const {bootstrap,createSession,hashPassword}=require('../src/desktop/session');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-owner-session-')),db=openDatabase(dir);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 const password=require('node:crypto').randomBytes(16).toString('hex');
 const first=String(randomInt(0,1000000)).padStart(6,'0'),second=String((Number(first)+1)%1000000).padStart(6,'0');
 bootstrap(db,'owner',password);const session=createSession(db);let handler;
 registerEmployeeConfig({handle:(_,f)=>handler=f},()=>true,db,session);
 const setup=pin=>handler({},{action:'ownApprovalPin',pin});
 assert.equal(db.prepare('SELECT pin_hash FROM local_users WHERE id=1').get().pin_hash,null);
 assert.equal(setup(first).ok,false);
 assert.equal(session.signIn({username:'owner',password}).ok,true);
 db.exec("UPDATE financial_scopes SET scope='A' WHERE user_id=1");assert.equal(setup(first).ok,false);
 db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=1; DELETE FROM user_permissions WHERE user_id=1 AND permission='orders.correct_sent'");assert.equal(setup(first).ok,false);
 db.exec("INSERT INTO user_permissions VALUES(1,'orders.correct_sent')");assert.equal(setup(first).ok,true);
 assert.equal(session.currentUserId(),null);assert.equal(setup(second).ok,false);
 assert.equal(session.signIn({username:'owner',password}).ok,true);assert.equal(setup(second).ok,true);
 assert.equal(session.currentUserId(),null);
 const row=db.prepare('SELECT pin_salt,pin_hash FROM local_users WHERE id=1').get();
 assert.deepEqual(hashPassword(second,row.pin_salt),Buffer.from(row.pin_hash));
 assert.notDeepEqual(hashPassword(first,row.pin_salt),Buffer.from(row.pin_hash));
 assert.equal(db.prepare('SELECT count(*) n FROM employee_credential_audit').get().n,2);
});

test('late approval rolls back on audit failure and never corrects a billed order',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-owner-rollback-')),db=authorizedDatabase(openDatabase(dir));
 seedTables(db);seedMenu(db);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'owner',x'00',x'00'); INSERT INTO financial_scopes VALUES(2,'combined'); INSERT INTO user_permissions VALUES(2,'orders.correct_sent'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'qebapa','Sample',10,2,'sent'); INSERT INTO preparation_rounds(id,order_id,request_id,number,actor_id,sent_at,table_id) VALUES(1,1,'send',1,1,1,1); INSERT INTO preparation_tickets(id,round_id,destination,adapter) VALUES(1,1,'kitchen','simulated'); INSERT INTO preparation_ticket_items VALUES(1,1,2)");
 let actor=2,handlers={};const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,invalidateUser:()=>{}};
 const ipc={handle:(c,f)=>handlers[c]=f};registerOrderItems(ipc,()=>true,db,session);registerEmployeeConfig(ipc,()=>true,db,session);
 const pin=String(randomInt(0,1000000)).padStart(6,'0');assert.equal(handlers['arra:employee-config']({},{action:'ownApprovalPin',pin}).ok,true);actor=1;
 const approval=handlers['arra:authorize-cancellation']({},{orderId:1,itemId:1,pin});assert.equal(approval.ok,true);
 const req={action:'correct',orderId:1,itemId:1,quantity:1,reason:'Sample',requestId:'late',approvalToken:approval.token};
 const call=()=>handlers['arra:order-items']({},req);
 db.exec("CREATE TRIGGER fail_late_audit BEFORE INSERT ON application_audit WHEN NEW.action='correct_sent' BEGIN SELECT RAISE(ABORT,'failure'); END");
 assert.equal(call().ok,false);assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM cancellation_notice_jobs').get().n,0);
 db.exec("DROP TRIGGER fail_late_audit; INSERT INTO bills(order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,20,'sample')");
 assert.equal(call().code,'already_billed');assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,0);
});

test('approval is one-use, scoped to identity and item, expires and rejects ambiguous or revoked owners',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-owner-token-')),db=authorizedDatabase(openDatabase(dir));seedTables(db);seedMenu(db);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})});
 db.exec("INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'owner',x'00',x'00'); INSERT INTO financial_scopes VALUES(2,'combined'); INSERT INTO user_permissions VALUES(2,'orders.correct_sent'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'qebapa','Sample',10,3,'sent'),(2,1,'qebapa','Sample',10,1,'sent'); INSERT INTO preparation_rounds(id,order_id,request_id,number,actor_id,sent_at,table_id) VALUES(1,1,'send',1,1,1000000,1); INSERT INTO preparation_tickets(id,round_id,destination,adapter) VALUES(1,1,'kitchen','simulated'); INSERT INTO preparation_ticket_items VALUES(1,1,3),(1,2,1)");
 const pin=String(randomInt(0,1000000)).padStart(6,'0');let actor=2,gen=1,handlers={};const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>gen,invalidateUser:()=>{}};const ipc={handle:(c,f)=>handlers[c]=f};registerOrderItems(ipc,event=>!event.denied,db,session);registerEmployeeConfig(ipc,()=>true,db,session);assert.equal(handlers['arra:employee-config']({},{action:'ownApprovalPin',pin}).ok,true);actor=1;
 const original=Date.now, perf=require('node:perf_hooks').performance;let now=1120000, tick=1000;Date.now=()=>now;Object.defineProperty(perf,'now',{value:()=>tick,configurable:true});t.after(()=>{Date.now=original;delete perf.now;});
 const authorize=()=>handlers['arra:authorize-cancellation']({},{orderId:1,itemId:1,pin}),correct=(token,itemId=1,requestId='correct')=>handlers['arra:order-items']({},{action:'correct',orderId:1,itemId,quantity:1,reason:'Sample',requestId,approvalToken:token});
 assert.equal(handlers['arra:authorize-cancellation']({denied:true},{orderId:1,itemId:1,pin}).ok,false);
 assert.equal(handlers['arra:authorize-cancellation']({},{orderId:1,itemId:1,pin,extra:true}).ok,false);
 db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='orders.change'");assert.equal(authorize().ok,false);
 db.exec("INSERT INTO user_permissions VALUES(1,'orders.change')");
 let approval=authorize();assert.equal(approval.ok,true);now=1119999;assert.equal(correct(approval.token).code,'invalid_input');now=1120000;assert.equal(correct(approval.token,2).code,'window_expired');gen++;assert.equal(correct(approval.token).code,'window_expired');
 approval=authorize();assert.equal(handlers['arra:revoke-cancellation-approval']({},{token:approval.token}).ok,true);assert.equal(handlers['arra:revoke-cancellation-approval']({},{token:approval.token}).ok,true);assert.equal(correct(approval.token).code,'window_expired');
 approval=authorize();db.exec("DELETE FROM user_permissions WHERE user_id=2 AND permission='orders.correct_sent'");assert.equal(correct(approval.token).code,'window_expired');db.exec("INSERT INTO user_permissions VALUES(2,'orders.correct_sent')");
 approval=authorize();db.exec("UPDATE local_users SET active=0 WHERE id=2");assert.equal(correct(approval.token).code,'window_expired');db.exec("UPDATE local_users SET active=1 WHERE id=2");
 approval=authorize();db.exec("UPDATE local_users SET pin_hash=x'00' WHERE id=2");assert.equal(correct(approval.token).code,'window_expired');actor=2;assert.equal(handlers['arra:employee-config']({},{action:'ownApprovalPin',pin}).ok,true);actor=1;
 approval=authorize();now+=120000;assert.equal(correct(approval.token).code,'window_expired');
 approval=authorize();tick+=120000;assert.equal(correct(approval.token).code,'window_expired');
 approval=authorize();db.exec("CREATE TRIGGER fail_owner_token_audit BEFORE INSERT ON application_audit WHEN NEW.action='correct_sent' BEGIN SELECT RAISE(ABORT,'failure'); END");assert.equal(correct(approval.token).ok,false);db.exec('DROP TRIGGER fail_owner_token_audit');assert.equal(correct(approval.token,1,'different').code,'window_expired');assert.equal(correct(approval.token).ok,true);assert.equal(correct(approval.token,1,'new').code,'window_expired');
 const prior=handlers['arra:order-items']({},{action:'correct',orderId:1,itemId:1,quantity:1,reason:'Sample',requestId:'correct'});assert.equal(prior.ok,true);
 db.exec("INSERT INTO local_users(id,username,salt,password_hash,pin_salt,pin_hash) SELECT 3,'other-owner',salt,password_hash,pin_salt,pin_hash FROM local_users WHERE id=2; INSERT INTO financial_scopes VALUES(3,'combined'); INSERT INTO user_permissions VALUES(3,'orders.correct_sent')");assert.equal(authorize().ok,false);assert.equal(db.prepare('SELECT count(*) n FROM sent_item_corrections').get().n,1);
});
