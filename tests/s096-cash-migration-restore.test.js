const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { historicalDatabase } = require('./support/historical-database');
const { authorizedDatabase } = require('./support/authorized-database');
const { createBackup, restoreBackup } = require('../src/desktop/backup');
const { readFiscalCheckout } = require('../src/desktop/fiscal-checkout');
const { createTrainingPf700 } = require('../src/desktop/training-pf700');
const { seedTables } = require('../src/desktop/tables');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { bootstrap } = require('../src/desktop/session');
const { recoverLegacyCombined } = require('../src/desktop/legacy-combined-recovery');
const { recoverSampleCombined } = require('../src/desktop/sample-combined-recovery');
const { upgradeSampleBusinessDays } = require('../src/desktop/sample-day-upgrade');

test('v48 interrupted checkout remains unresolved after migration and restart', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s096-v48-'));
  let db = historicalDatabase(48).openDatabase(dir);
  t.after(() => { if (db) db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',x'01',x'01');
    INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'sample');
    INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
      VALUES(1,1,'simulation',NULL,'cash','{}',1);
    INSERT INTO fiscal_checkout_attempts(id,bill_id,started_at) VALUES(1,1,1);`);
  db.close(); db = openDatabase(dir);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,49);
    assert.equal(readFiscalCheckout(db,1).status,'uncertain');
    assert.equal(db.prepare('SELECT count(*) n FROM simulated_cash_attempts').get().n,0);
    for (const account of ['A','B']) assert.throws(() =>
      db.prepare('INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,?,?)').run('cash',account));
    if (!attempt) { db.close(); db = openDatabase(dir); }
  }
});

test('restored interrupted checkout keeps original evidence and holds without separate printer store', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s096-restore-'));
  const live = path.join(root,'live'), restored = path.join(root,'restored');
  fs.mkdirSync(live); fs.mkdirSync(restored);
  let db = authorizedDatabase(openDatabase(live));
  t.after(() => { if (db) db.close(); fs.rmSync(root,{recursive:true,force:true}); });
  seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');
    INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1);`);
  const session = {currentUserId:()=>1,authenticatedUserId:()=>1,identityGeneration:()=>1};
  function handlersFor(database, adapter) {
    const handlers = {}, ipc = {handle:(channel, fn) => { handlers[channel] = fn; }};
    registerOrderItems(ipc,()=>true,database,session);
    registerBills(ipc,()=>true,database,session,adapter);
    registerPayments(ipc,()=>true,database,session,null,adapter);
    return (channel,request) => handlers[channel]({},request);
  }
  let call = handlersFor(db,createTrainingPf700(live));
  assert.equal(call('arra:order-items',{action:'add',orderId:1,productId:'arra-product-11-0',optionIds:[]}).ok,true);
  assert.equal(call('arra:order-items',{action:'send',orderId:1,requestId:'sample-send'}).ok,true);
  const reviewed = call('arra:bill',{action:'review',orderId:1});
  const bill = call('arra:bill',{action:'generate',orderId:1,fingerprint:reviewed.data.fingerprint}).data;
  const request = {billId:bill.id,method:'cash',account:'A'};
  const intent = call('arra:payment',{...request,prepareSimulatedCash:'after_tender'});
  assert.equal(intent.ok,true);
  assert.equal((await call('arra:payment',{...request,simulateInterrupt:'after_tender',intentId:intent.data.intentId})).fiscalStatus,'uncertain');
  const saved = {...db.prepare('SELECT attempt_id,nonce,interruption FROM simulated_cash_attempts').get()};
  assert.ok(fs.existsSync(path.join(live,'simulated-pf700.sqlite')));
  const backup = path.join(root,'backup.enc'), phrase = randomBytes(24).toString('hex');
  await createBackup(live,backup,phrase);
  restoreBackup(backup,restored,phrase);
  assert.equal(fs.existsSync(path.join(restored,'simulated-pf700.sqlite')),false);
  db.close(); db = openDatabase(restored);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual({...db.prepare('SELECT attempt_id,nonce,interruption FROM simulated_cash_attempts').get()},saved);
    assert.equal(readFiscalCheckout(db,bill.id).status,'uncertain');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    call = handlersFor(db,createTrainingPf700(restored));
    assert.equal(call('arra:payment',{...request,checkSimulated:true}).fiscalStatus,'uncertain');
    assert.equal(call('arra:payment',{...request,finishSimulated:true}).fiscalStatus,'uncertain');
    assert.equal(call('arra:payment',{...request,account:'B'}).fiscalStatus,'selection');
    assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
    assert.equal(fs.existsSync(path.join(restored,'simulated-pf700.sqlite')),false);
    if (!attempt) { db.close(); db = openDatabase(restored); }
  }
});

