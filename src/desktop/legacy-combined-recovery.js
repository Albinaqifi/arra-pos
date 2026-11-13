// Owner-authorized recovery for a waiter-only installation. Never modify the source.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { openDatabase } = require('./database');
const { verifyLocalAccount, validUsername, validPassword, hashPassword } = require('./session');
const { recordAudit } = require('./audit');

function authorize(db, username, password, version) {
  const actor = verifyLocalAccount(db, username, password);
  if (!actor || db.prepare("SELECT 1 FROM financial_scopes WHERE scope <> 'waiter' LIMIT 1").get() ||
      db.prepare('SELECT 1 FROM local_users u LEFT JOIN financial_scopes f ON f.user_id=u.id WHERE f.user_id IS NULL LIMIT 1').get() ||
      db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(actor)?.scope !== 'waiter' ||
      db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(actor) ||
      (version >= 29 && db.prepare('SELECT 1 FROM pending_staff WHERE user_id=?').get(actor)) ||
      !['employees.view', 'employees.change'].every(p => db.prepare('SELECT 1 FROM user_permissions WHERE user_id=? AND permission=?').get(actor, p))) {
    throw Error('Recovery authorization failed');
  }
  return actor;
}

async function recoverLegacyCombined(sourceFile, destination, username, password, newUsername, newPassword) {
  if (!path.isAbsolute(sourceFile) || path.basename(sourceFile) !== 'arra.sqlite' || !fs.statSync(sourceFile).isFile() ||
      !path.isAbsolute(destination) || !validUsername(newUsername) || !validPassword(newPassword)) throw Error('Invalid recovery input');
  let source, copy, created = false, completed = false;
  try {
    source = new DatabaseSync(sourceFile, { readOnly: true });
    const version = source.prepare('PRAGMA user_version').get().user_version;
    if (version < 24 || version > 31) throw Error('Unsupported database version');
    authorize(source, username, password, version);
    // mkdir is exclusive: no existing directory, data or source file is overwritten.
    fs.mkdirSync(destination); created = true;
    await backup(source, path.join(destination, 'arra.sqlite'));
    source.close(); source = null;
    copy = openDatabase(destination);
    copy.exec('BEGIN IMMEDIATE');
    try {
      const actor = authorize(copy, username, password, 31);
      const salt = randomBytes(16);
      const id = copy.prepare('INSERT INTO local_users(username,salt,password_hash) VALUES(?,?,?)').run(newUsername, salt, hashPassword(newPassword, salt)).lastInsertRowid;
      copy.prepare("INSERT INTO financial_scopes(user_id,scope) VALUES (?,'combined')").run(id);
      const grant = copy.prepare('INSERT INTO user_permissions(user_id,permission) VALUES (?,?)');
      for (const permission of ['tables.change','menu.change','employees.view','employees.change','business_days.close','orders.correct_sent']) grant.run(id, permission);
      recordAudit(copy, actor, 'legacy_combined_recovery', 'employee', id, null, {});
      copy.exec('COMMIT');
    } catch (error) { copy.exec('ROLLBACK'); throw error; }
    copy.close(); copy = null; completed = true;
    return destination;
  } finally {
    if (source) source.close();
    if (copy) copy.close();
    if (created && !completed) fs.rmSync(destination, { recursive: true, force: true });
  }
}
module.exports = { recoverLegacyCombined };
