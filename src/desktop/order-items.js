const { recordAudit } = require('./audit');
const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:order-items';
const validId = n => Number.isSafeInteger(n) && n > 0;

function registerOrderItems(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    const keys = { list: ['action', 'orderId'], send: ['action', 'orderId', 'requestId'], add: Object.hasOwn(request || {}, 'optionIds') ? ['action', 'orderId', 'productId', 'optionIds'] : ['action', 'orderId', 'productId'],
      note: ['action', 'orderId', 'itemId', 'note'], increment: ['action', 'orderId', 'itemId'], decrement: ['action', 'orderId', 'itemId'], remove: ['action', 'orderId', 'itemId'] };
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || !Object.hasOwn(keys, request.action) ||
        Reflect.ownKeys(request).length !== keys[request.action].length ||
        !keys[request.action].every(k => Object.hasOwn(request, k)) || !validId(request.orderId) ||
        (request.action === 'send' && (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(request.requestId))) ||
        (request.action === 'add' && (typeof request.productId !== 'string' || !request.productId.trim() || (request.optionIds !== undefined && (!Array.isArray(request.optionIds) || request.optionIds.some(x => typeof x !== 'string' || !x.trim()) || new Set(request.optionIds).size !== request.optionIds.length)))) ||
        (['increment', 'decrement', 'remove', 'note'].includes(request.action) && !validId(request.itemId)) ||
        (request.action === 'note' && typeof request.note !== 'string'))
      return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, ...(request.action === 'list' ? ['orders.view'] : ['orders.view', 'orders.change']))) return { ok: false, error: 'Access denied' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare("SELECT id FROM orders WHERE id = ? AND status = 'open'").get(request.orderId)) throw Error('Invalid order');
        if (request.action === 'send') {
          const prior = db.prepare('SELECT order_id FROM preparation_rounds WHERE request_id = ?').get(request.requestId);
          if (prior && prior.order_id !== request.orderId) throw Error('Invalid request');
          if (!prior) {
            const pending = db.prepare("SELECT i.id, i.quantity, p.destination FROM order_items i JOIN menu_products p ON p.id = i.product_id WHERE i.order_id = ? AND i.status = 'pending' ORDER BY i.id").all(request.orderId);
            if (!pending.length) throw Error('Nothing pending');
            if (pending.length) {
              const number = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS number FROM preparation_rounds WHERE order_id = ?').get(request.orderId).number;
              const roundId = db.prepare('INSERT INTO preparation_rounds (order_id, request_id, number, actor_id, sent_at) VALUES (?, ?, ?, ?, ?)').run(request.orderId, request.requestId, number, session.currentUserId(), Date.now()).lastInsertRowid;
              for (const destination of ['kitchen', 'bar']) {
                const selected = pending.filter(i => i.destination === destination);
                if (!selected.length) continue;
                const ticketId = db.prepare("INSERT INTO preparation_tickets (round_id, destination, adapter) VALUES (?, ?, 'simulated')").run(roundId, destination).lastInsertRowid;
                for (const item of selected) db.prepare('INSERT INTO preparation_ticket_items (ticket_id, item_id, quantity) VALUES (?, ?, ?)').run(ticketId, item.id, item.quantity);
                const jobId = db.prepare('INSERT INTO print_jobs (ticket_id, created_at) VALUES (?, ?)').run(ticketId, Date.now()).lastInsertRowid;
                const result = db.prepare('SELECT result FROM simulated_printers WHERE destination = ?').get(destination).result;
                db.prepare('INSERT INTO print_attempts (job_id, request_id, actor_id, occurred_at, result) VALUES (?, ?, ?, ?, ?)').run(jobId, 'initial-' + jobId, session.currentUserId(), Date.now(), result);
              }
              db.prepare("UPDATE order_items SET status = 'sent' WHERE order_id = ? AND status = 'pending'").run(request.orderId);
              recordAudit(db, session.currentUserId(), 'send', 'preparation_round', roundId, request.orderId, { number, itemIds: pending.map(i => i.id), adapter: 'simulated' });
            }
          }
        } else if (request.action === 'add') {
          const product = db.prepare(`SELECT p.id, p.name, p.price FROM menu_products p
            JOIN menu_categories c ON c.id = p.category_id LEFT JOIN menu_categories parent ON parent.id = c.parent_id WHERE p.id = ? AND p.active = 1 AND c.active = 1 AND (c.parent_id IS NULL OR parent.active = 1)`).get(request.productId);
          if (!product) throw Error('Invalid product');
          const groups = db.prepare('SELECT id, name, required FROM modifier_groups WHERE product_id = ? AND active = 1').all(product.id);
          const selected = [];
          for (const optionId of (request.optionIds || [])) {
            const option = db.prepare('SELECT o.id, o.group_id AS groupId, o.name, o.adjustment FROM modifier_options o JOIN modifier_groups g ON g.id = o.group_id WHERE o.id = ? AND o.active = 1 AND g.active = 1 AND g.product_id = ?').get(optionId, product.id);
            if (!option || selected.some(x => x.groupId === option.groupId)) throw Error('Invalid selection');
            selected.push(option);
          }
          if (groups.some(g => g.required && !selected.some(o => o.groupId === g.id))) throw Error('Required selection missing');
          let price = product.price;
          for (const option of selected) { price += option.adjustment; if (!Number.isSafeInteger(price)) throw Error('Invalid price'); }
          if (price < 0) throw Error('Invalid price');
          // Removed pending rows must not have their identity reused in history.
          const lastId = db.prepare("SELECT MAX(id) AS id FROM (SELECT id FROM order_items UNION ALL SELECT CAST(entity_id AS INTEGER) AS id FROM application_audit WHERE entity_type = 'order_item')").get().id || 0;
          if (!Number.isSafeInteger(lastId + 1)) throw Error('Item IDs exhausted');
          const result = db.prepare("INSERT INTO order_items (id, order_id, product_id, name, unit_price, quantity, status) VALUES (?, ?, ?, ?, ?, 1, 'pending')")
            .run(lastId + 1, request.orderId, product.id, product.name, price);
          for (const option of selected) db.prepare('INSERT INTO order_item_modifiers VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, groups.find(g => g.id === option.groupId).name, option.name, option.adjustment);
          recordAudit(db, session.currentUserId(), 'add', 'order_item', result.lastInsertRowid, request.orderId, { productId: product.id, name: product.name, unitPrice: price, quantity: 1, modifiers: selected.map(o => ({ group: groups.find(g => g.id === o.groupId).name, option: o.name, adjustment: o.adjustment })) });
        } else if (request.action !== 'list') {
          const item = db.prepare("SELECT id, product_id AS productId, name, unit_price AS unitPrice, quantity, note FROM order_items WHERE id = ? AND order_id = ? AND status = 'pending'").get(request.itemId, request.orderId);
          if (!item) throw Error('Invalid item');
          const removed = request.action === 'remove' || (request.action === 'decrement' && item.quantity === 1);
          // Read snapshots before deletion cascades to modifier rows.
          const modifiers = removed ? db.prepare('SELECT group_name AS groupName, option_name AS optionName, adjustment FROM order_item_modifiers WHERE item_id = ? ORDER BY rowid').all(item.id) : null;
          if (request.action === 'note') db.prepare('UPDATE order_items SET note = ? WHERE id = ?').run(request.note, item.id);
          else if (request.action === 'remove' || (request.action === 'decrement' && item.quantity === 1))
            db.prepare('DELETE FROM order_items WHERE id = ?').run(item.id);
          else db.prepare('UPDATE order_items SET quantity = ? WHERE id = ?').run(item.quantity + (request.action === 'increment' ? 1 : -1), item.id);
          if (request.action !== 'note' || item.note !== request.note) {
            const context = request.action === 'note' ? {} : { productId: item.productId, name: item.name, unitPrice: item.unitPrice, beforeQuantity: item.quantity, afterQuantity: removed ? 0 : item.quantity + (request.action === 'increment' ? 1 : -1) };
            if (removed) context.modifiers = modifiers;
            recordAudit(db, session.currentUserId(), request.action === 'note' ? 'note_changed' : removed ? 'remove' : 'quantity_changed', 'order_item', item.id, request.orderId, context);
          }
        }
        const items = db.prepare('SELECT i.id, i.product_id AS productId, i.name, i.unit_price AS unitPrice, i.quantity, i.note, i.status, r.number AS round, r.sent_at AS sentAt, u.username AS sentBy, t.destination AS route FROM order_items i LEFT JOIN preparation_ticket_items ti ON ti.item_id = i.id LEFT JOIN preparation_tickets t ON t.id = ti.ticket_id LEFT JOIN preparation_rounds r ON r.id = t.round_id LEFT JOIN local_users u ON u.id = r.actor_id WHERE i.order_id = ? ORDER BY i.id').all(request.orderId);
        for (const item of items) item.modifiers = db.prepare('SELECT group_name AS groupName, option_name AS optionName, adjustment FROM order_item_modifiers WHERE item_id = ? ORDER BY rowid').all(item.id);
        let total = 0;
        for (const item of items) {
          const line = item.unitPrice * item.quantity;
          if (!Number.isSafeInteger(line) || !Number.isSafeInteger(total + line)) throw Error('Total too large');
          total += line;
        }
        db.exec('COMMIT');
        return { ok: true, data: { items, total } };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { return { ok: false, error: 'Could not update order items' }; }
  });
}
module.exports = { CHANNEL, registerOrderItems };
