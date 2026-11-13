const { recordAudit } = require('./audit');
const { randomBytes } = require('node:crypto');
const { hasPermissions } = require('./permissions');
const { hashPassword, validUsername, validPassword } = require('./session');
const CHANNEL = 'arra:employee-config';
// Financial access is managed separately by Combined.
const PERMISSIONS = ['tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change', 'orders.correct_sent'];
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, names) => Reflect.ownKeys(x).length === names.length && names.every(n => Object.hasOwn(x, n));
const validId = x => Number.isSafeInteger(x) && x > 0;
const validPin = (x, length) => typeof x === 'string' && (length === 6 ? /^\d{6}$/ : /^\d{4}$/).test(x);
function credential(value) { const salt = randomBytes(16); return [salt, hashPassword(value, salt)]; }
function usableAdministrator(db) {
  const requireCombined = !!db.prepare("SELECT 1 FROM financial_scopes WHERE scope='combined' LIMIT 1").get();
  return db.prepare("SELECT 1 FROM local_users u JOIN financial_scopes f ON f.user_id=u.id WHERE u.active = 1 AND (? = 0 OR f.scope='combined') AND EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission = 'employees.view') AND EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission = 'employees.change') LIMIT 1").get(Number(requireCombined));
}
function scopeOf(db, id) { return db.prepare('SELECT scope FROM financial_scopes WHERE user_id = ?').get(id)?.scope; }
function canManageTarget(db, actor, target) {
  const actorScope = scopeOf(db, actor), targetScope = scopeOf(db, target);
  if (!actorScope || !targetScope || db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(target)) return false;
  if (targetScope !== 'waiter') return actorScope === 'combined' && actor !== target;
  if (['A', 'B', 'combined'].includes(actorScope)) return !db.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission='business_days.close'").get(target);
  if (actorScope !== 'waiter') return false;
  const held = new Set(db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(actor).map(r => r.permission));
  return db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(target).every(r => PERMISSIONS.includes(r.permission) && held.has(r.permission));
}
function registerEmployeeConfig(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !plain(req) || typeof req.action !== 'string') return { ok: false, error: 'Invalid request' };
    const actor = session.currentUserId();
    // Password-authenticated identity must be the actor; a PIN-less selection is not sufficient.
    if (!actor || actor !== session.authenticatedUserId() || !hasPermissions(db, session, req.action === 'list' ? 'employees.view' : 'employees.change')) return { ok: false, error: 'Access denied. Sign in as the administrator and select the same name.' };
    try {
      if (req.action === 'list' && keys(req, ['action'])) {
        const users = db.prepare('SELECT u.id, u.username, u.active, u.pin_hash IS NOT NULL AS hasPin, f.scope, EXISTS(SELECT 1 FROM pending_staff ps WHERE ps.user_id=u.id) AS pending, EXISTS(SELECT 1 FROM restaurant_accounts r WHERE r.user_id=u.id) AS restaurant, EXISTS(SELECT 1 FROM transfer_managers t WHERE t.user_id=u.id) AS isTransfer FROM local_users u LEFT JOIN financial_scopes f ON f.user_id=u.id ORDER BY u.username').all();
        const grants = db.prepare('SELECT user_id AS userId, permission FROM user_permissions ORDER BY permission').all();
        const audit = db.prepare('SELECT actor_id AS actorId, target_id AS targetId, permission, granted, occurred_at AS occurredAt FROM employee_permission_audit ORDER BY id DESC LIMIT 100').all();
        const credentialAudit = db.prepare('SELECT actor_id AS actorId, target_id AS targetId, password_changed AS passwordChanged, pin_changed AS pinChanged, occurred_at AS occurredAt FROM employee_credential_audit ORDER BY id DESC LIMIT 100').all();
        const financialAudit = scopeOf(db, actor) === 'combined' ? db.prepare("SELECT actor_id AS actorId, CAST(entity_id AS INTEGER) AS targetId, context, occurred_at AS occurredAt FROM application_audit WHERE action='financial_access' AND entity_type='employee' ORDER BY id DESC LIMIT 100").all().map(row => ({ ...row, context: JSON.parse(row.context) })) : [];
        const accountAudit = db.prepare('SELECT actor_id AS actorId, target_id AS targetId, old_username AS oldUsername, new_username AS newUsername, old_active AS oldActive, new_active AS newActive, occurred_at AS occurredAt FROM employee_account_audit ORDER BY id DESC LIMIT 100').all();
        return { ok: true, data: { users, grants, audit, credentialAudit, accountAudit, financialAudit, permissions: PERMISSIONS, actorId: actor, actorScope: scopeOf(db, actor) } };
      }
      if (req.action === 'createPending' && keys(req, ['action', 'username']) && validUsername(req.username)) {
        if (!['A', 'B'].includes(scopeOf(db, actor))) return { ok: false, error: 'Access denied' };
        // The generated password is never returned. Combined must provision credentials.
        const [salt, hash] = credential(randomBytes(32).toString('hex'));
        db.exec('BEGIN IMMEDIATE');
        try {
          const created = db.prepare('INSERT INTO local_users(username, salt, password_hash, active) VALUES (?, ?, ?, 0)').run(req.username, salt, hash);
          db.prepare("INSERT INTO financial_scopes(user_id, scope) VALUES (?, 'waiter')").run(created.lastInsertRowid);
          db.prepare("INSERT INTO pending_staff(user_id) VALUES (?)").run(created.lastInsertRowid);
          recordAudit(db, actor, 'create', 'employee', created.lastInsertRowid, null, {});
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      if (req.action === 'createRestaurant' && keys(req, ['action', 'username', 'password']) && validUsername(req.username) && validPassword(req.password)) {
        if (scopeOf(db, actor) !== 'combined') return { ok: false, error: 'Access denied' };
        const [salt, hash] = credential(req.password);
        db.exec('BEGIN IMMEDIATE');
        try {
          const created = db.prepare('INSERT INTO local_users(username, salt, password_hash) VALUES (?, ?, ?)').run(req.username, salt, hash);
          db.prepare("INSERT INTO financial_scopes(user_id, scope) VALUES (?, 'waiter')").run(created.lastInsertRowid);
          db.prepare('INSERT INTO restaurant_accounts(user_id) VALUES (?)').run(created.lastInsertRowid);
          recordAudit(db, actor, 'create', 'employee', created.lastInsertRowid, null, {});
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      if (req.action === 'createTransfer' && keys(req, ['action', 'username', 'pin']) && validUsername(req.username) && validPin(req.pin, 6)) {
        if (scopeOf(db, actor) !== 'combined') return { ok: false, error: 'Access denied' };
        const [salt, hash] = credential(randomBytes(32).toString('hex'));
        const [pinSalt, pinHash] = credential(req.pin);
        db.exec('BEGIN IMMEDIATE');
        try {
          const created = db.prepare('INSERT INTO local_users(username, salt, password_hash, pin_salt, pin_hash) VALUES (?, ?, ?, ?, ?)').run(req.username, salt, hash, pinSalt, pinHash);
          db.prepare('INSERT INTO transfer_managers(user_id) VALUES (?)').run(created.lastInsertRowid);
          recordAudit(db, actor, 'create', 'employee', created.lastInsertRowid, null, {});
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      if (req.action === 'create' && keys(req, ['action', 'username', 'password', 'pin']) && validUsername(req.username) && validPassword(req.password) && validPin(req.pin, 4)) {
        if (scopeOf(db, actor) !== 'combined') return { ok: false, error: 'Access denied' };
        const [salt, hash] = credential(req.password); const [pinSalt, pinHash] = req.pin ? credential(req.pin) : [null, null];
        db.exec('BEGIN IMMEDIATE');
        try {
          const created = db.prepare('INSERT INTO local_users(username, salt, password_hash, pin_salt, pin_hash) VALUES (?, ?, ?, ?, ?)').run(req.username, salt, hash, pinSalt, pinHash);
          db.prepare("INSERT INTO financial_scopes(user_id, scope) VALUES (?, 'waiter')").run(created.lastInsertRowid);
          recordAudit(db, actor, 'create', 'employee', created.lastInsertRowid, null, {});
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      if (req.action === 'account' && keys(req, ['action', 'id', 'username', 'active']) && validId(req.id) && validUsername(req.username) && typeof req.active === 'boolean') {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!canManageTarget(db, actor, req.id) && !(scopeOf(db, actor) === 'combined' && db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(req.id))) throw new Error('Target has additional permissions');
          if (req.active && db.prepare('SELECT 1 FROM pending_staff WHERE user_id=?').get(req.id)) throw new Error('Credentials must be provisioned first');
          if (req.active && scopeOf(db, req.id) === 'waiter' && !db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(req.id) && !db.prepare('SELECT 1 FROM local_users WHERE id=? AND pin_hash IS NOT NULL AND pin_salt IS NOT NULL').get(req.id)) throw new Error('PIN must be provisioned first');
          const previous = db.prepare('SELECT username, active FROM local_users WHERE id = ?').get(req.id);
          if (!previous) throw new Error('Missing account');
          if (!db.prepare('UPDATE local_users SET username = ?, active = ? WHERE id = ?').run(req.username, Number(req.active), req.id).changes) throw new Error('Missing account');
          if (!usableAdministrator(db)) throw new Error('Last administrator');
          if (previous.username !== req.username || previous.active !== Number(req.active)) db.prepare('INSERT INTO employee_account_audit(actor_id, target_id, old_username, new_username, old_active, new_active, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(actor, req.id, previous.username, req.username, previous.active, Number(req.active), Date.now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        if (!req.active) session.invalidateUser(req.id);
        return { ok: true };
      }
      if (req.action === 'credential' && keys(req, ['action', 'id', 'password', 'pin']) && validId(req.id) && (req.password === null || validPassword(req.password)) && (req.password !== null || req.pin !== null)) {
        if (scopeOf(db, actor) !== 'combined') return { ok: false, error: 'Access denied' };
        const exists = db.prepare('SELECT id FROM local_users WHERE id = ?').get(req.id); if (!exists) return { ok: false, error: 'Account unavailable' };
        const isTransfer = !!db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(req.id);
        const isRestaurant = !!db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(req.id);
        if ((!isTransfer && !canManageTarget(db, actor, req.id)) || (isTransfer && req.password !== null) || (req.pin !== null && (isRestaurant || (!isTransfer && scopeOf(db, req.id) !== 'waiter') || !validPin(req.pin, isTransfer ? 6 : 4)))) return { ok: false, error: 'Access denied' };
        const password = req.password !== null ? credential(req.password) : null;
        const pin = req.pin !== null ? credential(req.pin) : null;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (password) { db.prepare('UPDATE local_users SET salt = ?, password_hash = ? WHERE id = ?').run(...password, req.id); db.prepare('DELETE FROM pending_staff WHERE user_id=?').run(req.id); }
          if (pin) db.prepare('UPDATE local_users SET pin_salt = ?, pin_hash = ? WHERE id = ?').run(...pin, req.id);
          db.prepare('INSERT INTO employee_credential_audit(actor_id, target_id, password_changed, pin_changed, occurred_at) VALUES (?, ?, ?, ?, ?)').run(actor, req.id, Number(!!password), Number(!!pin), Date.now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        session.invalidateUser(req.id); return { ok: true };
      }
      if (req.action === 'permissions' && keys(req, ['action', 'id', 'permissions']) && validId(req.id) && Array.isArray(req.permissions) && req.permissions.every(p => typeof p === 'string' && PERMISSIONS.includes(p)) && new Set(req.permissions).size === req.permissions.length) {
        if (scopeOf(db, actor) !== 'combined' || db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(req.id)) return { ok: false, error: 'Access denied' };
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!db.prepare('SELECT 1 FROM local_users WHERE id = ?').get(req.id)) throw new Error('Missing account');
          if (!canManageTarget(db, actor, req.id)) throw new Error('Target has restricted scope');
          const old = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(req.id).map(r => r.permission);
          const actorGrants = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(actor).map(r => r.permission);
          const changed = PERMISSIONS.filter(p => old.includes(p) !== req.permissions.includes(p));
          if (actor === req.id && changed.some(p => req.permissions.includes(p))) throw new Error('Cannot grant own permissions');
          if (scopeOf(db, actor) === 'waiter' && changed.some(p => !actorGrants.includes(p))) throw new Error('Cannot manage unheld permissions');
          const add = db.prepare('INSERT INTO user_permissions(user_id, permission) VALUES (?, ?)');
          const remove = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?');
          const audit = db.prepare('INSERT INTO employee_permission_audit(actor_id, target_id, permission, granted, occurred_at) VALUES (?, ?, ?, ?, ?)');
          for (const p of changed) { const granted = req.permissions.includes(p); (granted ? add : remove).run(req.id, p); audit.run(actor, req.id, p, Number(granted), Date.now()); }
          if (!usableAdministrator(db)) throw new Error('Last administrator');
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      if (req.action === 'financialAccess' && keys(req, ['action', 'id', 'scope', 'close']) && validId(req.id) && ['waiter', 'A', 'B', 'combined'].includes(req.scope) && typeof req.close === 'boolean') {
        if (scopeOf(db, actor) !== 'combined' || actor === req.id || db.prepare('SELECT 1 FROM transfer_managers WHERE user_id=?').get(req.id) || db.prepare('SELECT 1 FROM restaurant_accounts WHERE user_id=?').get(req.id) || (req.scope !== 'combined' && req.close)) return { ok: false, error: 'Access denied' };
        db.exec('BEGIN IMMEDIATE');
        try {
          const old = scopeOf(db, req.id);
          if (!old) throw new Error('Missing account');
          const oldClose = !!db.prepare("SELECT 1 FROM user_permissions WHERE user_id=? AND permission='business_days.close'").get(req.id);
          db.prepare('UPDATE financial_scopes SET scope=? WHERE user_id=?').run(req.scope, req.id);
          if (req.close) db.prepare("INSERT OR IGNORE INTO user_permissions VALUES (?, 'business_days.close')").run(req.id);
          else db.prepare("DELETE FROM user_permissions WHERE user_id=? AND permission='business_days.close'").run(req.id);
          if (old !== req.scope || oldClose !== req.close) recordAudit(db, actor, 'financial_access', 'employee', req.id, null, { before: { scope: old, close: oldClose }, after: { scope: req.scope, close: req.close } });
          if (!usableAdministrator(db)) throw new Error('Last administrator');
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        session.invalidateUser(req.id);
        return { ok: true };
      }
      return { ok: false, error: 'Invalid request' };
    } catch (_) { return { ok: false, error: 'Could not save employee configuration. Check the account, permissions, and that an administrator remains active.' }; }
  });
}
module.exports = { CHANNEL, PERMISSIONS, registerEmployeeConfig };
