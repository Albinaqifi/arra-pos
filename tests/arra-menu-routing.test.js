const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, migrate } = require('../src/desktop/database');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { seedTables } = require('../src/desktop/tables');
const { registerOrderItems } = require('../src/desktop/order-items');
const { historicalDatabase } = require('./support/historical-database');
const { authorizedDatabase } = require('./support/authorized-database');

const firstKitchenNames = [
  'Bruschetta Mix', 'Focaccia me vaj ulliri', 'Focaccia me susam dhe kaçkavall',
  'Djathë Dhensh', 'Vitello Tonnato', 'Dërrasë Mishrash & Djathërash', 'Pizza për Fëmijë',
];

function fixture(t, open = openDatabase) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-menu-routing-'));
  let db = open(directory);
  t.after(() => { if (db.isOpen) db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return {
    get db() { return db; },
    reopen() { db.close(); db = openDatabase(directory); },
  };
}

function checkSeedRoutes(db) {
  const routes = db.prepare(`SELECT p.name, p.destination, c.name AS section, root.name AS root
    FROM menu_products p JOIN menu_categories c ON c.id=p.category_id
    JOIN menu_categories root ON root.id=c.parent_id WHERE p.id LIKE 'arra-product-%'`).all();
  assert.equal(routes.length, 103);
  for (const product of routes) {
    let expected = 'kitchen2';
    if (product.root === 'Drinks') expected = 'bar';
    else if (['Sallata', 'Pizza'].includes(product.section) || firstKitchenNames.includes(product.name)) expected = 'kitchen';
    assert.equal(product.destination, expected, product.name + ' in ' + product.section);
  }
}

function orderItems(db) {
  const session = { currentUserId: () => 1, authenticatedUserId: () => 1 };
  let handler;
  registerOrderItems({ handle(_, fn) { handler = fn; } }, () => true, db, session);
  return (orderId, request) => {
    const result = handler({}, { orderId, ...request });
    assert.equal(result.ok, true, result.error);
  };
}

function savedHistory(db) {
  const tables = ['orders', 'order_items', 'order_item_fiscal_tax', 'preparation_rounds',
    'preparation_tickets', 'preparation_ticket_items', 'print_jobs', 'print_attempts',
    'bills', 'bill_lines', 'payments', 'application_audit'];
  return tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

test('fresh Arra setup assigns every dish and drink to its station', t => {
  const { db } = fixture(t);
  seedArraMenu(db);
  checkSeedRoutes(db);
});

test('upgrading the corrected Arra menu preserves history and sends a mixed order to three stations', t => {
  const f = fixture(t, historicalDatabase(51).openDatabase);
  const old = authorizedDatabase(f.db);
  seedTables(old);
  seedArraMenu(old);
  old.exec(`UPDATE menu_products SET destination='kitchen';
    INSERT INTO orders(id,table_id,opened_at,status) VALUES (1,1,1,'open'), (2,2,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open'), (2,1,1,1,'open');`);
  const oldOrder = orderItems(old);
  oldOrder(1, { action: 'add', productId: 'arra-product-6-0' });
  oldOrder(1, { action: 'send', requestId: 'before' });
  old.exec(`INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,190,'sample');
    INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES(1,1,'Supë Viçi',190,1,'[]');
    INSERT INTO payments(id,bill_id,actor_id,paid_at,amount,method,account) VALUES(1,1,1,1,190,'cash','B');
    UPDATE orders SET status='completed' WHERE id=1;`);
  const before = savedHistory(old);

  f.reopen();
  assert.deepEqual(savedHistory(f.db), before);
  checkSeedRoutes(f.db);
  const send = orderItems(f.db);
  for (const id of ['arra-product-0-0', 'arra-product-7-1', 'arra-product-6-0', 'arra-product-11-0', 'arra-product-12-0']) {
    send(2, { action: 'add', productId: id });
  }
  send(2, { action: 'send', requestId: 'after' });
  send(2, { action: 'send', requestId: 'after' });
  const tickets = f.db.prepare(`SELECT r.request_id, t.destination, i.name FROM preparation_rounds r
    JOIN preparation_tickets t ON t.round_id=r.id JOIN preparation_ticket_items ti ON ti.ticket_id=t.id
    JOIN order_items i ON i.id=ti.item_id ORDER BY r.id, i.id`).all();
  assert.deepEqual(tickets.map(t => [t.request_id, t.destination, t.name]), [
    ['before', 'kitchen', 'Supë Viçi'], ['after', 'kitchen', 'Sallatë Arra'],
    ['after', 'kitchen', 'Pizza për Fëmijë'], ['after', 'kitchen2', 'Supë Viçi'],
    ['after', 'bar', 'Espresso'], ['after', 'bar', 'Heineken'],
  ]);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM preparation_tickets').get().n, 4);
});

test('upgrade includes custom products in Arra sections, isolates other roots and retains subsequent admin choices', t => {
  const f = fixture(t, historicalDatabase(51).openDatabase);
  seedArraMenu(f.db);
  f.db.exec(`INSERT INTO menu_categories(id,name,active,parent_id) VALUES
    ('custom-food','Specials',1,'arra-food'), ('custom-drinks','Cocktails',1,'arra-drinks'),
    ('other-root','Food',1,NULL), ('other-section','Pizza',1,'other-root');`);
  const add = f.db.prepare("INSERT INTO menu_products(id,category_id,name,price,active,destination) VALUES(?,?,'Sample',123,1,?)");
  for (const row of [
    ['custom-1', 'arra-category-0', 'bar'], ['custom-2', 'arra-category-3', 'kitchen2'],
    ['custom-3', 'custom-food', 'bar'], ['custom-4', 'custom-drinks', 'kitchen'],
    ['custom-5', 'arra-food', 'bar'], ['custom-6', 'arra-drinks', 'kitchen'],
    ['custom-7', 'other-section', 'bar'],
  ]) add.run(...row);
  f.db.exec("UPDATE menu_products SET category_id='custom-food' WHERE id IN ('arra-product-0-3','arra-product-3-0')");
  f.reopen();
  const moved = f.db.prepare("SELECT destination FROM menu_products WHERE id IN ('arra-product-0-3','arra-product-3-0')").all();
  assert.deepEqual(moved.map(p => p.destination), ['kitchen', 'kitchen']);
  const routes = () => f.db.prepare("SELECT destination FROM menu_products WHERE id LIKE 'custom-%' ORDER BY id").all().map(p => p.destination);
  assert.deepEqual(routes(), ['kitchen', 'kitchen', 'kitchen2', 'bar', 'kitchen2', 'bar', 'bar']);
  f.db.exec("UPDATE menu_products SET destination='bar' WHERE id='custom-3'");
  f.reopen();
  assert.deepEqual(routes(), ['kitchen', 'kitchen', 'bar', 'bar', 'kitchen2', 'bar', 'bar']);
});

test('an unrelated menu with similar section names and no Arra roots keeps its routes', t => {
  const f = fixture(t, historicalDatabase(51).openDatabase);
  f.db.exec(`INSERT INTO menu_categories(id,name,active,parent_id) VALUES
    ('food','Food',1,NULL),('pizza','Pizza',1,'food');
    INSERT INTO menu_products(id,category_id,name,price,active,destination)
    VALUES('pizza-1','pizza','Pizza për Fëmijë',180,1,'bar');`);
  f.reopen();
  assert.equal(f.db.prepare('SELECT destination FROM menu_products').get().destination, 'bar');
});

test('a failed v52 route update rolls back all route changes and can be retried', t => {
  const { db } = fixture(t, historicalDatabase(51).openDatabase);
  seedArraMenu(db);
  db.exec(`UPDATE menu_products SET destination='bar';
    CREATE TRIGGER route_failure BEFORE UPDATE OF destination ON menu_products
    WHEN NEW.id='arra-product-6-0' BEGIN SELECT RAISE(ABORT, 'route write failed'); END;`);
  assert.throws(() => migrate(db), /route write failed/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 51);
  assert.equal(db.prepare("SELECT count(*) AS n FROM menu_products WHERE destination!='bar'").get().n, 0);
  db.exec('DROP TRIGGER route_failure');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 52);
  checkSeedRoutes(db);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
