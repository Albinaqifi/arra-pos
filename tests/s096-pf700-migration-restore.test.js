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
const { registerPayments } = require('../src/desktop/payments');
const { bootstrap } = require('../src/desktop/session');
const { recoverLegacyCombined } = require('../src/desktop/legacy-combined-recovery');
const { recoverSampleCombined } = require('../src/desktop/sample-combined-recovery');
const { upgradeSampleBusinessDays } = require('../src/desktop/sample-day-upgrade');

// Restrict cleanup to known temporary roots; never remove an arbitrary path.
function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-pf700-v50-'));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('arra-pf700-v50-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  return root;
}
function removeRecoveryCopy(copy, prefix) {
  const resolved = path.resolve(copy);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith(prefix));
  fs.rmSync(resolved, {recursive:true, force:true});
}
function seedOrder(db, actor=1) {
  db.exec(`INSERT INTO dining_tables(id,area) VALUES(1,'sample');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');`);
  db.prepare("INSERT INTO order_waiter_ownership VALUES(1,?,?,1,'open')").run(actor,actor);
  db.prepare("INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,?,1,70,'sample')").run(actor);
}
const receipt = JSON.stringify({billId:1,account:'A',method:'cash',currency:'MKD',total:70,lines:[]});
const serial = 'SYNTHETIC01';
function insertPhysicalAttempt(db, actor=1) {
  db.prepare(`INSERT INTO pf700_cash_intents(id,bill_id,actor_id,device_id,receipt,created_at)
    VALUES(1,1,?,?,?,1)`).run(actor,serial,receipt);
  db.prepare(`INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
    VALUES(1,?,'device',?,'cash',?,1)`).run(actor,serial,receipt);
  db.exec(`INSERT INTO fiscal_checkout_attempts(id,bill_id,started_at) VALUES(1,1,1);
    INSERT INTO pf700_cash_dispatches(attempt_id,intent_id,created_at) VALUES(1,1,1);
    INSERT INTO fiscal_checkout_baselines(attempt_id,device_id,previous_document) VALUES(1,'SYNTHETIC01','0000000');`);
  const intent = db.prepare('INSERT INTO pf700_command_intents(attempt_id,sequence,command,request_hash,created_at) VALUES(1,32,90,?,1)')
    .run('a'.repeat(64)).lastInsertRowid;
  db.prepare('INSERT INTO pf700_command_acks(command_id,response_hash,summary,created_at) VALUES(?,?,?,2)')
    .run(intent,'b'.repeat(64),JSON.stringify({identityMatched:true,onsiteFirmware:true}));
  db.exec('INSERT INTO pf700_command_intents(attempt_id,sequence,command,request_hash,created_at) VALUES(1,33,48,NULL,3)');
}
function ledger(db) {
  return {
    intent:{...db.prepare('SELECT * FROM pf700_cash_intents WHERE id=1').get()},
    dispatch:{...db.prepare('SELECT * FROM pf700_cash_dispatches WHERE attempt_id=1').get()},
    commands:db.prepare('SELECT * FROM pf700_command_intents ORDER BY id').all().map(row=>({...row})),
    acks:db.prepare('SELECT * FROM pf700_command_acks ORDER BY command_id').all().map(row=>({...row}))
  };
}
function verifyHeld(db, expected, actor=1) {
  assert.deepEqual(ledger(db),expected);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,51);
  assert.equal(readFiscalCheckout(db,1).status,'uncertain');
  assert.equal(db.prepare('SELECT count(*) n FROM payments').get().n,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  for (const [method,account] of [['cash','A'],['cash','B'],['card','A']]) {
    assert.throws(() => db.prepare('INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,?,4,70,?,?)').run(actor,method,account));
  }
  let writes=0, observations=0, handler;
  const adapter={mode:'device',deviceId:serial,domesticProduct:false,registerSale(){writes++; return {status:'uncertain'};},
    observeCash(){observations++; throw Error('Unexpected observation');}};
  const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>1};
  registerPayments({handle:(_,fn)=>{handler=fn;}},()=>true,db,session,null,adapter);
  const req={billId:1,method:'cash',account:'A'};
  assert.equal(handler({},{...req,releasePhysicalCash:true}).fiscalStatus,'uncertain');
  assert.equal(handler({},{...req,inspectPhysicalCash:true,checkedNoOtherActivity:true}).fiscalStatus,'uncertain');
  assert.equal(handler({},{...req,account:'B'}).fiscalStatus,'selection');
  assert.equal(writes,0,'release never invokes the device');
  assert.equal(observations,0,'unacknowledged command never permits printer observation');
}

