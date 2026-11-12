// Explicit sample-only recovery: authenticate an existing waiter administrator,
// then provision Combined only on an isolated copy with no owner scopes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { openDatabase } = require('./database');
const { createSession } = require('./session');
const { recordAudit } = require('./audit');
function authorizedWaiter(db, username, password) {
  const session = createSession(db);
  if (!session.signIn({ username, password }).ok) throw Error('Sample administrator unavailable');
  const id = session.authenticatedUserId();
  if (db.prepare("SELECT 1 FROM financial_scopes WHERE scope <> 'waiter' LIMIT 1").get() ||
      db.prepare('SELECT 1 FROM local_users u LEFT JOIN financial_scopes f ON f.user_id=u.id WHERE f.user_id IS NULL LIMIT 1').get() ||
      db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(id) ||
      db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(id)?.scope !== 'waiter' ||
      !['employees.view','employees.change'].every(p => db.prepare('SELECT 1 FROM user_permissions WHERE user_id=? AND permission=?').get(id,p))) throw Error('Sample administrator unavailable');
  return id;
}
async function recoverSampleCombined(sourceFile, username, password) {
  if (!path.isAbsolute(sourceFile) || path.basename(sourceFile) !== 'arra.sqlite' || !fs.statSync(sourceFile).isFile() || !fs.statSync(path.join(path.dirname(sourceFile), 'SAMPLE-DATA-ONLY')).isFile()) throw Error('Sample database unavailable');
  const source = new DatabaseSync(sourceFile, { readOnly:true }); let copy, directory, completed=false;
  try {
    const version = source.prepare('PRAGMA user_version').get().user_version;
    if (version < 24 || version > 30) throw Error('Unsupported sample version');
    const sourceActor = authorizedWaiter(source, username, password);
    if (version >= 29 && source.prepare('SELECT 1 FROM pending_staff WHERE user_id=?').get(sourceActor)) throw Error('Sample administrator unavailable');
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'arra-sample-combined-'));
    await backup(source,path.join(directory,'arra.sqlite'));
    source.close(); copy=openDatabase(directory);
    const actor=authorizedWaiter(copy,username,password);
    copy.exec('BEGIN IMMEDIATE');
    try {
      copy.prepare("UPDATE financial_scopes SET scope='combined' WHERE user_id=? AND scope='waiter'").run(actor);
      for (const permission of ['tables.change','menu.change','employees.view','employees.change','business_days.close']) copy.prepare('INSERT OR IGNORE INTO user_permissions VALUES (?,?)').run(actor,permission);
      recordAudit(copy,actor,'sample_combined_setup','employee',actor,null,{});
      copy.exec('COMMIT');
    } catch (error) { copy.exec('ROLLBACK'); throw error; }
    fs.writeFileSync(path.join(directory,'SAMPLE-DATA-ONLY'),'Recovered development sample data only. No real sales.\n',{flag:'wx'});
    completed=true;
    return directory;
  } finally {
    if (source.isOpen) source.close();
    if (copy) copy.close();
    if (directory && !completed) fs.rmSync(directory, { recursive:true, force:true });
  }
}
module.exports={recoverSampleCombined};
