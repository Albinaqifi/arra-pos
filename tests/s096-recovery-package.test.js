'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openIncidentProfile, registerRecoveryServices } = require('../scripts/bill2-recovery/services');
const { hashPassword } = require('../src/desktop/session');
const { readFiscalCheckout } = require('../src/desktop/fiscal-checkout');
const { createBill2JournalRecovery } = require('../src/desktop/pf700-bill2-journal');
const { lostClose } = require('./support/pf700-bill2-sale');

function location(t) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 's096-profile-'));
  t.after(() => fs.rmSync(appData, {recursive:true, force:true}));
  const directory = path.join(appData, 'Arra POS PF700 Commissioning');
  const file = path.join(directory, 'arra.sqlite');
  return {appData, directory, file};
}

test('recovery launch never creates a profile or migrates a different database', t => {
  const {appData, directory, file} = location(t);
  assert.throws(() => openIncidentProfile(appData));
  assert.equal(fs.existsSync(directory), false);
  fs.mkdirSync(directory);
  assert.throws(() => openIncidentProfile(appData));
  assert.equal(fs.existsSync(file), false);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=50');
  db.close();
  const before = fs.readFileSync(file);
  assert.throws(() => openIncidentProfile(appData));
  assert.deepEqual(fs.readFileSync(file), before);
});

test('the kit binds its read-only handle to the enrolled bill and only the payment service can write', t => {
  const {appData, directory, file} = location(t);
  fs.mkdirSync(directory);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version=53;
    CREATE TABLE pf700_commissioning_enrollment(id);
    INSERT INTO pf700_commissioning_enrollment VALUES(1);
    CREATE TABLE bills(id,order_id,total);
    CREATE TABLE orders(id,table_id);
    INSERT INTO bills VALUES(2,9,150);
    INSERT INTO orders VALUES(9,7)`);
  db.close();
  const profile = openIncidentProfile(appData);
  try {
    assert.deepEqual({...profile.bill}, {orderId:9, tableId:7});
    assert.equal(profile.writer.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.throws(() => profile.reader.exec('DELETE FROM bills'), /readonly/);
    const handlers = new Map();
    const ipc = {handle: (name, handler) => handlers.set(name, handler)};
    assert.throws(() => registerRecoveryServices(ipc, () => true, profile, null), /verification is required/);
    assert.equal(handlers.size, 0);
    registerRecoveryServices(ipc, event => event === 'approved', profile, () => null);
    assert.ok(!handlers.has('arra:test-printing') && !handlers.has('arra:business-days'));
    for (const [channel, request] of [
      ['arra:bill', {orderId:9, action:'generate'}], ['arra:bill', {orderId:10, action:'review'}],
      ['arra:open-order', {tableId:1}], ['arra:order-items', {orderId:9, action:'send'}],
      ['arra:payment', {billId:2, method:'cash', account:'A'}],
      ['arra:payment', {billId:2, method:'cash', account:'A', physicalIntentId:1}],
      ['arra:payment', {billId:2, method:'cash', account:'A', acknowledgedDocument:'0000031'}],
      ['arra:payment', {billId:3, method:'cash', account:'A', acknowledgedDocument:'0000030'}],
      ['arra:payment', {billId:2, method:'cash', account:'B', acknowledgedDocument:'0000030'}],
      ['arra:payment', {billId:2, method:'card', account:'A', acknowledgedDocument:'0000030'}]
    ]) assert.deepEqual(handlers.get(channel)('approved', request), {ok:false, error:'Access denied'});
    assert.deepEqual(handlers.get('arra:payment')('different window', {
      billId:2, method:'cash', account:'A', acknowledgedDocument:'0000030'
    }), {ok:false, error:'Access denied'});
  } finally { profile.close(); }
  fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), '');
  assert.throws(() => openIncidentProfile(appData));
});

test('an authorized waiter in the kit cannot settle a different accepted result for receipt 0000030', async t => {
  const {appData} = location(t);
  const {db, device} = await lostClose(t, 'after');
  const pin = String(randomInt(1000,10000));
  const password = randomBytes(24).toString('hex');
  const salt = randomBytes(16);
  db.prepare('UPDATE local_users SET pin_salt=?,pin_hash=? WHERE id=1').run(salt,hashPassword(pin,salt));
  db.prepare('UPDATE local_users SET salt=?,password_hash=? WHERE id=2').run(salt,hashPassword(password,salt));
  db.exec(`INSERT INTO verified_waiter_pins VALUES(1);
    INSERT INTO restaurant_accounts VALUES(2);
    INSERT INTO financial_scopes VALUES(2,'waiter')`);
  const documentNumber = '0000030';
  db.prepare(`INSERT INTO fiscal_checkout_results(attempt_id,status,source,reference,evidence,ended_at)
    SELECT id,'accepted',?,?,?,? FROM fiscal_checkout_attempts WHERE bill_id=2`).run(
    'device-' + device.serial, documentNumber,
    JSON.stringify({documentNumber, fiscalReceiptCount:13, reversalCount:0}), Date.now());
  assert.equal(readFiscalCheckout(db,2).status, 'submitted');
  const unchanged = db.prepare('SELECT total_changes() AS changes').get().changes;
  const handlers = new Map();
  const noMatch = createBill2JournalRecovery(appData, randomBytes(32).toString('hex'));
  registerRecoveryServices({handle:(channel,fn) => handlers.set(channel,fn)}, () => true,
    {reader:db, writer:db, bill:{orderId:2, tableId:2}}, noMatch);
  const call = (name, request) => handlers.get('arra:' + name)({}, request);
  assert.equal(call('sign-in', {username:'other-fixture', password}).ok, true);
  assert.equal(call('identify-staff', {kind:'waiter', pin}).data.id, 1);
  const review = call('bill', {action:'review', orderId:2});
  assert.ok(!review.ok || !['submitted','accepted'].includes(review.data.fiscal?.status));
  const result = await call('payment', {billId:2, method:'cash', account:'A', acknowledgedDocument:documentNumber});
  assert.equal(result.ok, false);
  assert.equal(db.prepare('SELECT total_changes() AS changes').get().changes, unchanged);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payments WHERE bill_id=2').get().n, 0);
});
