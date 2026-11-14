const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:order-history';
// Explicit event and field allowlists keep prices, notes, request IDs, and any
// future financial audit events out of this operational history endpoint.
function project(row) {
  const c = JSON.parse(row.context), base = { id: row.id, action: row.action, actor: row.actor, occurredAt: row.occurred_at, entityId: row.entity_id, orderId: row.order_id };
  switch (row.action) {
    case 'open': return { ...base, tableId: c.tableId };
    case 'add': return { ...base, name: c.name, quantity: c.quantity };
    case 'quantity_changed': case 'remove': return { ...base, name: c.name, beforeQuantity: c.beforeQuantity, afterQuantity: c.afterQuantity };
    case 'note_changed': return base;
    case 'send': return { ...base, number: c.number, itemIds: c.itemIds };
    case 'move': return { ...base, sourceId: c.sourceId, destinationId: c.destinationId };
    case 'move_items': return { ...base, sourceId: c.sourceId, destinationId: c.destinationId, destinationOrderId: c.destinationOrderId, itemIds: c.itemIds };
    case 'cancel_order': return { ...base, reason: c.reason, items: c.items };
    case 'correct_sent': return { ...base, quantity: c.quantity, reason: c.reason };
    default: return null;
  }
}
function registerOrderHistory(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Object.getPrototypeOf(req) !== Object.prototype || Reflect.ownKeys(req).length !== 1 || !Object.hasOwn(req, 'orderId') || !(req.orderId === null || (Number.isSafeInteger(req.orderId) && req.orderId > 0))) return { ok: false };
    if (!hasPermissions(db, session, 'employees.view')) return { ok: false };
    try {
      const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(session.currentUserId())?.scope;
      if (!['waiter','A','B','combined'].includes(scope)) return { ok:false };
      // A moved item's timeline can include events from several orders. An
      // owner may see it only if every connected order is within their scope.
      const links = new Map();
      if (scope === 'A' || scope === 'B') {
        for (const row of db.prepare("SELECT order_id, context FROM application_audit WHERE action='move_items' AND entity_type='order'").all()) {
          const destination = JSON.parse(row.context).destinationOrderId;
          if (!Number.isSafeInteger(row.order_id) || !Number.isSafeInteger(destination)) throw Error('Invalid move history');
          for (const [from,to] of [[row.order_id,destination],[destination,row.order_id]]) {
            if (!links.has(from)) links.set(from, []);
            links.get(from).push(to);
          }
        }
      }
      const otherPayment = db.prepare(`SELECT 1 FROM bills b JOIN payments p ON p.bill_id=b.id
        LEFT JOIN payment_account_corrections c ON c.payment_id=p.id
        WHERE b.order_id=? AND COALESCE(CASE WHEN c.id IS NOT NULL THEN 'A' END,p.account)<>? LIMIT 1`);
      const hasBill = db.prepare('SELECT 1 FROM bills WHERE order_id=?');
      const permitted = id => {
        if (scope === 'waiter' || scope === 'combined') return true;
        const seen = new Set(), pending = [id];
        while (pending.length) {
          const current = pending.pop();
          if (seen.has(current)) continue;
          seen.add(current);
          if (!hasBill.get(current) || otherPayment.get(current,scope)) return false;
          pending.push(...(links.get(current) || []));
        }
        return true;
      };
      if (req.orderId === null) return { ok: true, data: { orders: db.prepare("SELECT id, table_id AS tableId, opened_at AS openedAt, CASE WHEN EXISTS(SELECT 1 FROM order_cancellations c WHERE c.order_id=orders.id) THEN 'cancelled' WHEN retired_empty = 1 THEN 'retired empty' ELSE status END AS status FROM orders ORDER BY id DESC").all().filter(order => permitted(order.id)) } };
      if (!permitted(req.orderId)) return { ok:false };
      const order = db.prepare("SELECT id, table_id AS tableId, opened_at AS openedAt, CASE WHEN EXISTS(SELECT 1 FROM order_cancellations c WHERE c.order_id=orders.id) THEN 'cancelled' WHEN retired_empty = 1 THEN 'retired empty' ELSE status END AS status FROM orders WHERE id=?").get(req.orderId);
      if (!order) return { ok: false };
      const items = db.prepare('SELECT i.id, i.name, i.quantity, i.status, COALESCE((SELECT SUM(c.quantity) FROM sent_item_corrections c WHERE c.item_id=i.id), 0) AS correctedQuantity FROM order_items i WHERE i.order_id=? ORDER BY i.id').all(req.orderId);
      const rows = db.prepare(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.order_id, a.occurred_at, a.context, u.username AS actor FROM application_audit a JOIN local_users u ON u.id=a.actor_id
        WHERE a.order_id IS NOT NULL ORDER BY a.occurred_at, a.id`).all();
      // Include the prior history of items moved into this order, including
      // items that have since moved away. Do not expose other items in a round.
      const relevant = new Set(items.map(i => i.id));
      for (const row of rows) if (row.action === 'move_items' && row.entity_type === 'order') {
        const c = JSON.parse(row.context);
        if (c.destinationOrderId === req.orderId || row.order_id === req.orderId) for (const id of c.itemIds) relevant.add(id);
      }
      const allowed = { open:'order', add:'order_item', quantity_changed:'order_item', remove:'order_item', note_changed:'order_item', send:'preparation_round', move:'order', move_items:'order', correct_sent:'order_item', cancel_order:'order' };
      const events = [];
      for (const row of rows) {
        if (allowed[row.action] !== row.entity_type) continue;
        const context = JSON.parse(row.context);
        const relatedItem = row.entity_type === 'order_item' && relevant.has(Number(row.entity_id));
        const incoming = row.action === 'move_items' && context.destinationOrderId === req.orderId;
        const relatedRound = row.action === 'send' && context.itemIds.some(id => relevant.has(id));
        const relatedMove = row.action === 'move_items' && context.itemIds.some(id => relevant.has(id));
        if (row.order_id !== req.orderId && !relatedItem && !incoming && !relatedRound && !relatedMove) continue;
        const projected = project(row);
        if (row.order_id !== req.orderId && (row.action === 'send' || row.action === 'move_items')) projected.itemIds = projected.itemIds.filter(id => relevant.has(id));
        events.push(projected);
      }
      const attempts = db.prepare(`SELECT pa.id, pa.occurred_at AS occurredAt, COALESCE(u.username, 'Unknown') AS actor, pa.result, t.destination, r.number
        FROM print_attempts pa JOIN print_jobs j ON j.id=pa.job_id JOIN preparation_tickets t ON t.id=j.ticket_id JOIN preparation_rounds r ON r.id=t.round_id
        LEFT JOIN local_users u ON u.id=pa.actor_id WHERE r.order_id=?`).all(req.orderId);
      for (const a of attempts) events.push({ ...a, id: 'print-' + a.id, action:'print_attempt', adapter:'simulated', orderId:req.orderId });
      events.sort((a,b) => a.occurredAt-b.occurredAt || String(a.id).localeCompare(String(b.id), undefined, { numeric:true }));
      return { ok: true, data: { order, items, events } };
    } catch (_) { return { ok: false }; }
  });
}
module.exports = { CHANNEL, registerOrderHistory };
