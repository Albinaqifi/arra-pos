const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:operational-reports';

function registerOperationalReports(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !req || typeof req !== 'object' || Array.isArray(req) || Object.getPrototypeOf(req) !== Object.prototype ||
        Reflect.ownKeys(req).length !== 3 || !['from', 'to', 'account'].every(k => Object.hasOwn(req, k)) ||
        !Number.isSafeInteger(req.from) || !Number.isSafeInteger(req.to) || req.from < 0 || req.to <= req.from || ![null, 'A', 'B'].includes(req.account)) return { ok: false };
    try {
      const id = session.currentUserId();
      if (!id || session.authenticatedUserId() !== id || !hasPermissions(db, session, 'employees.view')) return { ok: false };
      const scope = db.prepare('SELECT scope FROM financial_scopes WHERE user_id=?').get(id)?.scope;
      if (!['A', 'B', 'combined'].includes(scope) || (req.account && scope !== 'combined' && req.account !== scope)) return { ok: false };
      const account = req.account || (scope === 'combined' ? null : scope);
      const where = account ? 'p.account=?' : "p.account IN ('A','B')";
      const args = account ? [req.from, req.to, account] : [req.from, req.to];
      const payments = db.prepare(`SELECT p.id, p.bill_id AS billId, o.table_id AS tableId, p.actor_id AS actorId, u.username AS actor
        FROM payments p JOIN bills b ON b.id=p.bill_id JOIN orders o ON o.id=b.order_id JOIN local_users u ON u.id=p.actor_id
        WHERE p.paid_at>=? AND p.paid_at<? AND ${where} ORDER BY p.paid_at, p.id`).all(...args);
      const lineQuery = db.prepare('SELECT i.product_id AS productId, l.name, l.quantity, l.unit_price AS unitPrice FROM bill_lines l JOIN order_items i ON i.id=l.item_id WHERE l.bill_id=? ORDER BY l.id');
      const products = new Map(), tables = new Map(), waiters = new Map();
      function add(map, key, initial, increments) {
        const row = map.get(key) || initial;
        for (const [field, value] of Object.entries(increments)) {
          row[field] += value;
          if (!Number.isSafeInteger(row[field])) throw Error('Report total too large');
        }
        map.set(key, row);
      }
      for (const p of payments) {
        add(tables, p.tableId, { tableId:p.tableId, count:0 }, { count:1 });
        add(waiters, p.actorId, { actor:p.actor, count:0 }, { count:1 });
        for (const line of lineQuery.all(p.billId)) {
          const value = line.quantity * line.unitPrice;
          if (!Number.isSafeInteger(value)) throw Error('Report total too large');
          add(products, line.productId, { productId:line.productId, name:line.name, quantity:0, value:0 }, { quantity:line.quantity, value });
          // Rows are ordered by payment time and ID, then bill line ID.
          products.get(line.productId).name = line.name;
        }
      }
      return { ok:true, data:{ products:[...products.values()], tables:[...tables.values()], waiters:[...waiters.values()] } };
    } catch (_) { return { ok:false }; }
  });
}
module.exports = { CHANNEL, registerOperationalReports };
