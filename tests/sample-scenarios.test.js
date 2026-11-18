const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { createSampleAccounts, seedSampleIdentities } = require('../src/desktop/sample-accounts');
const { createSampleTransferManager } = require('../src/desktop/sample-transfer-manager');
const { seedTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { seedScenarios } = require('../src/desktop/seed-sample-scenarios');
const { createSampleScenarios } = require('../src/desktop/create-sample-scenarios');
const { registerFinancialVisibility } = require('../src/desktop/financial-visibility');

test('sample scenarios preserve financial rules and refuse a repeat', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-scenarios-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  createSampleAccounts(db, Array.from({ length: 4 }, () => randomBytes(20).toString('hex')));
  createSampleTransferManager(db, String(randomInt(1000000)).padStart(6, '0'));
  seedTables(db); seedMenu(db); seedScenarios(db);
  assert.deepEqual(db.prepare('SELECT method, account FROM payments ORDER BY id').all().map(x => [x.method, x.account]), [['cash', 'A'], ['cash', 'B'], ['card', 'A'], ['cash', 'B']]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payment_account_corrections').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sent_item_corrections').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM bills').get().n, 5);
  assert.equal(db.prepare("SELECT count(*) AS n FROM orders WHERE status='open'").get().n, 3);
  assert.throws(() => seedScenarios(db), /fresh sample/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, 4);
});

test('fresh setup creates a marked database with current-day scoped payments', t => {
  const passwords = Array.from({ length: 4 }, () => randomBytes(20).toString('hex'));
  const waiterPin = String(randomInt(10000)).padStart(4, '0'), transferPin = String(randomInt(1000000)).padStart(6, '0'), ownerPin = String(randomInt(1000000)).padStart(6, '0');
  const dir = createSampleScenarios(passwords, waiterPin, transferPin, ownerPin);
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.ok(fs.existsSync(path.join(dir, 'SAMPLE-DATA-ONLY')));
  const combined = db.prepare("SELECT id FROM local_users WHERE username='sample-combined'").get().id;
  const before = db.prepare('SELECT salt,password_hash,pin_salt,pin_hash FROM local_users WHERE id=?').get(combined);
  const scopeBefore = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(combined);
  const grantsBefore = db.prepare('SELECT permission FROM user_permissions WHERE user_id=? ORDER BY permission').all(combined);
  assert.ok(before.pin_salt && before.pin_hash);
  seedSampleIdentities(db, Array.from({ length: 4 }, () => randomBytes(20).toString('hex')), String(randomInt(10000)).padStart(4, '0'), String(randomInt(1000000)).padStart(6, '0'), String(randomInt(1000000)).padStart(6, '0'));
  assert.deepEqual(db.prepare('SELECT salt,password_hash,pin_salt,pin_hash FROM local_users WHERE id=?').get(combined), before);
  assert.deepEqual(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(combined), scopeBefore);
  assert.deepEqual(db.prepare('SELECT permission FROM user_permissions WHERE user_id=? ORDER BY permission').all(combined), grantsBefore);
  const { registerOrderItems } = require('../src/desktop/order-items');
  const waiter = db.prepare("SELECT id FROM local_users WHERE username='sample-waiter'").get().id;
  const orderId = db.prepare("SELECT id FROM orders WHERE status='open' AND retired_empty=0 AND NOT EXISTS (SELECT 1 FROM bills WHERE order_id=orders.id) LIMIT 1").get().id;
  const originalNow = Date.now; let now = Date.now(); Date.now = () => now; t.after(() => { Date.now = originalNow; });
  const handlers = {}; registerOrderItems({ handle: (channel, fn) => { handlers[channel] = fn; } }, () => true, db, { currentUserId: () => waiter, authenticatedUserId: () => waiter });
  const call = request => handlers['arra:order-items']({}, request);
  assert.equal(call({action:'add',orderId,productId:'qebapa'}).ok,true);
  const itemId = call({action:'list',orderId}).data.items.filter(item => item.status === 'pending').at(-1).id;
  assert.equal(call({action:'send',orderId,requestId:'sample-owner-pin-send'}).ok,true);
  now += 120000;
  const wrongPin = String((Number(ownerPin) + 1) % 1000000).padStart(6, '0');
  assert.equal(handlers['arra:authorize-cancellation']({},{orderId,itemId,pin:wrongPin}).ok,false);
  const approval = handlers['arra:authorize-cancellation']({},{orderId,itemId,pin:ownerPin});assert.equal(approval.ok,true);
  assert.equal(call({action:'correct',orderId,itemId,quantity:1,reason:'Sample',requestId:'sample-owner-pin-correction',approvalToken:approval.token}).ok,true);
  const audit = db.prepare("SELECT actor_id,context FROM application_audit WHERE action='correct_sent' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.actor_id, waiter); assert.equal(JSON.parse(audit.context).approvingOwnerId, combined);
  const day = db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  let handler;
  registerFinancialVisibility({ handle: (_, fn) => { handler = fn; } }, () => true, db, { currentUserId: () => combined, authenticatedUserId: () => combined });
  const report = handler({}, { action: 'report', from: null, to: null, dayId: day, account: null, method: null });
  assert.equal(report.ok, true);
  assert.equal(report.data.records.length, 4);
  assert.equal(report.data.groups.reduce((sum, group) => sum + group.total, 0), 1190);
  assert.equal(report.data.corrections.length, 1);
});

test('scenario setup rejects missing or malformed owner PIN and refuses noninteractive use', () => {
  const passwords = Array.from({ length: 4 }, () => randomBytes(20).toString('hex'));
  const waiterPin = String(randomInt(10000)).padStart(4, '0'), transferPin = String(randomInt(1000000)).padStart(6, '0');
  for (const ownerPin of [undefined, null, '', '12345', '1234567', '12a456', 123456]) {
    assert.throws(() => createSampleScenarios(passwords, waiterPin, transferPin, ownerPin), /Invalid sample credentials/);
  }
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.join(__dirname, '../src/desktop/create-sample-scenarios.js')], { input: '', encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Run interactively/);
  assert.doesNotMatch(result.stdout, /Fresh sample database created/);
});
