const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { seedArraMenu } = require('../src/desktop/arra-menu');
const { seedTables } = require('../src/desktop/tables');
const { registerMenuConfig } = require('../src/desktop/menu-config');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerBills } = require('../src/desktop/bills');
const { authorizedDatabase } = require('./support/authorized-database');
const { historicalDatabase } = require('./support/historical-database');

function fixture(t, open = openDatabase) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-fiscal-menu-'));
  let db = authorizedDatabase(open(directory));
  seedTables(db);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return {
    get db() { return db; },
    reopen() { db.close(); db = openDatabase(directory); }
  };
}

test('103 dine-in seed products carry the confirmed VAT group, including both groups at the bar', t => {
  const { db } = fixture(t);
  seedArraMenu(db);
  const groups = db.prepare(`SELECT p.destination, t.tax_group, count(*) AS n FROM menu_products p
    LEFT JOIN menu_product_fiscal_tax t ON t.product_id=p.id GROUP BY p.destination, t.tax_group ORDER BY 1,2`).all();
  assert.deepEqual(groups.map(g => [g.destination, g.tax_group, g.n]),
    [['bar', 'А', 16], ['bar', 'В', 25], ['kitchen', 'В', 23], ['kitchen2', 'В', 39]]);
  for (const row of db.prepare(`SELECT p.name, c.name AS category, t.tax_group FROM menu_products p
    JOIN menu_categories c ON c.id=p.category_id JOIN menu_product_fiscal_tax t ON p.id=t.product_id`).all()) {
    assert.equal(row.tax_group, row.category === 'Alcoholic Drinks' ? 'А' : 'В', row.name);
  }
});

test('authorized catalog edits apply only to future entries and their modifier-adjusted bill lines', t => {
  const f = fixture(t);
  const db = f.db;
  seedArraMenu(db);
  db.exec(`INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open');`);
  const handlers = {}, event = {};
  const ipc = { handle(channel, fn) { handlers[channel] = fn; } };
  const allowed = sender => sender === event;
  const session = { currentUserId: () => 1, authenticatedUserId: () => 1 };
  for (const register of [registerMenuConfig, registerOrderItems, registerBills]) register(ipc, allowed, db, session);
  const menu = request => handlers['arra:menu-config'](event, request);
  const items = request => handlers['arra:order-items'](event, { orderId: 1, ...request });
  const bill = request => handlers['arra:bill'](event, { orderId: 1, ...request });
  const product = { action: 'product', id: 'arra-product-2-0', categoryId: 'arra-category-2',
    name: 'Sample', price: 120, active: true, sortOrder: 2, destination: 'bar' };
  assert.equal(menu({ ...product, taxGroup: 'А' }).error, 'Access denied');
  db.exec("INSERT INTO user_permissions VALUES(1,'menu.change')");
  for (const value of ['C', 'A', 'B', 18, '', 'Г']) assert.equal(menu({ ...product, taxGroup: value }).ok, false);
  assert.equal(menu(product).ok, true); // older clients omit the field
  const groupForProduct = () => menu({ action: 'list' }).data.products.find(p => p.id === product.id).taxGroup;
  assert.equal(groupForProduct(), 'В');
  const option = 'arra-product-2-0-pasta-0';
  db.prepare('UPDATE modifier_options SET adjustment=20 WHERE id=?').run(option);
  const add = { action: 'add', productId: product.id, optionIds: [option] };
  assert.equal(items({ ...add, taxGroup: 'А' }).ok, false);
  assert.equal(items(add).ok, true);
  assert.equal(menu({ ...product, taxGroup: 'А' }).ok, true);
  assert.equal(items(add).ok, true);
  const context = JSON.parse(db.prepare("SELECT context FROM application_audit WHERE entity_type='product' ORDER BY id DESC LIMIT 1").get().context);
  assert.equal(context.before.tax_group, 'В');
  assert.equal(context.after.tax_group, 'А');
  assert.equal(menu({ ...product, taxGroup: null }).ok, true);
  assert.equal(groupForProduct(), null);
  assert.equal(items({ action: 'send', requestId: 'fiscal-menu-round' }).ok, true);
  const review = bill({ action: 'review' });
  assert.equal(bill({ action: 'generate', fingerprint: review.data.fingerprint }).ok, true);
  f.reopen();
  const lines = f.db.prepare(`SELECT l.unit_price AS price, t.tax_group AS taxGroup, l.modifiers FROM bill_lines l
    LEFT JOIN order_item_fiscal_tax t ON t.item_id=l.item_id ORDER BY l.id`).all();
  assert.deepEqual(lines.map(l => [l.price, l.taxGroup, JSON.parse(l.modifiers)[0].adjustment]), [[140, 'В', 20], [140, 'А', 20]]);
  for (const sql of ["UPDATE order_item_fiscal_tax SET tax_group='А'", "DELETE FROM order_item_fiscal_tax",
    "INSERT OR REPLACE INTO order_item_fiscal_tax VALUES(1,'А')"]) assert.throws(() => f.db.exec(sql), /frozen/);
});

