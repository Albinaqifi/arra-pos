const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrate, openDatabase } = require('../src/desktop/database');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { seedTables } = require('../src/desktop/tables');
const { registerMenuConfig } = require('../src/desktop/menu-config');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { createOfflineFiscalCheckout } = require('../src/desktop/fiscal-checkout');
const { historicalDatabase } = require('./support/historical-database');
const { authorizedDatabase } = require('./support/authorized-database');

const domesticDrinks = new Set([
  'Coca-Cola Classic', 'Coca-Cola Zero', 'Fanta Orange', 'Fanta Shokata',
  'Schweppes Bitter Lemon', 'Schweppes Zero', 'Schweppes Tonic', 'Schweppes Grapefruit',
  'Espresso', 'Macchiato', 'Macchiato e Madhe', 'Cappuccino', 'Nescafé', 'Çaj me Mjaltë',
  'Muskat Temjanika e bardhë 0.20 l', 'Muskat Temjanika e bardhë 0.70 l',
  'Alexandria Cuvée e bardhë 0.20 l', 'Alexandria Cuvée e bardhë 0.70 l',
  'Alexandria Cuvée Rosé 0.20 l', 'Alexandria Cuvée Rosé 0.70 l',
  'Raki Rrushi Bovin', 'Raki Ftoi Akov', 'Leng I shtrydhur',
]);

