const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const failure = () => ({ ok: false, error: 'Sign in failed' });
const validUsername = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 128;
const validPassword = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 1024;
function hashPassword(password, salt) { return scryptSync(password, salt, 32, OPTIONS); }
function bootstrap(db, username, password) {
  if (!validUsername(username) || !validPassword(password)) throw new Error('Invalid account input');
  const salt = randomBytes(16);
  const hash = hashPassword(password, salt);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT count(*) AS count FROM local_users').get().count !== 0) throw new Error('An account already exists');
    db.prepare('INSERT INTO local_users (username, salt, password_hash) VALUES (?, ?, ?)').run(username, salt, hash);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function createSession(db) {
  let activeId = null;
  return {
    signIn(request) {
      activeId = null;
      if (!request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
          Reflect.ownKeys(request).length !== 2 || !Object.hasOwn(request, 'username') || !Object.hasOwn(request, 'password') ||
          !validUsername(request.username) || !validPassword(request.password)) return failure();
      try {
        const row = db.prepare('SELECT id, salt, password_hash, active FROM local_users WHERE username = ?').get(request.username);
        // Perform the same work for an unknown username without storing a credential.
        const salt = row ? row.salt : Buffer.alloc(16);
        const candidate = hashPassword(request.password, salt);
        const expected = row ? Buffer.from(row.password_hash) : Buffer.alloc(32);
        if (expected.length !== candidate.length || !timingSafeEqual(candidate, expected) || !row || row.active !== 1) return failure();
        activeId = row.id;
        return { ok: true };
      } catch (_) { return failure(); }
    },
    signOut() { activeId = null; return { ok: true }; },
    currentUserId() {
      if (activeId === null) return null;
      try {
        if (db.prepare('SELECT active FROM local_users WHERE id = ?').get(activeId)?.active === 1) return activeId;
      } catch (_) {}
      activeId = null;
      return null;
    },
  };
}
function registerSession(ipcMain, isAllowedSender, db) {
  const session = createSession(db);
  ipcMain.handle('arra:sign-in', (event, request) => isAllowedSender(event) ? session.signIn(request) : failure());
  ipcMain.handle('arra:sign-out', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Sign out failed' };
    return session.signOut();
  });
  return session;
}
module.exports = { bootstrap, createSession, registerSession };
