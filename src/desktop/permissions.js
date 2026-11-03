// Resolve grants from the active, still-enabled user on every request.
function hasPermissions(db, session, ...permissions) {
  try {
    const id = session?.currentUserId();
    if (id == null) return false;
    const check = db.prepare('SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ?');
    return permissions.every(permission => Boolean(check.get(id, permission)));
  } catch (_) { return false; }
}
module.exports = { hasPermissions };
