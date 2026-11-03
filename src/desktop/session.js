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
    const user = db.prepare('INSERT INTO local_users (username, salt, password_hash) VALUES (?, ?, ?)').run(username, salt, hash);
    const grant = db.prepare('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)');
    for (const permission of ['tables.view', 'tables.change', 'menu.view', 'orders.view', 'orders.change']) grant.run(user.lastInsertRowid, permission);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function createSession(db) {
  let restaurantId = null, activeId = null;
  function restaurantActive() {
    try { return restaurantId !== null && db.prepare('SELECT active FROM local_users WHERE id = ?').get(restaurantId)?.active === 1; }
    catch (_) { return false; }
  }
  return {
    signIn(request) {
      activeId = null; restaurantId = null;
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
        restaurantId = row.id;
        return { ok: true };
      } catch (_) { return failure(); }
    },
    signOut() { activeId = null; restaurantId = null; return { ok: true }; },
    clearWaiter() { activeId = null; return { ok: true }; },
    listWaiters() {
      if (!restaurantActive()) return { ok: false, error: 'Access denied' };
      try {
        return { ok: true, data: db.prepare('SELECT id, username AS name, pin_hash IS NOT NULL AS hasPin FROM local_users WHERE active = 1 ORDER BY username').all().map(row => ({ id: row.id, name: row.name, hasPin: row.hasPin === 1 })) };
      } catch (_) { return { ok: false, error: 'Waiters unavailable' }; }
    },
    selectWaiter(request) {
      const fail = () => ({ ok: false, error: 'Waiter selection failed' });
      if (!restaurantActive() || !request || typeof request !== 'object' || Array.isArray(request) ||
          Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 2 ||
          !Number.isSafeInteger(request.id) || request.id <= 0 || typeof request.pin !== 'string' ||
          !Object.hasOwn(request, 'id') || !Object.hasOwn(request, 'pin')) return fail();
      try {
        const row = db.prepare('SELECT active, pin_salt, pin_hash FROM local_users WHERE id = ?').get(request.id);
        if (!row || row.active !== 1) return fail();
        if (row.pin_hash !== null || row.pin_salt !== null) {
          if (!row.pin_hash || !row.pin_salt || !/^\d{4}$/.test(request.pin)) return fail();
          const candidate = hashPassword(request.pin, row.pin_salt), expected = Buffer.from(row.pin_hash);
          if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return fail();
        } else if (request.pin !== '') return fail();
        activeId = request.id;
        return { ok: true };
      } catch (_) { return fail(); }
    },
    currentUserId() {
      if (activeId === null || !restaurantActive()) { activeId = null; return null; }
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
  ipcMain.handle('arra:waiters', (event, request) => isAllowedSender(event) && request && typeof request === 'object' && !Array.isArray(request) && Object.getPrototypeOf(request) === Object.prototype && Reflect.ownKeys(request).length === 0 ? session.listWaiters() : { ok: false });
  ipcMain.handle('arra:select-waiter', (event, request) => isAllowedSender(event) ? session.selectWaiter(request) : { ok: false });
  ipcMain.handle('arra:clear-waiter', (event, request) => isAllowedSender(event) && request && typeof request === 'object' && !Array.isArray(request) && Object.getPrototypeOf(request) === Object.prototype && Reflect.ownKeys(request).length === 0 ? session.clearWaiter() : { ok: false });
  ipcMain.handle('arra:sign-out', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Sign out failed' };
    return session.signOut();
  });
  return session;
}
module.exports = { bootstrap, createSession, registerSession };