for (const mode of ['legacy','sample','day']) test('v49 ' + mode + ' recovery copies a held checkout without claiming missing device evidence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'arra-s096-copy-'));
  const source = path.join(root,'source'), explicitDestination = path.join(root,'legacy-copy');
  const secret = randomBytes(24).toString('hex');
  const copies = [];
  let db = openDatabase(source);
  t.after(() => {
    if (db) db.close();
    for (const copy of copies) fs.rmSync(copy,{recursive:true,force:true});
    fs.rmSync(root,{recursive:true,force:true});
  });
  bootstrap(db,'sample-admin',secret);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'sample-waiter',x'01',x'01');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');`);
  seedTables(db); seedArraMenu(db);
  db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,2,1,1,'open');
    INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',1);`);
  const session = {currentUserId:()=>2,authenticatedUserId:()=>2,identityGeneration:()=>2};
  const handlers = {}, ipc = {handle:(channel,fn)=>{handlers[channel]=fn;}};
  const adapter = createTrainingPf700(source);
  registerOrderItems(ipc,()=>true,db,session);
  registerBills(ipc,()=>true,db,session,adapter);
  registerPayments(ipc,()=>true,db,session,null,adapter);
  const call = (channel,request)=>handlers[channel]({},request);
  assert.equal(call('arra:order-items',{action:'add',orderId:1,productId:'arra-product-11-0',optionIds:[]}).ok,true);
  assert.equal(call('arra:order-items',{action:'send',orderId:1,requestId:'sample-send'}).ok,true);
  const reviewed=call('arra:bill',{action:'review',orderId:1});
  const bill=call('arra:bill',{action:'generate',orderId:1,fingerprint:reviewed.data.fingerprint}).data;
  const request={billId:bill.id,method:'cash',account:'A'};
  const intent=call('arra:payment',{...request,prepareSimulatedCash:'after_items'});
  assert.equal(intent.ok,true);
  assert.equal((await call('arra:payment',{...request,simulateInterrupt:'after_items',intentId:intent.data.intentId})).fiscalStatus,'uncertain');
  const saved={...db.prepare('SELECT attempt_id,nonce,interruption FROM simulated_cash_attempts').get()};
  if (mode !== 'day') db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");
  else db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'");
  fs.writeFileSync(path.join(source,'SAMPLE-DATA-ONLY'),'sample');
  db.close(); db=null;

  const sourceFile=path.join(source,'arra.sqlite');
  const makeCopy = () => mode==='legacy'
    ? recoverLegacyCombined(sourceFile,explicitDestination,'sample-admin',secret,'copy-admin',secret)
    : mode==='sample' ? recoverSampleCombined(sourceFile,'sample-admin',secret)
      : upgradeSampleBusinessDays(sourceFile,'sample-admin',secret);
  const copy=await makeCopy();
  if (mode !== 'legacy') copies.push(copy);
  assert.equal(fs.existsSync(path.join(copy,'simulated-pf700.sqlite')),false);
  db=openDatabase(copy);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,49);
  assert.deepEqual({...db.prepare('SELECT attempt_id,nonce,interruption FROM simulated_cash_attempts').get()},saved);
  assert.equal(readFiscalCheckout(db,bill.id).status,'uncertain');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  let pay;
  registerPayments({handle:(_,fn)=>{pay=fn;}},()=>true,db,session,null,createTrainingPf700(copy));
  assert.equal(pay({},{...request,checkSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(pay({},{...request,finishSimulated:true}).fiscalStatus,'uncertain');
  assert.equal(pay({},{...request,account:'B'}).fiscalStatus,'selection');
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
  db.close(); db=openDatabase(source);
  assert.deepEqual({...db.prepare('SELECT attempt_id,nonce,interruption FROM simulated_cash_attempts').get()},saved);
  assert.equal(readFiscalCheckout(db,bill.id).status,'uncertain');
  db.exec('PRAGMA user_version=50'); db.close(); db=null;
  await assert.rejects(makeCopy(), /Unsupported|Expected version/);
});
