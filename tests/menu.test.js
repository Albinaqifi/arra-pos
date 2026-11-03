const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { CHANNEL, registerMenu, seedMenu } = require('../src/desktop/menu');

test('menu seed preserves changes and active menu survives reopen', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-menu-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir), handler;
  const trusted = {};
  const register = () => registerMenu({ handle(channel, fn) { assert.equal(channel, CHANNEL); handler = fn; } }, e => e === trusted, db);
  register();
  assert.deepEqual(handler(trusted, {}).data.categories, []);
  seedMenu(db);
  db.prepare('UPDATE menu_products SET active = 0 WHERE id = ?').run('cola');
  db.prepare('UPDATE menu_products SET name = ?, price = ? WHERE id = ?').run('Sample coffee', 85, 'espresso');
  db.prepare('UPDATE menu_categories SET active = 0 WHERE id = ?').run('desserts');
  seedMenu(db);
  assert.equal(db.prepare('SELECT count(*) AS n FROM menu_products').get().n, 5);
  db.close(); db = openDatabase(dir); register();
  const data = handler(trusted, {}).data;
  assert.deepEqual(data.categories.map(c => c.id), ['food', 'drinks']);
  assert.deepEqual(data.products.map(p => ({ ...p })), [
    { id: 'qebapa', categoryId: 'food', name: 'Qebapa', price: 220 },
    { id: 'shopska', categoryId: 'food', name: 'Shopska salad', price: 180 },
    { id: 'espresso', categoryId: 'drinks', name: 'Sample coffee', price: 85 }
  ]);
  assert.deepEqual(handler({}, {}), { ok: false, error: 'Invalid request' });
  for (const bad of [null, [], { extra: 1 }]) assert.deepEqual(handler(trusted, bad), { ok: false, error: 'Invalid request' });
  db.close();
  assert.deepEqual(handler(trusted, {}), { ok: false, error: 'Menu unavailable' });
});
