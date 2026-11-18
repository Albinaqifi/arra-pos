// Check the current identity for every operation, including replay after close.
function ownsOrder(db, session, orderId) {
  const actor = session.currentUserId();
  return actor != null && !!db.prepare('SELECT 1 FROM order_waiter_ownership WHERE order_id=? AND waiter_id=?').get(orderId, actor);
}
// A completed/retired pre-upgrade order has no recoverable owner. Preserve
// only the recorded actor's ability to reconcile their own historic print job.
function canRecoverLegacyPrint(db, session, orderId, recordedActor) {
  const actor = session.currentUserId();
  return actor != null && actor === recordedActor && !!db.prepare("SELECT 1 FROM legacy_unassigned_orders l JOIN orders o ON o.id=l.order_id WHERE l.order_id=? AND (o.status='completed' OR o.retired_empty=1) AND NOT EXISTS(SELECT 1 FROM order_waiter_ownership w WHERE w.order_id=o.id)").get(orderId);
}
module.exports = { ownsOrder, canRecoverLegacyPrint };
