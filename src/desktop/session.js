const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { hasPermissions, hasTableConfigPermission } = require('./permissions');
const { untouchedOrder } = require('./untouched-order');
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const failure = () => ({ ok: false, error: 'Sign in failed' });
const validUsername = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 128;
const validPassword = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 1024;
function hashPassword(password, salt) { return scryptSync(password, salt, 32, OPTIONS); }
function verifyLocalAccount(db, username, password) {
  if (!validUsername(username) || !validPassword(password)) return null;
  try {
    const row = db.prepare('SELECT id, salt, password_hash, active FROM local_users WHERE username=?').get(username);
    const candidate = hashPassword(password, row ? row.salt : Buffer.alloc(16));
    const expected = row ? Buffer.from(row.password_hash) : Buffer.alloc(32);
    return row && row.active === 1 && expected.length === candidate.length && timingSafeEqual(candidate, expected) ? row.id : null;
  } catch (_) { return null; }
}
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
  let restaurantId = null, activeId = null, generation = 0;
  function restaurantActive() {
    try { return restaurantId !== null && db.prepare('SELECT active FROM local_users WHERE id = ?').get(restaurantId)?.active === 1; }
    catch (_) { return false; }
  }
  return {
    signIn(request) {
      generation++;
      activeId = null; restaurantId = null;
      if (!request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
          Reflect.ownKeys(request).length !== 2 || !Object.hasOwn(request, 'username') || !Object.hasOwn(request, 'password') ||
          !validUsername(request.username) || !validPassword(request.password)) return failure();
      try {
        const row = db.prepare('SELECT u.id, u.username, u.salt, u.password_hash, u.active, f.scope, EXISTS(SELECT 1 FROM restaurant_accounts r WHERE r.user_id=u.id) AS restaurant FROM local_users u LEFT JOIN financial_scopes f ON f.user_id=u.id WHERE u.username = ?').get(request.username);
        // Perform the same work for an unknown username without storing a credential.
        const salt = row ? row.salt : Buffer.alloc(16);
        const candidate = hashPassword(request.password, salt);
        const expected = row ? Buffer.from(row.password_hash) : Buffer.alloc(32);
        if (expected.length !== candidate.length || !timingSafeEqual(candidate, expected) || !row || row.active !== 1) return failure();
        if (db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(row.id) || !((row.restaurant === 1 && row.scope === 'waiter') || (row.restaurant === 0 && ['A', 'B', 'combined'].includes(row.scope)))) return failure();
        restaurantId = row.id;
        if (!row.restaurant) { activeId = row.id; return { ok: true, admin: true, name: row.username }; }
        return { ok: true, admin: false };
      } catch (_) { return failure(); }
    },
    signOut() { generation++; activeId = null; restaurantId = null; return { ok: true }; },
    clearWaiter() { generation++; activeId = null; return { ok: true }; },
    identifyStaff(request) {
      generation++;
      const fail = () => ({ ok: false, error: 'Staff identification failed' });
      try {
        const restaurant = restaurantActive() && !!db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(restaurantId);
        // A new attempt ends any previous staff identity, including on failure.
        if (restaurant) activeId = null;
        if (!restaurant || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
            Reflect.ownKeys(request).length !== 2 || !Object.hasOwn(request, 'pin') || !Object.hasOwn(request, 'kind') ||
            !['waiter', 'transfer'].includes(request.kind) || typeof request.pin !== 'string' ||
            !(request.kind === 'waiter' ? /^\d{4}$/ : /^\d{6}$/).test(request.pin)) return fail();
        // Include active unverified legacy credentials in ambiguity detection. A
        // single unverified match is still denied until Combined resets its PIN.
        const rows = db.prepare(`SELECT u.id,u.username,u.pin_salt,u.pin_hash,
          EXISTS(SELECT 1 FROM verified_waiter_pins v WHERE v.user_id=u.id) AS verified
          FROM local_users u LEFT JOIN financial_scopes f ON f.user_id=u.id
          WHERE u.active=1 AND u.pin_salt IS NOT NULL AND u.pin_hash IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM pending_staff p WHERE p.user_id=u.id)
          AND NOT EXISTS(SELECT 1 FROM restaurant_accounts r WHERE r.user_id=u.id)
          AND (CASE WHEN ?='waiter' THEN f.scope='waiter' AND NOT EXISTS(SELECT 1 FROM transfer_managers t WHERE t.user_id=u.id)
                    ELSE EXISTS(SELECT 1 FROM transfer_managers t WHERE t.user_id=u.id) END)`).all(request.kind);
        const matches = [];
        for (const row of rows) {
          const actual = hashPassword(request.pin, row.pin_salt), expected = Buffer.from(row.pin_hash);
          if (expected.length !== actual.length) return fail();
          if (timingSafeEqual(actual, expected)) matches.push(row);
        }
        if (matches.length !== 1 || (request.kind === 'waiter' && matches[0].verified !== 1)) return fail();
        activeId = matches[0].id;
        return { ok: true, data: { id: activeId, name: matches[0].username, isTransfer: request.kind === 'transfer' } };
      } catch (_) { return fail(); }
    },
    listWaiters() {
      if (!restaurantActive() || !db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(restaurantId)) return { ok: false, error: 'Access denied' };
      try {
        return { ok: true, data: db.prepare("SELECT u.id, u.username AS name, u.pin_hash IS NOT NULL AND u.pin_salt IS NOT NULL AS hasPin, tm.user_id IS NOT NULL AS isTransfer FROM local_users u LEFT JOIN transfer_managers tm ON tm.user_id=u.id LEFT JOIN financial_scopes f ON f.user_id=u.id WHERE u.active = 1 AND NOT EXISTS (SELECT 1 FROM pending_staff ps WHERE ps.user_id=u.id) AND NOT EXISTS (SELECT 1 FROM restaurant_accounts r WHERE r.user_id=u.id) AND (f.scope='waiter' OR tm.user_id IS NOT NULL) ORDER BY isTransfer, u.username").all().map(row => ({ id: row.id, name: row.name, hasPin: row.hasPin === 1, isTransfer: row.isTransfer === 1 })) };
      } catch (_) { return { ok: false, error: 'Waiters unavailable' }; }
    },
    selectWaiter(request) {
      generation++;
      // A failed waiter switch clears the former selected waiter. Owner
      // sessions do not use this entry path and retain their identity.
      if (restaurantId !== null && db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(restaurantId)) activeId = null;
      const fail = () => ({ ok: false, error: 'Waiter selection failed' });
      if (!restaurantActive() || !request || typeof request !== 'object' || Array.isArray(request) ||
          Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 2 ||
          !Number.isSafeInteger(request.id) || request.id <= 0 || typeof request.pin !== 'string' ||
          !Object.hasOwn(request, 'id') || !Object.hasOwn(request, 'pin')) return fail();
      try {
        if (!db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(restaurantId)) return fail();
        const row = db.prepare('SELECT u.active, u.pin_salt, u.pin_hash, f.scope FROM local_users u LEFT JOIN financial_scopes f ON f.user_id=u.id WHERE u.id = ?').get(request.id);
        if (!row || row.active !== 1 || db.prepare('SELECT 1 FROM pending_staff WHERE user_id=?').get(request.id)) return fail();
        const selectedTransfer = Boolean(db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(request.id));
        if ((!selectedTransfer && row.scope !== 'waiter') || db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(request.id)) return fail();
        {
          if (!row.pin_hash || !row.pin_salt || !(selectedTransfer ? /^\d{6}$/ : /^\d{4}$/).test(request.pin)) return fail();
          const candidate = hashPassword(request.pin, row.pin_salt), expected = Buffer.from(row.pin_hash);
          if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return fail();
        }
        activeId = request.id;
        return { ok: true };
      } catch (_) { return fail(); }
    },
    identityGeneration() { return generation; },
    authenticatedUserId() { return restaurantActive() ? restaurantId : null; },
    invalidateUser(id) {
      if (restaurantId === id || activeId === id) generation++;
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
  ipcMain.handle('arra:identify-staff', (event, request) => isAllowedSender(event) ? session.identifyStaff(request) : { ok:false });
  ipcMain.handle('arra:entry-tables', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) return {ok:false};
    try {
      const restaurant = session.authenticatedUserId();
      if (!restaurant || session.currentUserId() !== null || !db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(restaurant)) return {ok:false};
      const data = db.prepare(`SELECT t.id,COALESCE(a.name,t.area) AS area,CASE WHEN o.id IS NOT NULL AND NOT (${untouchedOrder('o')}) THEN 1 ELSE 0 END AS occupied,u.username AS waiter FROM dining_tables t LEFT JOIN dining_areas a ON a.id=t.area_id LEFT JOIN orders o ON o.table_id=t.id AND o.status='open' AND o.retired_empty=0 LEFT JOIN order_waiter_ownership w ON w.order_id=o.id LEFT JOIN local_users u ON u.id=w.waiter_id WHERE t.active=1 AND COALESCE(a.active,1)=1 ORDER BY t.id`).all();
      return {ok:true,data:data.map(row=>({id:row.id,area:row.area,occupied:row.occupied===1,waiter:row.occupied===1 ? row.waiter : null}))};
    } catch (_) { return {ok:false}; }
  });
  // The pre-identification screen exposes assigned names only for occupied tables, not a staff roster.
  ipcMain.handle('arra:waiters', () => ({ ok: false }));
  // The old name-based IPC cannot bypass PIN-only ambiguity checks.
  ipcMain.handle('arra:select-waiter', event => {
    if (isAllowedSender(event)) {
      const authenticated = session.authenticatedUserId();
      if (authenticated && db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(authenticated)) session.clearWaiter();
    }
    return { ok: false };
  });
  ipcMain.handle('arra:clear-waiter', (event, request) => isAllowedSender(event) && request && typeof request === 'object' && !Array.isArray(request) && Object.getPrototypeOf(request) === Object.prototype && Reflect.ownKeys(request).length === 0 ? session.clearWaiter() : { ok: false });
  ipcMain.handle('arra:sign-out', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Sign out failed' };
    return session.signOut();
  });
  return session;
}
module.exports = { bootstrap, createSession, registerSession, hashPassword, validUsername, validPassword, verifyLocalAccount };
