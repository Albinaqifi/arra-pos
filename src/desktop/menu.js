const { hasPermissions } = require('./permissions');
const CHANNEL = 'arra:menu';

function registerMenu(ipcMain, isAllowedSender, db, session) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event) || !request || typeof request !== 'object' ||
        Array.isArray(request) || Object.getPrototypeOf(request) !== Object.prototype ||
        Reflect.ownKeys(request).length !== 0) return { ok: false, error: 'Invalid request' };
    if (!hasPermissions(db, session, 'menu.view')) return { ok: false, error: 'Access denied' };
    try {
      const categories = db.prepare('SELECT id, name FROM menu_categories WHERE active = 1 ORDER BY rowid').all();
      const products = db.prepare(`SELECT p.id, p.category_id AS categoryId, p.name, p.price
        FROM menu_products p JOIN menu_categories c ON c.id = p.category_id
        WHERE p.active = 1 AND c.active = 1 ORDER BY p.rowid`).all();
      return { ok: true, data: { categories, products } };
    } catch (_) {
      return { ok: false, error: 'Menu unavailable' };
    }
  });
}

function seedMenu(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const category = db.prepare('INSERT INTO menu_categories (id, name, active) VALUES (?, ?, 1) ON CONFLICT(id) DO NOTHING');
    const product = db.prepare('INSERT INTO menu_products (id, category_id, name, price, active) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO NOTHING');
    for (const row of [['food', 'Food'], ['drinks', 'Drinks'], ['desserts', 'Desserts']]) category.run(...row);
    for (const row of [
      ['qebapa', 'food', 'Qebapa', 220], ['shopska', 'food', 'Shopska salad', 180],
      ['espresso', 'drinks', 'Espresso', 70], ['cola', 'drinks', 'Coca-Cola', 100],
      ['baklava', 'desserts', 'Baklava', 150]
    ]) product.run(...row);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { CHANNEL, registerMenu, seedMenu };
