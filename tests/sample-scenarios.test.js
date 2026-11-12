const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { createSampleAccounts } = require('../src/desktop/sample-accounts');
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
  createSampleTransferManager(db, String(randomInt(10000)).padStart(4, '0'));
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
  const dir = createSampleScenarios(Array.from({ length: 4 }, () => randomBytes(20).toString('hex')), String(randomInt(10000)).padStart(4, '0'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.ok(fs.existsSync(path.join(dir, 'SAMPLE-DATA-ONLY')));
  const combined = db.prepare("SELECT id FROM local_users WHERE username='sample-combined'").get().id;
  const day = db.prepare('SELECT id FROM business_days WHERE closed_at IS NULL').get().id;
  let handler;
  registerFinancialVisibility({ handle: (_, fn) => { handler = fn; } }, () => true, db, { currentUserId: () => combined, authenticatedUserId: () => combined });
  const report = handler({}, { action: 'report', from: null, to: null, dayId: day, account: null, method: null });
  assert.equal(report.ok, true);
  assert.equal(report.data.records.length, 4);
  assert.equal(report.data.groups.reduce((sum, group) => sum + group.total, 0), 1190);
  assert.equal(report.data.corrections.length, 1);
});
