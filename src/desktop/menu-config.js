const { randomUUID } = require('node:crypto');
const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:menu-config';
const plain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const keys = (x, expected) => Reflect.ownKeys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const id = x => typeof x === 'string' && x === x.trim() && x.length > 0 && x.length <= 100;
const name = x => id(x);
const number = x => Number.isSafeInteger(x) && x >= 0;
function registerMenuConfig(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, req) => {
    if (!isAllowedSender(event) || !plain(req) || typeof req.action !== 'string') return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'menu.change')) return { ok: false, error: 'Access denied' };
    try {
      if (req.action === 'list' && keys(req, ['action'])) return { ok: true, data: {
        categories: db.prepare('SELECT id, name, active, parent_id AS parentId, sort_order AS sortOrder FROM menu_categories ORDER BY sort_order, rowid').all(),
        products: db.prepare('SELECT id, category_id AS categoryId, name, price, active, sort_order AS sortOrder FROM menu_products ORDER BY sort_order, rowid').all()
      } };
      if (req.action === 'category' && keys(req, ['action', 'id', 'name', 'active', 'parentId', 'sortOrder']) && (req.id === null || id(req.id)) && name(req.name) && typeof req.active === 'boolean' && (req.parentId === null || id(req.parentId)) && number(req.sortOrder)) {
        if (req.parentId !== null) {
          const parent = db.prepare('SELECT parent_id FROM menu_categories WHERE id = ?').get(req.parentId);
          if (!parent || parent.parent_id !== null || req.parentId === req.id || (req.id && db.prepare('SELECT 1 FROM menu_categories WHERE parent_id = ? LIMIT 1').get(req.id))) return { ok: false, error: 'Invalid parent category' };
        }
        if (req.id === null) db.prepare('INSERT INTO menu_categories (id, name, active, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), req.name, Number(req.active), req.parentId, req.sortOrder);
        else if (!db.prepare('UPDATE menu_categories SET name = ?, active = ?, parent_id = ?, sort_order = ? WHERE id = ?').run(req.name, Number(req.active), req.parentId, req.sortOrder, req.id).changes) return { ok: false, error: 'Category unavailable' };
        return { ok: true };
      }
      if (req.action === 'product' && keys(req, ['action', 'id', 'categoryId', 'name', 'price', 'active', 'sortOrder']) && (req.id === null || id(req.id)) && id(req.categoryId) && name(req.name) && number(req.price) && typeof req.active === 'boolean' && number(req.sortOrder)) {
        if (!db.prepare('SELECT 1 FROM menu_categories WHERE id = ?').get(req.categoryId)) return { ok: false, error: 'Category unavailable' };
        if (req.id === null) db.prepare('INSERT INTO menu_products (id, category_id, name, price, active, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), req.categoryId, req.name, req.price, Number(req.active), req.sortOrder);
        else if (!db.prepare('UPDATE menu_products SET category_id = ?, name = ?, price = ?, active = ?, sort_order = ? WHERE id = ?').run(req.categoryId, req.name, req.price, Number(req.active), req.sortOrder, req.id).changes) return { ok: false, error: 'Product unavailable' };
        return { ok: true };
      }
      return { ok: false, error: 'Invalid request' };
    } catch (_) { return { ok: false, error: 'Could not save menu' }; }
  });
}
module.exports = { CHANNEL, registerMenuConfig };
