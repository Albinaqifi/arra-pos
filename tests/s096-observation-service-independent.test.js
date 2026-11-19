const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {randomInt}=require('node:crypto');
const {openDatabase}=require('../src/desktop/database');
const {authorizedDatabase}=require('./support/authorized-database');
const {createStatefulPf700}=require('./support/pf700-stateful-device');
const {createWindowsPf700Checkout}=require('../src/desktop/pf700-windows-checkout');
const {enroll}=require('../src/desktop/pf700-commissioning');
const {seedTables}=require('../src/desktop/tables');
const {seedArraMenu}=require('../src/desktop/arra-menu');
const {registerOrderItems}=require('../src/desktop/order-items');
const {registerBills}=require('../src/desktop/bills');
const {registerPayments}=require('../src/desktop/payments');

function fixture(t,{ack=true,onsite=true,busy=false}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-s096-observe-'));
  const db=authorizedDatabase(openDatabase(dir)), device=createStatefulPf700();
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  enroll(db); seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'other',x'00',x'00');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');`);
  let actor=1,generation=0,held=busy,opens=0,hook=null;
  const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>generation};
  const trusted={},handlers={},ipc={handle:(key,fn)=>handlers[key]=fn};
  const start=()=>{
    const child=new EventEmitter(); child.stdout=new PassThrough(); let mine=false,ended=false;
    const finish=()=>{if(ended)return;ended=true;if(mine)held=false;child.stdout.end();setImmediate(()=>child.emit('close',0));};
    child.stdin=new Writable({write(bytes,encoding,callback){
      const line=bytes.toString().trim();
      try {
        if(line==='OPEN') {opens++;if(held)throw Error('busy');held=true;mine=true;if(hook)hook();child.stdout.write('READY\r\n');}
        else {if(!mine)throw Error('not reserved');assert.equal(db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,1,'seal must precede every observation wire command');child.stdout.write(device.exchange(Buffer.from(line,'hex')).toString('hex').toUpperCase()+'\r\n');}
      } catch {finish();} callback();
    },final(callback){finish();callback();}}); child.kill=finish; return child;
  };
  const adapter=createWindowsPf700Checkout({expectedSerial:device.serial,operatorNumber:2,operatorPassword:String(randomInt(100000,1000000)),tillNumber:1,domesticProduct:false},start);
  registerOrderItems(ipc,e=>e===trusted,db,session); registerBills(ipc,e=>e===trusted,db,session,adapter); registerPayments(ipc,e=>e===trusted,db,session,null,adapter);
  const items=r=>handlers['arra:order-items'](trusted,r), bills=r=>handlers['arra:bill'](trusted,r);
  const pay=r=>handlers['arra:payment'](trusted,r);
  assert.equal(items({action:'add',orderId:1,productId:'arra-product-11-0'}).ok,true);
  assert.equal(items({action:'send',orderId:1,requestId:'sample'}).ok,true);
  const review=bills({action:'review',orderId:1}); const bill=bills({action:'generate',orderId:1,fingerprint:review.data.fingerprint});
  const req={billId:bill.data.id,method:'cash',account:'A'};
  const intent=pay({...req,preparePhysicalCash:true}).data.intentId;
  db.prepare(`INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
    SELECT bill_id,actor_id,'device',device_id,'cash',receipt,created_at FROM pf700_cash_intents WHERE id=?`).run(intent);
  const attempt=db.prepare('INSERT INTO fiscal_checkout_attempts(bill_id,started_at) VALUES(?,1)').run(req.billId).lastInsertRowid;
  db.prepare('INSERT INTO pf700_cash_dispatches VALUES(?,?,1)').run(attempt,intent);
  const command=db.prepare('INSERT INTO pf700_command_intents(attempt_id,sequence,command,request_hash,created_at) VALUES(?,32,90,?,1)').run(attempt,'a'.repeat(64)).lastInsertRowid;
  if(ack)db.prepare('INSERT INTO pf700_command_acks VALUES(?,?,?,1)').run(command,'b'.repeat(64),JSON.stringify({identityMatched:true,onsiteFirmware:onsite}));
  return {db,device,req,attempt,pay,adapter,get opens(){return opens;},setHook(fn){hook=fn;},switchActor(id){actor=id;generation++;},inspect(){return pay({...req,inspectPhysicalCash:true,checkedNoOtherActivity:true});}};
}
const windows={skip:process.platform!=='win32'};
test('trusted inspection seals after exclusive acquire, before any wire inquiry, and blocks delayed sender',windows,async t=>{
  const f=fixture(t);
  f.setHook(()=>{assert.equal(f.device.transcript.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,0);});
  const result=await f.inspect(); assert.equal(result.ok,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,1);
  assert.deepEqual(f.device.transcript.map(x=>x.command),[90,90,76,113]);
  assert.throws(()=>f.db.prepare('INSERT INTO pf700_command_intents(attempt_id,sequence,command,request_hash,created_at) VALUES(?,33,53,?,1)').run(f.attempt,'c'.repeat(64)),/Invalid PF700 command intent/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
});
test('unacknowledged and legacy attempts, busy port and unauthorized waiter send no inquiries or seals',windows,async t=>{
  for(const options of [{ack:false},{onsite:false},{busy:true},{}]) await t.test(JSON.stringify(options),async t=>{
    const f=fixture(t,options); if(!Object.keys(options).length)f.switchActor(2);
    const result=await f.inspect(); assert.equal(result.ok,false);
    assert.equal(f.device.transcript.length,0); assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,0);
    assert.equal(f.opens,options.busy?1:0);
  });
});
test('identity switch while port is being acquired prevents sealing or observing',windows,async t=>{
  const f=fixture(t); f.setHook(()=>f.switchActor(2));
  assert.equal((await f.inspect()).ok,false); assert.equal(f.device.transcript.length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,0);
  assert.ok(await f.adapter.acquireCashObservation().then(async h=>{if(h)await h.close();return h;}));
});
test('a sender reserving a command during port acquisition invalidates the candidate before seal',windows,async t=>{
  const f=fixture(t);
  f.setHook(()=>f.db.prepare('INSERT INTO pf700_command_intents(attempt_id,sequence,command,request_hash,created_at) VALUES(?,33,76,?,1)').run(f.attempt,'c'.repeat(64)));
  assert.equal((await f.inspect()).ok,false);
  assert.equal(f.device.transcript.length,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,0);
});
test('lost inquiry reply keeps the seal and never settles or resends a sale',windows,async t=>{
  const f=fixture(t); f.device.fault(90,'after');
  assert.equal((await f.inspect()).ok,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,1);
  assert.deepEqual(f.device.transcript.map(row=>row.command),[90]);
  assert.equal((await f.pay(f.req)).ok,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
  assert.deepEqual(f.device.transcript.map(row=>row.command),[90]);
});
test('identity change during inquiry discards the stale response',windows,async t=>{
  const f=fixture(t), exchange=f.device.exchange;
  f.device.exchange=frame=>{const result=exchange(frame);if(frame[3]===113)f.switchActor(2);return result;};
  const result=await f.inspect(); assert.equal(result.ok,false); assert.equal(result.error,'Access denied');
  assert.equal(f.db.prepare('SELECT count(*) n FROM pf700_command_seals').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM payments').get().n,0);
});