test('v43 upgrade classifies only original unedited seed identities and preserves pre-upgrade bills', t => {
  const f = fixture(t, historicalDatabase(43).openDatabase);
  f.db.exec(`INSERT INTO menu_categories(id,name,active) VALUES('sample','Sample',1);
    INSERT INTO menu_products(id,category_id,name,price,active,destination) VALUES
      ('arra-product-11-0','sample','Espresso',70,1,'bar'),
      ('arra-product-12-0','sample','Beer',180,1,'bar'),
      ('arra-product-12-1','sample','Changed product',70,1,'bar'),
      ('arra-product-12-2','sample','Beer',180,1,'bar'),
      ('custom','sample','Beer',180,1,'bar');
    INSERT INTO application_audit(actor_id,occurred_at,action,entity_type,entity_id,context)
      VALUES(1,1,'update','product','arra-product-12-1','{}');
    INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open');
    INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'arra-product-12-0','Beer',180,1,'sent');
    INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,180,'old');
    INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES(1,1,'Beer',180,1,'[]');`);
  f.reopen();
  const rows = f.db.prepare('SELECT product_id, tax_group FROM menu_product_fiscal_tax ORDER BY product_id').all();
  assert.deepEqual(rows.map(r => [r.product_id, r.tax_group]), [['arra-product-11-0', 'В'], ['arra-product-12-0', 'А']]);
  const line = f.db.prepare('SELECT l.name, l.unit_price, t.tax_group FROM bill_lines l LEFT JOIN order_item_fiscal_tax t ON l.item_id=t.item_id').get();
  assert.deepEqual({ ...line }, { name: 'Beer', unit_price: 180, tax_group: null });
  assert.throws(() => f.db.exec("INSERT INTO order_item_fiscal_tax VALUES(1,'А')"), /frozen/);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('origin classification is authorized, audited and frozen on order entry', t => {
  const f=fixture(t); const db=f.db; seedArraMenu(db);
  db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open')");
  const handlers={}, event={}, ipc={handle:(channel,fn)=>handlers[channel]=fn};
  const session={currentUserId:()=>1,authenticatedUserId:()=>1};
  registerMenuConfig(ipc,e=>e===event,db,session); registerOrderItems(ipc,e=>e===event,db,session);
  const menu=req=>handlers['arra:menu-config'](event,req);
  const product={action:'product',id:'arra-product-11-0',categoryId:'arra-category-11',name:'Espresso',price:70,active:true,sortOrder:0,destination:'bar'};
  assert.equal(menu({...product,domesticProduct:true}).error,'Access denied');
  db.exec("INSERT INTO user_permissions VALUES(1,'menu.change')");
  for (const value of [0,1,'yes','false']) assert.equal(menu({...product,domesticProduct:value}).ok,false);
  assert.equal(menu({...product,domesticProduct:true}).ok,true);
  assert.equal(menu({action:'list'}).data.products.find(p=>p.id===product.id).domesticProduct,true);
  assert.equal(handlers['arra:order-items'](event,{action:'add',orderId:1,productId:product.id,optionIds:[]}).ok,true);
  assert.equal(menu({...product,domesticProduct:false}).ok,true);
  assert.equal(handlers['arra:order-items'](event,{action:'add',orderId:1,productId:product.id,optionIds:[]}).ok,true);
  const audit=JSON.parse(db.prepare("SELECT context FROM application_audit WHERE entity_type='product' ORDER BY id DESC LIMIT 1").get().context);
  assert.equal(audit.before.domestic,1); assert.equal(audit.after.domestic,0);
  assert.deepEqual(db.prepare('SELECT domestic FROM order_item_fiscal_origin ORDER BY item_id').all().map(r=>r.domestic),[1,0]);
  for(const sql of ['UPDATE order_item_fiscal_origin SET domestic=0','DELETE FROM order_item_fiscal_origin','INSERT OR REPLACE INTO order_item_fiscal_origin VALUES(1,0)']) assert.throws(()=>db.exec(sql),/frozen/);
});

test('v46 upgrade leaves existing bill origins unknown and preserves its lines', t => {
  const f=fixture(t,historicalDatabase(46).openDatabase); seedArraMenu(f.db, { applyOrigins: false });
  f.db.exec("INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'arra-product-11-0','Espresso',70,1,'sent'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'old'); INSERT INTO bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers) VALUES(1,1,'Espresso',70,1,'[]')");
  f.reopen();
  assert.equal(f.db.prepare('SELECT count(*) n FROM menu_product_fiscal_origin').get().n,103);
  assert.equal(f.db.prepare("SELECT domestic FROM menu_product_fiscal_origin WHERE product_id='arra-product-11-0'").get().domestic,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM order_item_fiscal_origin').get().n,0);
  assert.equal(f.db.prepare('SELECT total FROM bills WHERE id=1').get().total,70);
  const handlers={}, event={}, ipc={handle:(channel,fn)=>handlers[channel]=fn};
  let actor=1; const session={currentUserId:()=>actor,authenticatedUserId:()=>actor};
  f.db.exec("INSERT INTO user_permissions VALUES(1,'menu.change'); INSERT INTO local_users(id,username,salt,password_hash) VALUES(2,'manager',x'00',x'00'); INSERT INTO financial_scopes VALUES(2,'combined'); INSERT INTO user_permissions VALUES(2,'menu.change')");
  registerMenuConfig(ipc,e=>e===event,f.db,session);
  const menu=req=>handlers['arra:menu-config'](event,req);
  assert.equal(menu({action:'classifyOrigin',itemId:1,domesticProduct:true}).error,'Access denied');
  assert.deepEqual(menu({action:'list'}).data.unclassifiedOrigins,[]);
  actor=2;
  assert.equal(menu({action:'list'}).data.unclassifiedOrigins[0].id,1);
  assert.equal(menu({action:'classifyOrigin',itemId:1,domesticProduct:'yes'}).ok,false);
  assert.equal(menu({action:'classifyOrigin',itemId:1,domesticProduct:true}).ok,true);
  assert.equal(menu({action:'classifyOrigin',itemId:1,domesticProduct:true}).ok,true);
  assert.equal(menu({action:'classifyOrigin',itemId:1,domesticProduct:false}).ok,false);
  assert.equal(f.db.prepare("SELECT count(*) n FROM application_audit WHERE action='classify_origin'").get().n,1);
  assert.equal(f.db.prepare('SELECT domestic FROM order_item_fiscal_origin WHERE item_id=1').get().domestic,1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('an existing fiscal attempt freezes even missing origin and hides the classification action', t => {
  const f=fixture(t); const db=f.db; seedArraMenu(db, { applyOrigins: false });
  db.exec("UPDATE financial_scopes SET scope='combined' WHERE user_id=1; INSERT INTO user_permissions VALUES(1,'menu.change'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_items(id,order_id,product_id,name,unit_price,quantity,status) VALUES(1,1,'arra-product-11-0','Espresso',70,1,'sent'); INSERT INTO bills(id,order_id,actor_id,generated_at,total,fingerprint) VALUES(1,1,1,1,70,'old'); INSERT INTO fiscal_checkout_sales VALUES(1,1,'simulation',NULL,'cash','{}',1); INSERT INTO fiscal_checkout_attempts VALUES(1,1,1)");
  const handlers={}, event={}, ipc={handle:(channel,fn)=>handlers[channel]=fn};
  const session={currentUserId:()=>1,authenticatedUserId:()=>1};
  registerMenuConfig(ipc,e=>e===event,db,session);
  const menu=req=>handlers['arra:menu-config'](event,req);
  assert.deepEqual(menu({action:'list'}).data.unclassifiedOrigins,[]);
  assert.equal(menu({action:'classifyOrigin',itemId:1,domesticProduct:true}).ok,false);
  assert.throws(()=>db.exec('INSERT INTO order_item_fiscal_origin VALUES(1,1)'),/frozen/);
  assert.equal(db.prepare('SELECT receipt FROM fiscal_checkout_sales').get().receipt,'{}');
});
