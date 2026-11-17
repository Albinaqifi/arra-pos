const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { openDatabase } = require('../src/desktop/database');

test('fresh bill history sample spans a year and preserves A/B payment rules', t => {
  const passwords = Array.from({length: 3}, () => crypto.randomBytes(20).toString('hex'));
  const executable = require('electron');
  const setup = path.join(__dirname, '../src/desktop/create-bill-history-sample.js');
  const child = spawnSync(executable, [setup], {input: JSON.stringify(passwords), encoding:'utf8', env:{...process.env, ELECTRON_RUN_AS_NODE:'1'}});
  assert.equal(child.status, 0, child.stderr);
  const {directory, total} = JSON.parse(child.stdout);
  assert.ok(fs.existsSync(path.join(directory, 'SAMPLE-DATA-ONLY')));
  const db = openDatabase(directory); t.after(() => { db.close(); fs.rmSync(directory, {recursive: true, force: true}); });
  assert.ok(total >= 10950 && total <= 18250);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, total);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_days').get().n, 365);
  assert.equal(db.prepare('SELECT count(*) AS n FROM business_days WHERE closed_at IS NULL').get().n, 1);
  for (const day of db.prepare('SELECT issues FROM business_days WHERE closed_at IS NOT NULL').all()) {
    assert.deepEqual(JSON.parse(day.issues), {orders:[], printJobs:[]});
  }
  assert.ok(db.prepare("SELECT count(*) AS n FROM payments WHERE account='A'").get().n > 0);
  assert.ok(db.prepare("SELECT count(*) AS n FROM payments WHERE account='B'").get().n > 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM payments WHERE method='card' AND account<>'A'").get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payment_business_days').get().n, total);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
