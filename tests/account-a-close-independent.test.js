const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { createBackup, restoreBackup } = require('../src/desktop/backup');

test('direct requests reject invalid and unauthorized callers, and in-flight and uncertain retries remain idempotent', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-a-independent-'));
  const dir = path.join(root, 'live');
  let db = openDatabase(dir), handler, actor = 1, authenticated = 1, completePrint;
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample-combined',x'00',x'00'),(2,'sample-combined-no-grant',x'00',x'00');
    INSERT INTO financial_scopes VALUES(1,'combined'),(2,'combined');
    INSERT INTO user_permissions VALUES(1,'business_days.close');`);
  const jobs = [];
  const setup = adapter => registerBusinessDays({handle: (_, fn) => handler = fn}, event => event.allowed, db,
    {currentUserId: () => actor, authenticatedUserId: () => authenticated}, adapter);
  setup(job => { jobs.push(job); return new Promise(resolve => { completePrint = resolve; }); });
  const call = req => handler({allowed:true}, req);
  const day = call({action:'list'}).data.days[0].id;
  assert.equal(call({action:'accountAClose',dayId:day,language:'en'}).ok, false, 'open day cannot close');
  assert.equal(call({action:'close',dayId:day}).ok, true);
  for (const req of [
    {action:'accountAClose',dayId:day}, {action:'accountAClose',dayId:day,language:'xx'},
    {action:'accountAClose',dayId:day,language:'en',extra:true}, {action:'accountAConfigure',queue:'  '},
    {action:'accountARetry',dayId:day,checked:true,requestId:'bad/id'}
  ]) assert.equal(call(req).ok, false);
  actor = authenticated = 2;
  assert.equal(call({action:'accountAList'}).ok, false, 'Combined without grant cannot read');
  actor = 1; authenticated = 2;
  assert.equal(call({action:'accountAClose',dayId:day,language:'en'}).ok, false, 'identity mismatch cannot close');
  authenticated = 1;
  assert.equal(call({action:'accountAClose',dayId:day,language:'en'}).ok, true);
  assert.equal(call({action:'accountAClose',dayId:day,language:'en'}).ok, true);
  await new Promise(setImmediate);
  assert.equal(jobs.filter(j => j.destination === 'account-a-close').length, 1);
  assert.equal(call({action:'accountARetry',dayId:day,checked:true,requestId:'first'}).ok, false, 'in-flight retry rejected');
  completePrint('failed');
  await new Promise(setImmediate);
  setup(job => { jobs.push(job); throw Error('simulated unknown outcome'); });
  assert.equal(call({action:'accountARetry',dayId:day,checked:true,requestId:'uncertain'}).ok, true);
  await new Promise(setImmediate);
  assert.equal(call({action:'accountAList'}).data.days[0].printResult, 'uncertain');
  db.close(); db = openDatabase(dir);
  setup(job => { jobs.push(job); return 'accepted'; });
  assert.equal(call({action:'accountARetry',dayId:day,checked:true,requestId:'uncertain'}).ok, true);
  await new Promise(setImmediate);
  assert.equal(jobs.filter(j => j.destination === 'account-a-close').length, 2, 'same uncertain request does not print twice');
  assert.equal(call({action:'accountARetry',dayId:day,checked:true,requestId:'after-check'}).ok, true);
  await new Promise(setImmediate);
  const report = call({action:'accountAList'}).data.days[0];
  assert.equal(report.printResult, 'accepted');
  assert.equal(report.printAttempts, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_a_closes').get().n, 1);
  const backup = path.join(root, 'sample.enc'), restoredDir = path.join(root, 'restored');
  const phrase = randomBytes(24).toString('hex');
  fs.mkdirSync(restoredDir);
  await createBackup(dir, backup, phrase);
  restoreBackup(backup, restoredDir, phrase);
  const restored = new DatabaseSync(path.join(restoredDir, 'arra.sqlite'), { readOnly: true });
  try {
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM account_a_closes').get().n, 1);
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM account_a_attempts').get().n, 3);
    assert.equal(restored.prepare('SELECT COUNT(*) n FROM account_a_results').get().n, 2);
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { restored.close(); }
});
