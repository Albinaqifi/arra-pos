const { recordAudit } = require('./audit');
const { randomBytes } = require('node:crypto');
const { hasPermissions } = require('./permissions');
const { hashPassword, validUsername, validPassword } = require('./session');
const CHANNEL = 'arra:employee-config';
// Financial permissions and scopes are deliberately absent while Q-01 is unresolved.
const PERMISSIONS = ['tables.view', 'tables.change', 'menu.view', 'menu.change', 'orders.view', 'orders.change', 'employees.view', 'employees.change', 'orders.correct_sent'];
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, names) => Reflect.ownKeys(x).length === names.length && names.every(n => Object.hasOwn(x, n));
const validId = x => Number.isSafeInteger(x) && x > 0;
const validPin = x => x === '' || (typeof x === 'string' && /^\d{4}$/.test(x));
function credential(value) { const salt = randomBytes(16); return [salt, hashPassword(value, salt)]; }
function usableAdministrator(db) {
  return db.prepare("SELECT 1 FROM local_users u WHERE u.active = 1 AND EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission = 'employees.view') AND EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id AND p.permission = 'employees.change') LIMIT 1").get();
}
function canManageTarget(db, actor, target) {
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
        const users = db.prepare('SELECT id, username, active, pin_hash IS NOT NULL AS hasPin FROM local_users ORDER BY username').all();
        const grants = db.prepare('SELECT user_id AS userId, permission FROM user_permissions ORDER BY permission').all();
        const audit = db.prepare('SELECT actor_id AS actorId, target_id AS targetId, permission, granted, occurred_at AS occurredAt FROM employee_permission_audit ORDER BY id DESC LIMIT 100').all();
        const credentialAudit = db.prepare('SELECT actor_id AS actorId, target_id AS targetId, password_changed AS passwordChanged, pin_changed AS pinChanged, occurred_at AS occurredAt FROM employee_credential_audit ORDER BY id DESC LIMIT 100').all();
        const accountAudit = db.prepare('SELECT actor_id AS actorId, target_id AS targetId, old_username AS oldUsername, new_username AS newUsername, old_active AS oldActive, new_active AS newActive, occurred_at AS occurredAt FROM employee_account_audit ORDER BY id DESC LIMIT 100').all();
        return { ok: true, data: { users, grants, audit, credentialAudit, accountAudit, permissions: PERMISSIONS } };
      }
      if (req.action === 'create' && keys(req, ['action', 'username', 'password', 'pin']) && validUsername(req.username) && validPassword(req.password) && validPin(req.pin)) {
        const [salt, hash] = credential(req.password); const [pinSalt, pinHash] = req.pin ? credential(req.pin) : [null, null];
        db.exec('BEGIN IMMEDIATE');
        try {
          const created = db.prepare('INSERT INTO local_users(username, salt, password_hash, pin_salt, pin_hash) VALUES (?, ?, ?, ?, ?)').run(req.username, salt, hash, pinSalt, pinHash);
          recordAudit(db, actor, 'create', 'employee', created.lastInsertRowid, null, {});
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      if (req.action === 'account' && keys(req, ['action', 'id', 'username', 'active']) && validId(req.id) && validUsername(req.username) && typeof req.active === 'boolean') {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!canManageTarget(db, actor, req.id)) throw new Error('Target has additional permissions');
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
      if (req.action === 'credential' && keys(req, ['action', 'id', 'password', 'pin']) && validId(req.id) && (req.password === null || validPassword(req.password)) && (req.pin === null || validPin(req.pin)) && (req.password !== null || req.pin !== null)) {
        const exists = db.prepare('SELECT id FROM local_users WHERE id = ?').get(req.id); if (!exists) return { ok: false, error: 'Account unavailable' };
        if (!canManageTarget(db, actor, req.id)) return { ok: false, error: 'Access denied' };
        const password = req.password !== null ? credential(req.password) : null;
        const pin = req.pin !== null ? (req.pin ? credential(req.pin) : [null, null]) : null;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (password) db.prepare('UPDATE local_users SET salt = ?, password_hash = ? WHERE id = ?').run(...password, req.id);
          if (pin) db.prepare('UPDATE local_users SET pin_salt = ?, pin_hash = ? WHERE id = ?').run(...pin, req.id);
          db.prepare('INSERT INTO employee_credential_audit(actor_id, target_id, password_changed, pin_changed, occurred_at) VALUES (?, ?, ?, ?, ?)').run(actor, req.id, Number(!!password), Number(!!pin), Date.now());
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        session.invalidateUser(req.id); return { ok: true };
      }
      if (req.action === 'permissions' && keys(req, ['action', 'id', 'permissions']) && validId(req.id) && Array.isArray(req.permissions) && req.permissions.every(p => typeof p === 'string' && PERMISSIONS.includes(p)) && new Set(req.permissions).size === req.permissions.length) {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!db.prepare('SELECT 1 FROM local_users WHERE id = ?').get(req.id)) throw new Error('Missing account');
          const old = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(req.id).map(r => r.permission);
          const actorGrants = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(actor).map(r => r.permission);
          const changed = PERMISSIONS.filter(p => old.includes(p) !== req.permissions.includes(p));
          if (changed.some(p => !actorGrants.includes(p))) throw new Error('Cannot manage unheld permissions');
          const add = db.prepare('INSERT INTO user_permissions(user_id, permission) VALUES (?, ?)');
          const remove = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?');
          const audit = db.prepare('INSERT INTO employee_permission_audit(actor_id, target_id, permission, granted, occurred_at) VALUES (?, ?, ?, ?, ?)');
          for (const p of changed) { const granted = req.permissions.includes(p); (granted ? add : remove).run(req.id, p); audit.run(actor, req.id, p, Number(granted), Date.now()); }
          if (!usableAdministrator(db)) throw new Error('Last administrator');
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return { ok: true };
      }
      return { ok: false, error: 'Invalid request' };
    } catch (_) { return { ok: false, error: 'Could not save employee configuration. Check the account, permissions, and that an administrator remains active.' }; }
  });
}
module.exports = { CHANNEL, PERMISSIONS, registerEmployeeConfig };
