// Explicitly upgrade an isolated sample copy; never alter the source database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');
const { openDatabase } = require('./database');
const { createSession } = require('./session');
const { recordAudit } = require('./audit');

async function upgradeSampleBusinessDays(sourceFile, username, password) {
  if (!path.isAbsolute(sourceFile) || path.basename(sourceFile) !== 'arra.sqlite' ||
      !fs.statSync(sourceFile).isFile() || !fs.statSync(path.join(path.dirname(sourceFile), 'SAMPLE-DATA-ONLY')).isFile()) throw new Error('Sample database unavailable');
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  let directory, copy;
  try {
    if (![22, 23, 24, 25, 26, 27, 28, 29].includes(source.prepare('PRAGMA user_version').get().user_version)) throw new Error('Expected version 22 through 29 sample');
    const sourceSession = createSession(source);
    if (!sourceSession.signIn({ username, password }).ok || source.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(sourceSession.authenticatedUserId())?.scope !== 'combined') throw new Error('Combined sample account unavailable');
    if (source.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission='business_days.close'").get(sourceSession.authenticatedUserId())) throw new Error('Close grant already exists');
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-sample-day-upgrade-'));
    await backup(source, path.join(directory, 'arra.sqlite'));
    source.close();
    copy = openDatabase(directory);
    const session = createSession(copy);
    if (!session.signIn({ username, password }).ok || copy.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(session.authenticatedUserId())?.scope !== 'combined') throw new Error('Combined sample account unavailable');
    const actor = session.authenticatedUserId();
    copy.exec('BEGIN IMMEDIATE');
    try {
      copy.prepare("INSERT INTO user_permissions(user_id,permission) VALUES (?, 'business_days.close')").run(actor);
      recordAudit(copy, actor, 'sample_day_close_grant', 'employee', actor, null, {});
      copy.exec('COMMIT');
    } catch (error) { copy.exec('ROLLBACK'); throw error; }
    fs.writeFileSync(path.join(directory, 'SAMPLE-DATA-ONLY'), 'Upgraded development sample data only. No real sales.\n', { flag:'wx' });
    return directory;
  } finally { if (source.isOpen) source.close(); if (copy) copy.close(); }
}
module.exports = { upgradeSampleBusinessDays };
