const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createEmptySample } = require('../src/desktop/create-empty-sample');
const { openDatabase } = require('../src/desktop/database');
const { createSession } = require('../src/desktop/session');
const { registerTables } = require('../src/desktop/tables');

test('fresh empty sample contains usable identities, menu and clear tables without transactions', t => {
  const passwords = Array.from({ length: 4 }, () => randomBytes(20).toString('hex'));
  const waiterPin = String(randomInt(10000)).padStart(4, '0');
  const transferPin = String(randomInt(1000000)).padStart(6, '0');
  const ownerPin = String(randomInt(1000000)).padStart(6, '0');
  const dir = createEmptySample(passwords, waiterPin, transferPin, ownerPin);
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.ok(fs.existsSync(path.join(dir, 'SAMPLE-DATA-ONLY')));
  assert.ok(db.prepare('SELECT count(*) AS n FROM menu_products WHERE active=1').get().n > 0);
  for (const table of ['orders', 'order_items', 'bills', 'payments']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  }
  const session = createSession(db);
  assert.equal(session.signIn({ username: 'sample-restaurant', password: passwords[0] }).ok, true);
  const waiter = session.listWaiters().data.find(x => !x.isTransfer);
  assert.equal(session.selectWaiter({ id: waiter.id, pin: waiterPin }).ok, true);
  let handler;
  registerTables({ handle: (_, fn) => { handler = fn; } }, () => true, db, session);
  const result = handler({}, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 16);
  assert.ok(result.data.every(table => !table.occupied && table.orderId === null));
});

test('empty sample requires an owner PIN and an interactive terminal', () => {
  assert.throws(() => createEmptySample([], '', '', ''), /Invalid sample credentials/);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../src/desktop/create-empty-sample.js')], { input: '', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run interactively/);
});
