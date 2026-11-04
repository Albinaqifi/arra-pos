// Resolve grants from the active, still-enabled user on every request.
function hasPermissions(db, session, ...permissions) {
  try {
    const id = session?.currentUserId();
    if (id == null) return false;
    const authenticated = session.authenticatedUserId();
    if (db.prepare('SELECT 1 FROM transfer_managers WHERE user_id IN (?, ?)').get(id, authenticated)) return false;
    const lookup = db.prepare('SELECT scope FROM financial_scopes WHERE user_id = ?');
    const authScope = lookup.get(authenticated)?.scope;
    const selectedScope = lookup.get(id)?.scope;
    // A selected waiter never enlarges the authenticated account's scope.
    if (!authScope || !selectedScope || (authScope === 'waiter' ? selectedScope !== 'waiter' : authenticated !== id)) return false;
    // Shared open orders, table state and operational history are unclassified.
    // Until their disclosure policy is settled, only a waiter session may use
    // operational services. Financial owners use the scoped financial service.
    if (authScope !== 'waiter' && permissions.some(p => ['tables.view', 'tables.change', 'orders.view', 'orders.change', 'orders.correct_sent'].includes(p))) return false;
    if (permissions.some(p => ['tables.change', 'menu.change', 'employees.view', 'employees.change', 'orders.correct_sent'].includes(p)) && session.authenticatedUserId() !== id) return false;
    const check = db.prepare('SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ?');
    return permissions.every(permission => Boolean(check.get(id, permission)));
  } catch (_) { return false; }
}
module.exports = { hasPermissions };
