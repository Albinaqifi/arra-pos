const CHANNEL = 'arra:order-items';
const validId = n => Number.isSafeInteger(n) && n > 0;

function registerOrderItems(ipcMain, isAllowedSender, db) {
  ipcMain.handle(CHANNEL, (event, request) => {
    const keys = { list: ['action', 'orderId'], add: ['action', 'orderId', 'productId'],
      note: ['action', 'orderId', 'itemId', 'note'], increment: ['action', 'orderId', 'itemId'], decrement: ['action', 'orderId', 'itemId'], remove: ['action', 'orderId', 'itemId'] };
    if (!isAllowedSender(event) || !request || typeof request !== 'object' || Array.isArray(request) ||
        Object.getPrototypeOf(request) !== Object.prototype || !Object.hasOwn(keys, request.action) ||
        Reflect.ownKeys(request).length !== keys[request.action].length ||
        !keys[request.action].every(k => Object.hasOwn(request, k)) || !validId(request.orderId) ||
        (request.action === 'add' && (typeof request.productId !== 'string' || !request.productId.trim())) ||
        (['increment', 'decrement', 'remove', 'note'].includes(request.action) && !validId(request.itemId)) ||
        (request.action === 'note' && typeof request.note !== 'string'))
      return { ok: false, error: 'Invalid request' };
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare("SELECT id FROM orders WHERE id = ? AND status = 'open'").get(request.orderId)) throw Error('Invalid order');
        if (request.action === 'add') {
          const product = db.prepare(`SELECT p.id, p.name, p.price FROM menu_products p
            JOIN menu_categories c ON c.id = p.category_id WHERE p.id = ? AND p.active = 1 AND c.active = 1`).get(request.productId);
          if (!product) throw Error('Invalid product');
          db.prepare("INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, status) VALUES (?, ?, ?, ?, 1, 'pending')")
            .run(request.orderId, product.id, product.name, product.price);
        } else if (request.action !== 'list') {
          const item = db.prepare("SELECT id, quantity FROM order_items WHERE id = ? AND order_id = ? AND status = 'pending'").get(request.itemId, request.orderId);
          if (!item) throw Error('Invalid item');
          if (request.action === 'note') db.prepare('UPDATE order_items SET note = ? WHERE id = ?').run(request.note, item.id);
          else if (request.action === 'remove' || (request.action === 'decrement' && item.quantity === 1))
            db.prepare('DELETE FROM order_items WHERE id = ?').run(item.id);
          else db.prepare('UPDATE order_items SET quantity = ? WHERE id = ?').run(item.quantity + (request.action === 'increment' ? 1 : -1), item.id);
        }
        const items = db.prepare('SELECT id, product_id AS productId, name, unit_price AS unitPrice, quantity, note FROM order_items WHERE order_id = ? ORDER BY id').all(request.orderId);
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
