// Recover a sample database into a new isolated directory; never write to the source.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { openDatabase } = require('./database');
const { verifyLocalAccount } = require('./session');
const { recordAudit } = require('./audit');

function provisionSampleWaiter(db, username, password) {
  const actor = verifyLocalAccount(db, username, password);
  if (!actor) throw new Error('Sample account unavailable');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM financial_scopes WHERE scope IN ('A','B','combined') LIMIT 1").get()) throw new Error('Scoped owners exist');
    if (db.prepare('SELECT 1 FROM financial_scopes WHERE user_id=?').get(actor)) throw new Error('Account already scoped');
    db.prepare("INSERT INTO financial_scopes(user_id,scope) VALUES (?, 'waiter')").run(actor);
    recordAudit(db, actor, 'sample_waiter_setup', 'employee', actor, null, {});
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
async function recoverSample(sourceFile, username, password) {
  if (!path.isAbsolute(sourceFile) || !fs.statSync(sourceFile).isFile()) throw new Error('Sample database unavailable');
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  let directory, copy;
  try {
    if (!verifyLocalAccount(source, username, password)) throw new Error('Sample account unavailable');
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-sample-recovery-'));
    await backup(source, path.join(directory, 'arra.sqlite'));
    source.close();
    copy = openDatabase(directory);
    provisionSampleWaiter(copy, username, password);
    fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Recovered development sample data only. No real sales.\n', { flag:'wx' });
    return directory;
  } finally { if (source.isOpen) source.close(); if (copy) copy.close(); }
}
module.exports = { provisionSampleWaiter, recoverSample };