test('v49 legacy physical unknown remains held and retains its journal after upgrading and restart', t => {
  const root=tempRoot(t), directory=path.join(root,'data');
  let db=authorizedDatabase(historicalDatabase(49).openDatabase(directory));
  seedOrder(db);
  db.prepare(`INSERT INTO fiscal_checkout_sales(bill_id,actor_id,mode,device_id,method,receipt,created_at)
    VALUES(1,1,'device',?,'cash',?,1)`).run(serial,receipt);
  db.exec(`INSERT INTO fiscal_checkout_attempts(id,bill_id,started_at) VALUES(1,1,1);
    INSERT INTO fiscal_checkout_baselines(attempt_id,device_id,previous_document) VALUES(1,'SYNTHETIC01','0000000');`);
  db.close(); db=openDatabase(directory);
  for (let iteration=0; iteration<2; iteration++) {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,51);
    assert.equal(readFiscalCheckout(db,1).status,'uncertain');
    assert.equal(db.prepare('SELECT count(*) n FROM pf700_cash_intents').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM pf700_command_intents').get().n,0);
    assert.throws(()=>db.prepare("INSERT INTO payments(bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,2,70,'cash','A')").run());
    if (!iteration) {db.close();db=openDatabase(directory);}
  }
  db.close();
});

