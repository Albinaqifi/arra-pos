const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {authorizedDatabase} = require('./support/authorized-database');
const {seedTables} = require('../src/desktop/tables');
const {seedArraMenu} = require('../src/desktop/arra-menu');
const {registerOrderItems} = require('../src/desktop/order-items');
const {registerBills} = require('../src/desktop/bills');
const {registerPayments} = require('../src/desktop/payments');
const {createTrainingPf700} = require('../src/desktop/training-pf700');

test('another authorized waiter cannot inspect or finish a held sample checkout', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s096-access-'));
  const db = authorizedDatabase(openDatabase(dir));
  t.after(() => { db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'sample-other',x'01',x'01');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');
    INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1);`);
  let actor = 1;
  const session = {currentUserId:()=>actor, authenticatedUserId:()=>actor, identityGeneration:()=>actor};
  const handlers = {}, ipc = {handle:(channel,fn)=>{handlers[channel]=fn;}};
  const adapter = createTrainingPf700(dir);
  registerOrderItems(ipc,()=>true,db,session); registerBills(ipc,()=>true,db,session,adapter);
  registerPayments(ipc,()=>true,db,session,null,adapter);
  const call = (channel,request)=>handlers[channel]({},request);
  assert.equal(call('arra:order-items',{action:'add',orderId:1,productId:'arra-product-11-0',optionIds:[]}).ok,true);
  assert.equal(call('arra:order-items',{action:'send',orderId:1,requestId:'sample-send'}).ok,true);
  const review = call('arra:bill',{action:'review',orderId:1});
  const bill = call('arra:bill',{action:'generate',orderId:1,fingerprint:review.data.fingerprint}).data;
  const req = {billId:bill.id,method:'cash',account:'A'};
  const intent = call('arra:payment',{...req,prepareSimulatedCash:'after_tender'}).data.intentId;
  assert.equal((await call('arra:payment',{...req,intentId:intent,simulateInterrupt:'after_tender'})).fiscalStatus,'uncertain');
  actor = 2;
  for (const command of [{checkSimulated:true},{finishSimulated:true},{}]) {
    assert.equal(call('arra:payment',{...req,...command}).ok,false);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
  actor = 1;
  assert.equal(call('arra:payment',{...req,finishSimulated:true}).ok,true);
  assert.equal(db.prepare('SELECT actor_id FROM payments').get().actor_id,1);
  assert.equal(db.prepare("SELECT actor_id FROM application_audit WHERE action='recover' AND entity_type='simulated_fiscal_checkout'").get().actor_id,1);
});
