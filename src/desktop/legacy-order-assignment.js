const { untouchedOrder } = require('./untouched-order');
const { recordAudit } = require('./audit');

function registerLegacyOrderAssignment(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle('arra:legacy-order-assignment', (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype) return { ok:false };
    const keys = Reflect.ownKeys(request);
    if (!(request.action === 'list' && keys.length === 1) && !(request.action === 'assign' && keys.length === 3 && Object.hasOwn(request,'orderId') && Object.hasOwn(request,'waiterId') && Number.isSafeInteger(request.orderId) && request.orderId > 0 && Number.isSafeInteger(request.waiterId) && request.waiterId > 0)) return { ok:false };
    const actor = session.currentUserId();
    if (!actor || actor !== session.authenticatedUserId() || !db.prepare("SELECT 1 FROM local_users u JOIN financial_scopes f ON f.user_id=u.id JOIN user_permissions p ON p.user_id=u.id WHERE u.id=? AND u.active=1 AND f.scope='combined' AND p.permission='orders.correct_sent'").get(actor)) return {ok:false};
    const eligible = `FROM legacy_unassigned_orders l JOIN orders o ON o.id=l.order_id WHERE o.status='open' AND o.retired_empty=0 AND NOT EXISTS(SELECT 1 FROM order_waiter_ownership w WHERE w.order_id=o.id) AND NOT (${untouchedOrder('o')})`;
    const waiters = "FROM local_users u JOIN financial_scopes f ON f.user_id=u.id WHERE u.active=1 AND f.scope='waiter' AND u.pin_salt IS NOT NULL AND u.pin_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pending_staff p WHERE p.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM restaurant_accounts r WHERE r.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM transfer_managers t WHERE t.user_id=u.id)";
    try {
      if (request.action === 'list') return {ok:true,data:{ orders:db.prepare(`SELECT o.id AS orderId,o.table_id AS tableId ${eligible} ORDER BY o.table_id,o.id`).all(), waiters:db.prepare(`SELECT u.id,u.username AS name ${waiters} ORDER BY u.username`).all() }};
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db.prepare("SELECT waiter_id,assigned_by FROM order_waiter_ownership WHERE order_id=? AND source='legacy'").get(request.orderId);
        if (existing && existing.waiter_id === request.waiterId && existing.assigned_by === actor) { db.exec('COMMIT'); return {ok:true}; }
        if (!db.prepare(`SELECT o.id ${eligible} AND o.id=?`).get(request.orderId) || !db.prepare(`SELECT u.id ${waiters} AND u.id=?`).get(request.waiterId)) { db.exec('ROLLBACK'); return {ok:false}; }
        const now=Date.now();
        db.prepare("INSERT INTO order_waiter_ownership(order_id,waiter_id,assigned_by,assigned_at,source) VALUES(?,?,?,?,'legacy')").run(request.orderId,request.waiterId,actor,now);
        recordAudit(db,actor,'assign_legacy_waiter','order',request.orderId,request.orderId,{waiterId:request.waiterId});
        db.exec('COMMIT'); return {ok:true};
      } catch (_) { db.exec('ROLLBACK'); return {ok:false}; }
    } catch (_) { return {ok:false}; }
  });
}
module.exports = { registerLegacyOrderAssignment };
