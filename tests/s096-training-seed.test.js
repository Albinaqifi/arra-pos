const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { seedFreshTrainingOrigins } = require('../scripts/s096-training-seed-origins');
const { enroll } = require('../src/desktop/pf700-commissioning');
const { openDatabase } = require('../src/desktop/database');
const { createTrainingPf700 } = require('../src/desktop/training-pf700');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');

function freshProfile(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s096-fresh-'));
  const checkedTemp = path.resolve(temp);
  assert.equal(path.dirname(checkedTemp), path.resolve(os.tmpdir()));
  assert.ok(path.basename(checkedTemp).startsWith('arra-s096-fresh-'));
  t.after(() => fs.rmSync(checkedTemp, { recursive:true, force:true }));
  const appData = path.join(temp, 'appdata');
  const root = path.join(appData, 'Arra POS S096 Simulated Training');
  fs.mkdirSync(root, { recursive:true });
  const id = randomBytes(16).toString('hex');
  const directory = path.join(root, id);
  // Synthetic credentials are generated in memory and never printed or saved
  // in the test source. Only the normal setup writes password hashes.
  const values = [
    ...Array.from({length:4}, () => randomBytes(18).toString('hex')),
    String(randomInt(1000, 10000)), String(randomInt(100000, 1000000)),
    ...Array.from({length:6}, (_, index) => 'Sample ' + index + ' ' + randomBytes(4).toString('hex'))
  ];
  const setup = spawnSync(process.execPath, [path.join(__dirname, '../src/desktop/setup-arra-sample.js'), directory], {
    input:JSON.stringify(values), encoding:'utf8', windowsHide:true
  });
  values.fill('');
  assert.equal(setup.status, 0, 'Fresh sample setup failed');
  return { directory, id, appData, dbPath:path.join(directory, 'arra.sqlite') };
}

function originCount(file) {
  const db = new DatabaseSync(file, {readOnly:true});
  try { return db.prepare('SELECT COUNT(*) AS n FROM menu_product_fiscal_origin').get().n; }
  finally { db.close(); }
}

test('new sample menu gets fictional marks and can perform a simulated interrupted cash checkout', async t => {
  const f = freshProfile(t);
  assert.equal(originCount(f.dbPath), 0);
  seedFreshTrainingOrigins(f.directory, f.id, f.appData);
  const db = openDatabase(f.directory);
  try {
  const products = db.prepare('SELECT COUNT(*) AS n FROM menu_products').get().n;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM menu_product_fiscal_origin WHERE domestic=0').get().n, products);
  assert.ok(fs.statSync(path.join(f.directory, 'S096-TRAINING-READY')).isFile());
  const actor = db.prepare('SELECT user_id FROM verified_waiter_pins LIMIT 1').get().user_id;
  const table = db.prepare('SELECT id FROM dining_tables LIMIT 1').get().id;
  const order = db.prepare("INSERT INTO orders(table_id,opened_at,status) VALUES(?,?,'open')").run(table, Date.now()).lastInsertRowid;
  db.prepare("INSERT INTO order_waiter_ownership VALUES(?,?,?,?, 'open')").run(order, actor, actor, Date.now());
  const session = {currentUserId:()=>actor, authenticatedUserId:()=>actor, identityGeneration:()=>1};
  const handlers = {}, ipc = {handle:(channel, fn)=>{handlers[channel]=fn;}};
  const adapter = createTrainingPf700(f.directory);
  registerOrderItems(ipc,()=>true,db,session);
  registerBills(ipc,()=>true,db,session,adapter);
  registerPayments(ipc,()=>true,db,session,null,adapter);
  const items = request => handlers['arra:order-items']({},request);
  const bills = request => handlers['arra:bill']({},request);
  const payment = request => handlers['arra:payment']({},request);
  assert.equal(items({action:'add',orderId:order,productId:'arra-product-11-0',optionIds:[]}).ok,true);
  assert.equal(items({action:'send',orderId:order,requestId:'sample-send'}).ok,true);
  const bill = bills({action:'review',orderId:order});
  const generated = bills({action:'generate',orderId:order,fingerprint:bill.data.fingerprint});
  assert.equal(generated.ok,true);
  const req = {billId:generated.data.id,method:'cash',account:'A'};
  const prepared = payment({...req,prepareSimulatedCash:'after_items'});
  assert.equal(prepared.ok,true);
  assert.equal((await payment({...req,simulateInterrupt:'after_items',intentId:prepared.data.intentId})).fiscalStatus,'uncertain');
  assert.equal(payment({...req,checkSimulated:true}).data.stage,'open_unpaid');
  assert.equal(payment({...req,finishSimulated:true}).ok,true);
  assert.throws(() => seedFreshTrainingOrigins(f.directory,f.id,f.appData));
  assert.equal(originCount(f.dbPath),products);
  } finally { db.close(); }
});

test('missing sample marker and wrong profile root leave the database untouched', t => {
  const f = freshProfile(t);
  assert.throws(() => seedFreshTrainingOrigins(f.directory,f.id,path.join(f.appData,'wrong')));
  fs.unlinkSync(path.join(f.directory,'SAMPLE-DATA-ONLY'));
  assert.throws(() => seedFreshTrainingOrigins(f.directory,f.id,f.appData));
  assert.equal(originCount(f.dbPath),0);
  assert.equal(fs.existsSync(path.join(f.directory,'S096-TRAINING-READY')),false);
});

test('commissioned, nonempty, and already classified profiles are refused without changes', t => {
  for (const kind of ['commissioned','nonempty','classified']) {
    const f = freshProfile(t), db = new DatabaseSync(f.dbPath);
    try {
      if (kind === 'commissioned') enroll(db);
      if (kind === 'nonempty') {
        const table = db.prepare('SELECT id FROM dining_tables LIMIT 1').get().id;
        db.prepare("INSERT INTO orders(table_id,opened_at,status) VALUES(?,?,'open')").run(table,Date.now());
      }
      if (kind === 'classified') db.prepare('INSERT INTO menu_product_fiscal_origin(product_id,domestic) SELECT id,1 FROM menu_products LIMIT 1').run();
    } finally { db.close(); }
    const before = originCount(f.dbPath);
    assert.throws(() => seedFreshTrainingOrigins(f.directory,f.id,f.appData));
    assert.equal(originCount(f.dbPath),before);
    assert.equal(fs.existsSync(path.join(f.directory,'S096-TRAINING-READY')),false);
  }
});
