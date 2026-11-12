const { hasPermissions } = require('./permissions');
const { recordAudit } = require('./audit');
const CHANNEL = 'arra:language';
const key = 'app.language';
function registerLanguage(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype) return { ok: false };
    const keys = Reflect.ownKeys(req);
    try {
      if (keys.length === 1 && req.action === 'get') {
        const value = db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key)?.value;
        return { ok: true, language: value === 'sq' ? 'sq' : 'en' };
      }
      if (keys.length !== 2 || !Object.hasOwn(req, 'language') || req.action !== 'set' || !['en', 'sq'].includes(req.language)) return { ok: false };
      const actor = session.currentUserId();
      if (!actor || actor !== session.authenticatedUserId() || !hasPermissions(db, session, 'employees.change')) return { ok: false };
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key)?.value;
        db.prepare('INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, req.language);
        if (previous !== req.language) recordAudit(db, actor, 'update', 'app_language', key, null, { before: previous === 'sq' ? 'sq' : 'en', after: req.language });
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { ok: true, language: req.language };
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { registerLanguage };
