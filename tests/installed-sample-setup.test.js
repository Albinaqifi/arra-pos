const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { openDatabase } = require('../src/desktop/database');
const { verifyLocalAccount } = require('../src/desktop/session');

test('bundled Electron receives sample setup over a pipe and never replaces an existing directory', { skip: process.platform !== 'win32' }, () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-installed-setup-'));
  const directory = path.join(parent, 'sample');
  const electron = path.join(__dirname, '../node_modules/electron/dist/electron.exe');
  const script = path.join(__dirname, '../src/desktop/setup-installed-sample.js');
  const values = Array.from({ length: 4 }, () => crypto.randomBytes(16).toString('hex'));
  values.push(String(crypto.randomInt(1000, 10000)), String(crypto.randomInt(100000, 1000000)));
  const run = (input) => spawnSync(electron, [script, directory], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  try {
    assert.notEqual(run(['invalid']).status, 0);
    assert.equal(fs.existsSync(directory), false);
    const created = run(values);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'SAMPLE-DATA-ONLY')), true);
    let db = openDatabase(directory);
    try {
      assert.ok(verifyLocalAccount(db, 'sample-restaurant', values[0]));
      assert.ok(verifyLocalAccount(db, 'sample-combined', values[3]));
      assert.ok(db.prepare('SELECT COUNT(*) AS n FROM dining_tables').get().n > 0);
      assert.ok(db.prepare('SELECT COUNT(*) AS n FROM menu_products').get().n > 0);
    } finally { db.close(); }
    fs.writeFileSync(path.join(directory, 'sentinel'), 'preserve');
    assert.notEqual(run(values).status, 0);
    assert.equal(fs.readFileSync(path.join(directory, 'sentinel'), 'utf8'), 'preserve');
    db = openDatabase(directory);
    try { assert.ok(verifyLocalAccount(db, 'sample-combined', values[3])); } finally { db.close(); }
  } finally { values.fill(''); fs.rmSync(parent, { recursive: true, force: true }); }
});
