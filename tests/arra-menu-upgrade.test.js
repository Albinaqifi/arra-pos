const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../src/desktop/database');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { registerMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items');

// Reconstruct the changed portion of the 105-item seed on a real v51 schema.
function legacyMenu(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  migrate(db);
  seedArraMenu(db);
  db.exec(`PRAGMA user_version=51;
    DELETE FROM modifier_options WHERE group_id LIKE '%-doneness';
    DELETE FROM modifier_groups WHERE id LIKE '%-doneness';
    INSERT INTO modifier_groups SELECT replace(id,'4-0','4-6'),'arra-product-4-6',name,required,active
      FROM modifier_groups WHERE product_id='arra-product-4-0';
    INSERT INTO modifier_options SELECT replace(id,'4-0','4-6'),replace(group_id,'4-0','4-6'),name,adjustment,active
      FROM modifier_options WHERE group_id LIKE 'arra-product-4-0-%';
    UPDATE menu_products SET name='Lëng Natyral Portokall' WHERE id='arra-product-10-17';
    UPDATE menu_products SET sort_order=20 WHERE id='arra-product-10-20';
    INSERT INTO menu_products(id,category_id,name,price,active,sort_order,destination) VALUES
      ('arra-product-10-18','arra-category-10','Lëng Natyral Mollë',180,1,18,'bar'),
      ('arra-product-10-19','arra-category-10','Lëng Natyral Limon',180,1,19,'bar');
    INSERT INTO menu_product_fiscal_tax VALUES('arra-product-10-18','В'),('arra-product-10-19','В');
    UPDATE menu_categories SET name='Birrë' WHERE id='arra-category-12';
    INSERT INTO menu_categories(id,name,active,parent_id,sort_order) VALUES
      ('arra-category-13','Verë',1,'arra-drinks',3),('arra-category-14','Raki',1,'arra-drinks',4),
      ('arra-category-15','Pije të Forta',1,'arra-drinks',5);
    UPDATE menu_products SET category_id='arra-category-' || substr(id,14,2),sort_order=CAST(substr(id,17) AS INTEGER)
      WHERE category_id='arra-category-12';
    INSERT INTO local_users(id,username,salt,password_hash) VALUES(1,'sample',randomblob(16),randomblob(32));
    INSERT INTO user_permissions VALUES(1,'menu.view'),(1,'orders.view'),(1,'orders.change');
    INSERT INTO financial_scopes VALUES(1,'waiter');
    INSERT INTO dining_tables(id,area) VALUES(1,'Sample');
    INSERT INTO orders(id,table_id,status,opened_at) VALUES(1,1,'open',1);
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');`);
  assert.equal(db.prepare('SELECT count(*) AS n FROM menu_products WHERE active=1').get().n,105);
  return db;
}

function service(db, register) {
  let handler;
  register({ handle(_, fn) { handler = fn; } }, () => true, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  return request => handler({}, request);
}

test('v51 upgrade exposes the corrected waiter menu and preserves original IDs, VAT and sent choices', t => {
  const db = legacyMenu(t);
  const add = service(db,registerOrderItems);
  const salmon = 'arra-product-4-6';
  const selected = [salmon + '-group-0-option-1', salmon + '-group-1-option-3'];
  assert.equal(add({action:'add',orderId:1,productId:salmon,optionIds:selected}).ok,true);
  assert.equal(add({action:'add',orderId:1,productId:'arra-product-10-18'}).ok,true);
  assert.equal(add({action:'send',orderId:1,requestId:'before-upgrade'}).ok,true);
  const snapshot = () => ['menu_product_fiscal_tax','order_items','order_item_modifiers','order_item_fiscal_tax','preparation_tickets','preparation_ticket_items','application_audit']
    .map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all());
  const before = snapshot();
  migrate(db);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);

  const {ok,data:menu} = service(db,registerMenu)({});
  assert.equal(ok,true);
  assert.equal(menu.products.length,103);
  assert.deepEqual(menu.categories.filter(c => c.parentId === 'arra-drinks').map(c => c.name),
    ['Pije Freskuese','Kafe & Çaj','Alcoholic Drinks']);
  assert.deepEqual(menu.products.filter(p => p.name === 'Leng I shtrydhur').map(p => [p.id,p.price]),[['arra-product-10-17',180]]);
  const alcohol = menu.categories.find(c => c.name === 'Alcoholic Drinks');
  const expected = [[12,2],[13,8],[14,2],[15,4]].flatMap(([section,count]) =>
    Array.from({length:count},(_,i) => `arra-product-${section}-${i}`));
  assert.deepEqual(menu.products.filter(p => p.categoryId === alcohol.id).map(p => p.id),expected);
  for (const index of [1,2,3]) {
    const productId = `arra-product-4-${index}`;
    const groups = menu.groups.filter(g => g.productId === productId);
    assert.deepEqual(groups.map(g => [g.name,g.required]),[['Doneness',1],['Shoqëruesit',1],['Sosërat',1]]);
    assert.deepEqual(menu.options.filter(o => o.groupId === groups[0].id).map(o => o.name),
      ['Rare','Medium rare','Medium','Medium well','Well done']);
    const optionIds = groups.map(g => menu.options.find(o => o.groupId === g.id).id);
    assert.equal(add({action:'add',orderId:1,productId,optionIds:optionIds.slice(1)}).ok,false);
    assert.equal(add({action:'add',orderId:1,productId,optionIds}).ok,true);
  }
  assert.deepEqual(menu.groups.filter(g => g.productId === salmon),[]);
  assert.equal(add({action:'add',orderId:1,productId:salmon}).ok,true);
  assert.equal(add({action:'add',orderId:1,productId:salmon,optionIds:selected}).ok,false);
  assert.equal(db.prepare("SELECT count(*) AS n FROM modifier_options WHERE group_id LIKE 'arra-product-4-6-%'").get().n,10);
  assert.equal(add({action:'add',orderId:1,productId:'arra-product-10-18'}).ok,false);
});