test('settlement attributes a historical verified Cash A snapshot to its saved payer and audits its authorized finisher', t => {
  const root=tempRoot(t), directory=path.join(root,'data');
  let db=authorizedDatabase(historicalDatabase(49).openDatabase(directory));
  try {
    require('../src/desktop/arra-menu').seedArraMenu(db);
    // Distinct IDs exercise the accounting boundary using synthetic history.
    // Normal waiter checkout keeps a single immutable owner for an order.
    db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'sample-original',x'00',x'00');
      INSERT INTO financial_scopes VALUES(2,'waiter');
      INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');
      INSERT INTO dining_tables(id,area) VALUES(1,'sample');
      INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
      INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');
      INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'arra-product-11-0','Sample',70,1,'sent');
      INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,2,1,70,'sample');
      INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES(1,1,'Sample',70,1,'[]');`);
    const snapshot={billId:1,account:'A',method:'cash',currency:'MKD',total:70,domesticProduct:false,
      lines:[{itemId:1,name:'Sample',unitPrice:70,quantity:1,modifiers:[],taxGroup:'В',taxRate:10}]};
    db.prepare("INSERT INTO fiscal_checkout_sales VALUES(1,2,'device',?,'cash',?,1)").run(serial,JSON.stringify(snapshot));
    db.exec(`INSERT INTO fiscal_checkout_attempts VALUES(1,1,1);
      INSERT INTO fiscal_checkout_baselines VALUES(1,'SYNTHETIC01','0000001');`);
    const proof={documentNumber:'0000002',fiscalReceiptCount:1,reversalCount:0};
    db.prepare("INSERT INTO fiscal_checkout_results VALUES(1,'accepted',?, ?, ?,2)").run('device-'+serial,proof.documentNumber,JSON.stringify(proof));
    db.close();db=openDatabase(directory);
    let actor=2, pay;
    const session={currentUserId:()=>actor,authenticatedUserId:()=>actor,identityGeneration:()=>actor};
    registerPayments({handle:(_,fn)=>{pay=fn;}},()=>true,db,session);
    const request={billId:1,method:'cash',account:'A',acknowledgedDocument:proof.documentNumber};
    assert.equal(pay({},request).error,'Access denied');
    actor=1;
    const first=pay({},request);
    assert.equal(first.ok,true);
    assert.deepEqual(pay({},request),first);
    assert.equal(db.prepare('SELECT actor_id FROM payments').get().actor_id,2);
    assert.deepEqual(db.prepare("SELECT actor_id FROM application_audit WHERE action='recover' AND entity_type='fiscal_checkout'").all().map(row=>row.actor_id),[1]);
    assert.equal(db.prepare('SELECT count(*) n FROM pf700_cash_intents').get().n,0);
  } finally {db.close();}
});

test('backup and isolated restore preserve outstanding physical intent and unacknowledged command', async t => {
  const root=tempRoot(t), source=path.join(root,'source'), restored=path.join(root,'restored');
  fs.mkdirSync(source);fs.mkdirSync(restored);
  let db=authorizedDatabase(openDatabase(source));seedOrder(db);insertPhysicalAttempt(db);
  const expected=ledger(db), backup=path.join(root,'sample.enc'), phrase=randomBytes(24).toString('hex');
  await createBackup(source,backup,phrase);restoreBackup(backup,restored,phrase);
  db.close();db=openDatabase(restored);
  for (let iteration=0; iteration<2; iteration++) {
    verifyHeld(db,expected);
    assert.throws(()=>db.prepare('INSERT INTO pf700_command_seals(attempt_id,actor_id,created_at) VALUES(1,1,4)').run());
    if (!iteration) {db.close();db=openDatabase(restored);}
  }
  db.close();
  db=openDatabase(source);assert.deepEqual(ledger(db),expected);db.close();
});

for (const mode of ['legacy','sample','day']) test('v50 '+mode+' recovery-copy preserves held physical evidence and rejects a newer source',async t=>{
  const root=tempRoot(t), source=path.join(root,'source'), destination=path.join(root,'copy');
  const phrase=randomBytes(24).toString('hex'); let db=openDatabase(source), copy;
  bootstrap(db,'sample-admin',phrase);
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'sample-waiter',x'00',x'00');
    INSERT INTO financial_scopes VALUES(2,'waiter');
    INSERT INTO user_permissions VALUES(2,'orders.view'),(2,'orders.change');`);
  seedOrder(db,2);insertPhysicalAttempt(db,2);
  const expected=ledger(db);
  if (mode!=='day') db.exec("UPDATE financial_scopes SET scope='waiter' WHERE user_id=1");
  else db.exec("DELETE FROM user_permissions WHERE user_id=1 AND permission='business_days.close'");
  fs.writeFileSync(path.join(source,'SAMPLE-DATA-ONLY'),'sample');
  db.close();db=null;
  t.after(()=>{if (db) db.close();if (copy && mode!=='legacy') removeRecoveryCopy(copy,mode==='sample'?'arra-sample-combined-':'arra-sample-day-upgrade-');});
  const sourceFile=path.join(source,'arra.sqlite');
  const makeCopy=()=>mode==='legacy' ? recoverLegacyCombined(sourceFile,destination,'sample-admin',phrase,'copy-admin',phrase) :
    mode==='sample' ? recoverSampleCombined(sourceFile,'sample-admin',phrase) : upgradeSampleBusinessDays(sourceFile,'sample-admin',phrase);
  copy=await makeCopy();db=openDatabase(copy);verifyHeld(db,expected,2);db.close();db=null;
  db=openDatabase(source);assert.deepEqual(ledger(db),expected);
  db.exec('PRAGMA user_version=52');db.close();db=null;
  await assert.rejects(makeCopy(),/Unsupported|Expected version/);
});
