const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { hasPermissions, hasTableConfigPermission } = require('./permissions');
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
    if (['local_users', 'orders', 'bills', 'payments', 'application_audit'].some(table => db.prepare('SELECT 1 FROM ' + table + ' LIMIT 1').get())) throw new Error('Initial account requires an empty database');
    const user = db.prepare('INSERT INTO local_users (username, salt, password_hash) VALUES (?, ?, ?)').run(username, salt, hash);
    db.prepare("INSERT INTO financial_scopes(user_id, scope) VALUES (?, 'combined')").run(user.lastInsertRowid);
    const grant = db.prepare('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)');
    for (const permission of ['tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change', 'orders.correct_sent', 'business_days.close']) grant.run(user.lastInsertRowid, permission);
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
        return { ok: true, data: db.prepare("SELECT u.id, CASE WHEN tm.user_id IS NULL THEN u.username ELSE 'Duda' END AS name, u.pin_hash IS NOT NULL AS hasPin, tm.user_id IS NOT NULL AS isTransfer FROM local_users u LEFT JOIN transfer_managers tm ON tm.user_id=u.id WHERE u.active = 1 AND NOT EXISTS (SELECT 1 FROM pending_staff ps WHERE ps.user_id=u.id) AND (tm.user_id IS NULL OR (u.pin_hash IS NOT NULL AND u.pin_salt IS NOT NULL)) ORDER BY isTransfer, u.username").all().map(row => ({ id: row.id, name: row.name, hasPin: row.hasPin === 1, isTransfer: row.isTransfer === 1 })) };
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
        if (!row || row.active !== 1 || db.prepare('SELECT 1 FROM pending_staff WHERE user_id=?').get(request.id)) return fail();
        const selectedTransfer = Boolean(db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(request.id));
        if (db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(restaurantId)) return fail();
        if (selectedTransfer && (!row.pin_hash || !row.pin_salt)) return fail();
        if (row.pin_hash !== null || row.pin_salt !== null) {
          if (!row.pin_hash || !row.pin_salt || !/^\d{4}$/.test(request.pin)) return fail();
          const candidate = hashPassword(request.pin, row.pin_salt), expected = Buffer.from(row.pin_hash);
          if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return fail();
        } else if (request.pin !== '') return fail();
        activeId = request.id;
        return { ok: true };
      } catch (_) { return fail(); }
    },
    authenticatedUserId() { return restaurantActive() ? restaurantId : null; },
    invalidateUser(id) {
      if (restaurantId === id) { restaurantId = null; activeId = null; }
      else if (activeId === id) activeId = null;
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
  const adminAccess = () => {
    const current = session.currentUserId(), authenticated = session.authenticatedUserId();
    return current !== null && current === authenticated && (hasTableConfigPermission(db, session) || ['menu.change', 'employees.view', 'employees.change'].some(permission => hasPermissions(db, session, permission)));
  };
  ipcMain.handle('arra:admin-access', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) return { ok: false };
    return { ok: true, signedIn: session.authenticatedUserId() !== null, selected: session.currentUserId() !== null, admin: adminAccess() };
  });
  ipcMain.handle('arra:sign-in', (event, request) => isAllowedSender(event) ? session.signIn(request) : failure());
  ipcMain.handle('arra:waiters', (event, request) => isAllowedSender(event) && request && typeof request === 'object' && !Array.isArray(request) && Object.getPrototypeOf(request) === Object.prototype && Reflect.ownKeys(request).length === 0 ? session.listWaiters() : { ok: false });
  ipcMain.handle('arra:select-waiter', (event, request) => {
    if (!isAllowedSender(event)) return { ok: false };
    const result = session.selectWaiter(request);
    if (!result.ok) return result;
    return { ok: true, admin: adminAccess() };
  });
  ipcMain.handle('arra:clear-waiter', (event, request) => isAllowedSender(event) && request && typeof request === 'object' && !Array.isArray(request) && Object.getPrototypeOf(request) === Object.prototype && Reflect.ownKeys(request).length === 0 ? session.clearWaiter() : { ok: false });
  ipcMain.handle('arra:sign-out', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Sign out failed' };
    return session.signOut();
  });
  return session;
}
module.exports = { bootstrap, createSession, registerSession, hashPassword, validUsername, validPassword };