test('retains local menu edits and fiscal origins, with unknown origin for a genuinely new generic juice', t => {
  const db = legacyMenu(t);
  db.exec(`INSERT INTO menu_product_fiscal_origin VALUES('arra-product-10-17',1),('arra-product-10-18',0);
    UPDATE menu_products SET price=210 WHERE id='arra-product-10-18';
    UPDATE menu_products SET active=0 WHERE id='arra-product-4-1';
    UPDATE modifier_options SET adjustment=35 WHERE id='arra-product-4-6-group-1-option-0';
    INSERT INTO modifier_groups VALUES('custom-doneness','arra-product-4-2','Doneness',1,0);
    INSERT INTO menu_products(id,category_id,name,price,active,sort_order,destination)
      VALUES('custom-beer','arra-category-12','Sample beer',280,1,7,'bar');
    UPDATE menu_products SET price=600,sort_order=27 WHERE id='arra-product-13-0';
    UPDATE menu_categories SET active=0 WHERE id='arra-category-14';`);
  migrate(db);
  const menu = service(db,registerMenu)({}).data;
  const generic = menu.products.find(p => p.name === 'Leng I shtrydhur');
  assert.equal(generic.price,180);
  assert.notEqual(generic.id,'arra-product-10-17');
  assert.deepEqual(db.prepare('SELECT * FROM menu_product_fiscal_origin ORDER BY product_id').all().map(o => [o.product_id,o.domestic]),
    [['arra-product-10-17',1],['arra-product-10-18',0]]);
  assert.equal(db.prepare('SELECT tax_group FROM menu_product_fiscal_tax WHERE product_id=?').get(generic.id).tax_group,'В');
  assert.equal(menu.products.find(p => p.id === 'arra-product-10-18').price,210);
  assert.deepEqual({...db.prepare("SELECT name,active FROM menu_products WHERE id='arra-product-10-17'").get()},
    {name:'Lëng Natyral Portokall',active:0});
  assert.equal(db.prepare("SELECT count(*) AS n FROM modifier_groups WHERE id IN ('arra-product-4-1-doneness','arra-product-4-2-doneness')").get().n,0);
  assert.deepEqual(menu.groups.filter(g => g.productId === 'arra-product-4-6').map(g => g.name),['Sosërat']);
  assert.equal(menu.products.find(p => p.id === 'custom-beer').categoryId,'arra-category-12');
  assert.equal(menu.categories.find(c => c.id === 'arra-category-12').name,'Birrë');
  assert.equal(menu.products.some(p => p.id === 'arra-product-14-0'),false);
  const wine = db.prepare("SELECT price,sort_order FROM menu_products WHERE id='arra-product-13-0'").get();
  assert.deepEqual({...wine},{price:600,sort_order:27});
});

test('an already renamed generic keeps its identity and origin while standard flavors retire', t => {
  const db = legacyMenu(t);
  db.exec(`UPDATE menu_products SET name='Leng I shtrydhur' WHERE id='arra-product-10-17';
    INSERT INTO menu_product_fiscal_origin VALUES('arra-product-10-17',0);
    INSERT INTO menu_products(id,category_id,name,price,active,sort_order,destination)
      VALUES('older-generic','arra-category-10','Leng I shtrydhur',200,0,99,'bar');`);
  migrate(db);
  const menu = service(db,registerMenu)({}).data;
  assert.deepEqual(menu.products.filter(p => p.name === 'Leng I shtrydhur').map(p => [p.id,p.price]),[['arra-product-10-17',180]]);
  assert.equal(menu.products.some(p => p.name.startsWith('Lëng Natyral')),false);
  assert.equal(db.prepare("SELECT domestic FROM menu_product_fiscal_origin WHERE product_id='arra-product-10-17'").get().domestic,0);
  assert.equal(db.prepare("SELECT active FROM menu_products WHERE id='older-generic'").get().active,0);
});

test('an explicitly retired generic keeps its status and leaves the remaining active flavors available', t => {
  const db = legacyMenu(t);
  db.exec("UPDATE menu_products SET name='Leng I shtrydhur',active=0 WHERE id='arra-product-10-17'");
  migrate(db);
  const menu = service(db,registerMenu)({}).data;
  assert.equal(menu.products.some(p => p.name === 'Leng I shtrydhur'),false);
  assert.deepEqual(menu.products.filter(p => p.name.startsWith('Lëng Natyral')).map(p => p.id),['arra-product-10-18','arra-product-10-19']);
});

test('temporarily unavailable drinks remain hidden until restocked and reappear in the intended section', t => {
  const db = legacyMenu(t);
  db.exec(`UPDATE menu_products SET active=0 WHERE id='arra-product-13-0';
    INSERT INTO menu_products(id,category_id,name,price,active,sort_order,destination)
      VALUES('seasonal-beer','arra-category-12','Seasonal beer',180,0,2,'bar');`);
  migrate(db);
  const readMenu = service(db, registerMenu);
  const hidden = readMenu({}).data;
  assert.equal(hidden.products.some(p => ['arra-product-13-0','seasonal-beer'].includes(p.id)), false);

  db.exec("UPDATE menu_products SET active=1 WHERE id IN ('arra-product-13-0','seasonal-beer')");
  const restocked = readMenu({}).data;
  const section = id => restocked.categories.find(c => c.id === restocked.products.find(p => p.id === id)?.categoryId)?.name;
  assert.equal(section('arra-product-13-0'), 'Alcoholic Drinks');
  assert.equal(section('seasonal-beer'), 'Birrë');
});
