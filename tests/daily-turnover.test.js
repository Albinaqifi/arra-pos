const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {openDatabase}=require('../src/desktop/database');
const {registerFinancialVisibility}=require('../src/desktop/financial-visibility');
const {registerBusinessDays}=require('../src/desktop/business-days');
test('turnover follows a manual day across midnight and survives close and restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-turnover-')); let db=openDatabase(dir);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01');
 INSERT INTO user_permissions VALUES(1,'employees.view'),(1,'business_days.close'); INSERT INTO financial_scopes VALUES(1,'combined');
 INSERT INTO dining_tables(id,area) VALUES(1,'sample'),(2,'sample');
 INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open');
 INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,100,'a'),(2,2,1,1,200,'b');
 INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,86399999,100,'cash','B'),(2,1,86400001,200,'card','A');
 INSERT INTO payment_account_corrections(payment_id,actor_id,occurred_at,reason) VALUES(1,1,86400002,'sample');`);
 let handlers={}; const session={currentUserId:()=>1,authenticatedUserId:()=>1};
 function register(){handlers={};const ipc={handle:(name,fn)=>handlers[name]=fn};registerFinancialVisibility(ipc,()=>true,db,session);registerBusinessDays(ipc,()=>true,db,session);}
 register(); const call=(name,req)=>handlers[name]({},req); const day=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
 const request={action:'report',from:null,to:null,dayId:day,account:null,method:null};
 const before=call('arra:financial-visibility',request).data; assert.equal(before.records.length,2); assert.equal(before.groups.reduce((n,g)=>n+g.total,0),300); assert.equal(before.corrections.length,1);
 assert.equal(call('arra:business-days',{action:'close',dayId:day}).ok,true); assert.equal(call('arra:business-days',{action:'close',dayId:day}).ok,false);
 const next=db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id; assert.notEqual(day,next); assert.deepEqual(call('arra:financial-visibility',{...request,dayId:next}).data.records,[]);
 db.close();db=openDatabase(dir);register();assert.deepEqual(call('arra:financial-visibility',request).data,before); assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,2);
});