function profile(t, legacy = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-origins-'));
  const open = legacy ? historicalDatabase(52).openDatabase : openDatabase;
  let db = open(directory);
  t.after(() => {
    if (db.isOpen) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  seedArraMenu(db, { applyOrigins: !legacy });
  return {
    get db() { return db; },
    reopen() { db.close(); db = openDatabase(directory); },
  };
}

function assertSeedClassifications(db) {
  const products = db.prepare(`SELECT p.name, p.destination, c.name AS category, o.domestic, t.tax_group
    FROM menu_products p JOIN menu_categories c ON c.id=p.category_id
    LEFT JOIN menu_product_fiscal_origin o ON o.product_id=p.id
    LEFT JOIN menu_product_fiscal_tax t ON t.product_id=p.id WHERE p.active=1`).all();
  assert.equal(products.length, 103);
  for (const row of products) {
    const domestic = ['kitchen', 'kitchen2'].includes(row.destination) || domesticDrinks.has(row.name);
    assert.equal(row.domestic, Number(domestic), row.name);
    assert.equal(row.tax_group, row.category === 'Alcoholic Drinks' ? 'А' : 'В', row.name);
  }
  assert.equal(products.filter(p => p.domestic === 1).length, 85);
  assert.equal(products.filter(p => p.domestic === 0).length, 18);
}

test('fresh and upgraded Arra menus have the owner-confirmed origin and VAT for all 103 products', t => {
  assertSeedClassifications(profile(t).db);
  const prior = profile(t, true);
  prior.db.exec(`INSERT INTO menu_product_fiscal_origin VALUES ('arra-product-11-0',0),('arra-product-12-0',1)`);
  prior.reopen();
  assertSeedClassifications(prior.db);
});

function services(db) {
  const handlers = {};
  const ipc = { handle(channel, fn) { handlers[channel] = fn; } };
  const event = {};
  const allowed = sender => sender === event;
  const session = { currentUserId: () => 1, authenticatedUserId: () => 1 };
  const adapter = { ...createOfflineFiscalCheckout(), requireOrigins: true };
  registerMenuConfig(ipc, allowed, db, session);
  registerOrderItems(ipc, allowed, db, session);
  registerBills(ipc, allowed, db, session, adapter);
  registerPayments(ipc, allowed, db, session, null, adapter);
  function request(channel, payload) {
    const result = handlers[channel](event, payload);
    assert.equal(result.ok, true, result.error);
    return result.data;
  }
  return {
    menu: payload => request('arra:menu-config', payload),
    bill: payload => request('arra:bill', payload),
    generate(orderId, ids) {
      for (const productId of ids) request('arra:order-items', { orderId, action: 'add', productId });
      request('arra:order-items', { orderId, action: 'send', requestId: 'send-' + orderId });
      const { fingerprint } = request('arra:bill', { orderId, action: 'review' });
      return request('arra:bill', { orderId, action: 'generate', fingerprint });
    },
    pay: billId => handlers['arra:payment'](event, { billId, method: 'cash', account: 'A' }),
  };
}

test('existing order marks, bills and receipts survive while later checkout uses the updated catalog', async t => {
  const f = profile(t, true);
  const db = authorizedDatabase(f.db);
  seedTables(db);
  db.exec(`INSERT INTO user_permissions VALUES(1,'menu.change');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'),(2,2,1,'open'),(3,3,1,'open');
    INSERT INTO order_waiter_ownership SELECT id,1,1,1,'open' FROM orders;
    INSERT INTO menu_product_fiscal_origin VALUES('arra-product-11-0',0),('arra-product-12-0',1);
    UPDATE menu_product_fiscal_tax SET tax_group='А' WHERE product_id='arra-product-11-0';`);
  const first = services(db);
  const ids = ['arra-product-11-0', 'arra-product-12-0'];
  const old = first.generate(1, ids);
  const paid = await first.pay(old.id);
  assert.equal(paid.ok, true, paid.error);
  const marks = lines => lines.map(line => [line.name, line.taxGroup, line.domesticProduct]);
  assert.deepEqual(marks(paid.data.fiscal.receipt.lines), [['Espresso', 'А', false], ['Heineken', 'А', true]]);
  const unknown = first.generate(2, ['arra-product-6-0']);
  assert.equal(unknown.lines[0].domesticProduct, undefined);

  f.reopen();
  const next = services(f.db);
  assert.deepEqual(await next.pay(old.id), paid);
  assert.deepEqual(next.bill({ action: 'review', orderId: 2 }).lines, unknown.lines);
  assert.equal((await next.pay(unknown.id)).fiscalStatus, 'origin');
  const fresh = next.generate(3, [...ids, 'arra-product-6-0']);
  const receipt = await next.pay(fresh.id);
  assert.equal(receipt.ok, true, receipt.error);
  assert.deepEqual(marks(receipt.data.fiscal.receipt.lines), [
    ['Espresso', 'А', true], ['Heineken', 'А', false], ['Supë Viçi', 'В', true],
  ]);
  const espresso = next.menu({ action: 'list' }).products.find(p => p.name === 'Espresso');
  next.menu({ ...espresso, action: 'product', active: true, domesticProduct: false });
  f.reopen();
  const restart = services(f.db);
  assert.equal(restart.menu({ action: 'list' }).products.find(p => p.id === espresso.id).domesticProduct, false);
  assert.deepEqual(await restart.pay(fresh.id), receipt);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM payments').get().n, 2);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

function mark(db, id) {
  return db.prepare('SELECT domestic FROM menu_product_fiscal_origin WHERE product_id=?').get(id)?.domestic ?? null;
}

test('restocking a kitchen dish or listed drink after upgrade uses the confirmed marks', t => {
  const f = profile(t, true);
  f.db.exec(`UPDATE menu_products SET active=0 WHERE id IN ('arra-product-0-0','arra-product-10-0');
    UPDATE menu_categories SET active=0 WHERE id='arra-category-12';`);
  f.reopen();
  f.db.exec(`UPDATE menu_products SET active=1 WHERE id IN ('arra-product-0-0','arra-product-10-0');
    UPDATE menu_categories SET active=1 WHERE id='arra-category-12';`);
  assert.equal(mark(f.db, 'arra-product-0-0'), 1);
  assert.equal(mark(f.db, 'arra-product-10-0'), 0);
  assert.equal(mark(f.db, 'arra-product-13-3'), 1);
});

test('upgrades classify Arra kitchen dishes and preserve unrelated menus, repurposed drink IDs and custom drinks', t => {
  const f = profile(t, true);
  f.db.exec(`INSERT INTO menu_categories(id,name,active,parent_id) VALUES('other','Food',1,NULL);
    INSERT INTO menu_products(id,category_id,name,price,active,destination) VALUES
      ('house-special','arra-category-1','House special',250,1,'kitchen2'),
      ('other-salad','other','Sallatë Arra',490,1,'kitchen'),
      ('other-espresso','other','Espresso',80,1,'bar'),
      ('custom-espresso','arra-category-11','Espresso',90,1,'bar'),
      ('custom-drink','arra-category-10','Local cordial',100,1,'bar');
    UPDATE menu_products SET name='Alternate drink' WHERE id='arra-product-10-4';
    UPDATE menu_products SET name='Alternate beer' WHERE id='arra-product-12-0';
    UPDATE menu_products SET category_id='other' WHERE id='arra-product-11-0';
    INSERT INTO menu_product_fiscal_origin VALUES('other-salad',0),('custom-drink',1),('arra-product-12-0',1);`);
  f.reopen();
  for (const [id, expected] of [
    ['house-special', 1], ['other-salad', 0], ['other-espresso', null], ['arra-product-11-0', null],
    ['custom-espresso', null], ['custom-drink', 1], ['arra-product-10-4', null], ['arra-product-12-0', 1],
  ]) assert.equal(mark(f.db, id), expected, id);
});

for (const genericId of ['arra-fresh-juice', 'local-adopted-juice']) {
  test(`v52 generic juice ${genericId} is marked without changing the retired orange juice`, t => {
    const f = profile(t, true);
    f.db.exec(`UPDATE menu_products SET name='Lëng Natyral Portokall',active=0 WHERE id='arra-product-10-17';
      INSERT INTO menu_product_fiscal_origin VALUES('arra-product-10-17',0);`);
    f.db.prepare(`INSERT INTO menu_products(id,category_id,name,price,active,destination)
      VALUES(?,'arra-category-10','Leng I shtrydhur',180,1,'bar')`).run(genericId);
    f.db.prepare('UPDATE menu_products SET active=0 WHERE id=?').run(genericId);
    f.db.exec("UPDATE menu_categories SET active=0 WHERE id='arra-category-10'");
    f.reopen();
    f.db.prepare('UPDATE menu_products SET active=1 WHERE id=?').run(genericId);
    f.db.exec("UPDATE menu_categories SET active=1 WHERE id='arra-category-10'");
    assert.equal(mark(f.db, genericId), 1);
    assert.equal(mark(f.db, 'arra-product-10-17'), 0);
  });
}

test('a failed origin update rolls back the whole migration and retries from v52', t => {
  const { db } = profile(t, true);
  db.exec(`CREATE TRIGGER fail_origin BEFORE INSERT ON menu_product_fiscal_origin
    WHEN (SELECT COUNT(*) FROM menu_product_fiscal_origin)>=4
    BEGIN SELECT RAISE(ABORT, 'origin write failed'); END`);
  assert.throws(() => migrate(db), /origin write failed/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 52);
  assert.equal(db.prepare('SELECT count(*) AS n FROM menu_product_fiscal_origin').get().n, 0);
  db.exec('DROP TRIGGER fail_origin');
  migrate(db);
  assertSeedClassifications(db);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
