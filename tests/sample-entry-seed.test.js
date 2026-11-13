const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomBytes, randomInt } = require('node:crypto');
const { openDatabase } = require('../src/desktop/database');
const { seedSampleIdentities } = require('../src/desktop/sample-accounts');
const { createSession } = require('../src/desktop/session');

test('sample entry setup is atomic, repeatable, and preserves existing accounts and records', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-seed-entry-')), db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  const passwords = Array.from({length: 4}, () => randomBytes(20).toString('hex'));
  const waiterPin = String(randomInt(10000)).padStart(4, '0'), transferPin = String(randomInt(1000000)).padStart(6, '0');
  assert.throws(() => seedSampleIdentities(db, passwords, waiterPin, 'x'));
  db.exec("CREATE TRIGGER reject_sample BEFORE INSERT ON transfer_managers BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(() => seedSampleIdentities(db, passwords, waiterPin, transferPin));
  assert.equal(db.prepare('SELECT count(*) n FROM local_users').get().n, 0);
  db.exec('DROP TRIGGER reject_sample'); seedSampleIdentities(db, passwords, waiterPin, transferPin);
  assert.equal(db.prepare('SELECT count(*) n FROM local_users').get().n, 6);
  const session = createSession(db);
  assert.equal(session.signIn({username:'sample-restaurant',password:passwords[0]}).ok, true);
  const list = session.listWaiters().data;
  assert.equal(list.length, 2);
  assert.equal(session.selectWaiter({id:list.find(x=>!x.isTransfer).id,pin:waiterPin}).ok,true);
  assert.equal(session.selectWaiter({id:list.find(x=>x.isTransfer).id,pin:transferPin}).ok,true);
  for (const [i, name] of ['sample-owner-a','sample-owner-b','sample-combined'].entries()) {
    assert.equal(session.signIn({username:name,password:passwords[i+1]}).admin,true);
  }
  const before = db.prepare('SELECT * FROM local_users ORDER BY id').all();
  db.exec("INSERT INTO dining_tables(id,area) VALUES(123,'sample')");
  seedSampleIdentities(db, Array.from({length:4},()=>randomBytes(20).toString('hex')), String(randomInt(10000)).padStart(4,'0'), String(randomInt(1000000)).padStart(6,'0'));
  assert.deepEqual(db.prepare('SELECT * FROM local_users ORDER BY id').all(), before);
  assert.equal(db.prepare('SELECT count(*) n FROM dining_tables WHERE id=123').get().n,1);
  assert.equal(session.signIn({username:'sample-restaurant',password:passwords[0]}).ok,true);
});
