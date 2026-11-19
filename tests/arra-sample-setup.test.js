const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { openDatabase } = require('../src/desktop/database');
const { createSession } = require('../src/desktop/session');
const { registerMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerTables } = require('../src/desktop/tables');

function checkDrinks(menu) {
 const drinks = menu.categories.find(category => category.name === 'Drinks');
 const sections = menu.categories.filter(category => category.parentId === drinks.id);
 assert.deepEqual(sections.map(section => section.name), ['Pije Freskuese', 'Kafe & Çaj', 'Alcoholic Drinks']);
 const softDrinks = menu.products.filter(product => product.categoryId === sections[0].id);
 assert.equal(softDrinks.length, 19);
 assert.deepEqual(softDrinks.filter(product => /^(lëng|leng) /i.test(product.name)).map(p => [p.name, p.price]), [
  ['Lëng Mollë', 120], ['Lëng Portokall', 120], ['Lëng Pjeshkë', 120], ['Lëng Fruta Mali', 120],
  ['Leng I shtrydhur', 180]
 ]);
 const alcohol = menu.products.filter(product => product.categoryId === sections[2].id);
 const originalSections = [
  [12, [['Heineken', 180], ['Peja', 180]]],
  [13, [['Muskat Temjanika e bardhë 0.20 l', 420], ['Muskat Temjanika e bardhë 0.70 l', 1850],
   ['Alexandria Cuvée e bardhë 0.20 l', 360], ['Alexandria Cuvée e bardhë 0.70 l', 1400],
   ['Cabernet Sauvignon e kuqe 0.20 l', 420], ['Cabernet Sauvignon e kuqe 0.70 l', 1850],
   ['Alexandria Cuvée Rosé 0.20 l', 360], ['Alexandria Cuvée Rosé 0.70 l', 1400]]],
  [14, [['Raki Rrushi Bovin', 110], ['Raki Ftoi Akov', 200]]],
  [15, [['Chivas Regal', 320], ["Jack Daniel's", 300], ['Hennessy', 330], ['Jägermeister', 200]]]
 ];
 const expected = originalSections.flatMap(([section, products]) => products.map(([name, price], index) =>
  [`arra-product-${section}-${index}`, name, price]));
 assert.deepEqual(alcohol.map(p => [p.id, p.name, p.price]), expected);
}

function checkGrill(menu, add) {
 const category = menu.categories.find(c => c.name === 'Në Zgarë & Klasike');
 const grill = menu.products.filter(p => p.categoryId === category.id);
 const steaks = ['Ribeye Black Angus', 'Tomahawk Viçi', 'Biftek Viçi'];
 assert.deepEqual(grill.map(p => p.name), [
  'Mish në Furrë', ...steaks, 'Fileto Viçi', 'Porcion Mishrash Mikse', 'Fileto Salmoni', 'Cordon Bleu'
 ]);
 const doneness = ['Doneness', ['Rare', 'Medium rare', 'Medium', 'Medium well', 'Well done']];
 const sides = ['Shoqëruesit', ['Zarzavate', 'Patate të pjekura', 'Patatina të ëmbla', 'Bagetë me hudhër', 'Pa shoqërues']];
 const sauces = ['Sosërat', ['Pepe verde', 'Sos me kërpudha', 'Krem gorgonzola', 'Sos chimichurri', 'Pa sos']];
 for (const product of grill) {
  const groups = menu.groups.filter(g => g.productId === product.id);
  if (product.name === 'Fileto Salmoni') {
   assert.deepEqual(groups, []);
   assert.equal(add(product.id, [menu.options[0].id]).ok, false);
   const result = add(product.id, []);
   assert.equal(result.ok, true);
   assert.deepEqual(result.data.items.at(-1).modifiers, []);
   continue;
  }
  const expected = steaks.includes(product.name) ? [doneness, sides, sauces] : [sides, sauces];
  assert.deepEqual(groups.map(g => g.name), expected.map(([name]) => name), product.name);
  const choices = groups.map((group, index) => {
   assert.equal(group.required, 1, group.name);
   const options = menu.options.filter(o => o.groupId === group.id);
   assert.deepEqual(options.map(o => o.name), expected[index][1], product.name);
   assert.ok(options.every(o => o.adjustment === 0));
   return options;
  });
  const selection = choices.map(options => options.at(-1).id);
  assert.equal(add(product.id, []).ok, false);
  for (const missing of selection) {
   assert.equal(add(product.id, selection.filter(id => id !== missing)).ok, false, product.name);
  }
  assert.equal(add(product.id, [...selection, choices[0][0].id]).ok, false);
  const result = add(product.id, selection);
  assert.equal(result.ok, true, product.name);
  assert.deepEqual(result.data.items.at(-1).modifiers.map(m => [m.groupName, m.optionName]),
   expected.map(([name, options]) => [name, options.at(-1)]));
 }
}

test('Arra setup creates scoped identities, menu choices, and preserves existing data', {skip:process.platform !== 'win32'}, () => {
 const parent = fs.mkdtempSync(path.join(os.tmpdir(),'arra-menu-setup-'));
 const directory = path.join(parent,'data');
 const electron = path.join(__dirname,'../node_modules/electron/dist/electron.exe');
 const script = path.join(__dirname,'../src/desktop/setup-arra-sample.js');
 const passwords = Array.from({length:3},()=>crypto.randomBytes(16).toString('hex'));
 const values = [passwords[0],passwords[1],passwords[1],passwords[2],String(crypto.randomInt(1000,10000)),String(crypto.randomInt(100000,1000000)), 'restaurant-arra','admin','adminB','dardan-admin','Waiter','Dardan'];
 const run = (input,target=directory,...options) => spawnSync(electron,[script,target,...options],{input:JSON.stringify(input),encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
 try {
  assert.notEqual(run(['invalid']).status,0); assert.equal(fs.existsSync(directory),false);
  const duplicate = values.slice(); duplicate[7] = duplicate[6];
  assert.notEqual(run(duplicate).status,0); assert.equal(fs.existsSync(directory),false);
  const custom = values.slice(); custom.splice(6,6,'entry-x','owner-x','owner-y','owner-z','staff-x','manager-x');
  const customDirectory = path.join(parent,'custom'); assert.equal(run(custom,customDirectory).status,0);
  const supervised = path.join(parent,'supervised');
  assert.equal(run(custom,supervised,'--new-pf700-commissioning-profile').status,0);
  assert.equal(fs.existsSync(path.join(supervised,'SAMPLE-DATA-ONLY')),false);
  assert.ok(require('../src/desktop/pf700-commissioning').isCommissionedDirectory(supervised));
  const prepared = openDatabase(supervised);
  try {
   for (const table of ['orders','bills','payments','fiscal_checkout_sales','account_a_closes']) {
    assert.equal(prepared.prepare('SELECT count(*) AS n FROM ' + table).get().n,0,table);
   }
   assert.equal(prepared.prepare('SELECT count(*) AS n FROM menu_product_fiscal_tax').get().n,103);
  } finally { prepared.close(); }
  assert.notEqual(run(custom,customDirectory,'--new-pf700-commissioning-profile').status,0);
  assert.equal(require('../src/desktop/pf700-commissioning').isCommissionedDirectory(customDirectory),false);
  const customDb = openDatabase(customDirectory);
  try { const customSession = createSession(customDb); assert.equal(customSession.signIn({username:'entry-x',password:values[0]}).ok,true); assert.ok(customSession.listWaiters().data.some(user=>user.name==='staff-x')); }
  finally { customDb.close(); }
  const result = run(values); assert.equal(result.status,0,result.stderr);
  for (const secret of values.slice(0,6)) assert.equal((result.stdout+result.stderr).includes(secret),false);
  const db = openDatabase(directory);
  try {
   const session = createSession(db);
   for (const [name,pass] of [['restaurant-arra',values[0]],['admin',values[1]],['adminB',values[2]],['dardan-admin',values[3]]]) assert.equal(session.signIn({username:name,password:pass}).ok,true);
   session.signIn({username:'restaurant-arra',password:values[0]});
   const staff = session.listWaiters().data;
   for (const [name,pin] of [['Waiter',values[4]],['Dardan',values[5]]]) {
    const user = staff.find(x=>x.name===name); assert.ok(user);
    assert.equal(session.selectWaiter({id:user.id,pin:'0'}).ok,false);
    assert.equal(session.selectWaiter({id:user.id,pin}).ok,true);
   }
   assert.deepEqual(db.prepare("SELECT username,scope FROM local_users JOIN financial_scopes ON user_id=local_users.id WHERE username IN ('admin','adminB','dardan-admin') ORDER BY username").all().map(x=>[x.username,x.scope]),[['admin','A'],['adminB','B'],['dardan-admin','combined']]);
   assert.deepEqual(db.prepare('SELECT name FROM menu_categories WHERE parent_id IS NULL ORDER BY sort_order').all().map(x=>x.name),['Food','Drinks']);
   const subcategories = db.prepare('SELECT c.name, p.name AS parent FROM menu_categories c JOIN menu_categories p ON p.id=c.parent_id ORDER BY p.sort_order,c.sort_order').all();
   assert.deepEqual(subcategories.filter(x=>x.parent==='Food').map(x=>x.name),['Sallata','Antipasta','Pasta','Pizza','Në Zgarë & Klasike','Nga Kuzhina Shqiptare','Supa','Për Fëmijë','Ëmbëlsira','Shtesa']);
   session.selectWaiter({id:staff.find(x=>x.name==='Waiter').id,pin:values[4]});
   let listTables;
   registerTables({handle(_channel,fn){listTables=fn;}}, () => true, db, session);
   const floor = listTables({}, {});
   assert.equal(floor.ok, true);
   assert.equal(floor.data.length, 16);
   assert.ok(floor.data.every(table => table.occupied === 0 && table.orderId === null));
   for (const table of ['orders','order_items','bills','payments','preparation_tickets','print_jobs','test_print_jobs','account_a_closes']) {
    assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table);
   }
   db.prepare("INSERT INTO orders(table_id,opened_at,status) VALUES(1,1,'open')").run();
   db.prepare("INSERT INTO order_waiter_ownership(order_id,waiter_id,assigned_by,assigned_at,source) VALUES(1,?,?,1,'open')").run(session.currentUserId(),session.currentUserId());
   let handler; const trusted = {};
   registerOrderItems({handle(_channel,fn){handler=fn;}}, event=>event===trusted, db, session);
   let listMenu;
   registerMenu({handle(_channel,fn){listMenu=fn;}}, event=>event===trusted, db, session);
   const menu = listMenu(trusted, {});
   assert.equal(menu.ok, true);
   checkDrinks(menu.data);
   checkGrill(menu.data, (productId, optionIds) => handler(trusted, {action:'add', orderId:1, productId, optionIds}));
   assert.equal(db.prepare("SELECT price FROM menu_products WHERE name='Ribeye Black Angus'").get().price,3300);
   assert.equal(db.prepare("SELECT destination FROM menu_products WHERE name='Espresso'").get().destination,'bar');
  } finally { db.close(); }
  fs.writeFileSync(path.join(directory,'sentinel'),'preserve');
  assert.notEqual(run(values).status,0); assert.equal(fs.readFileSync(path.join(directory,'sentinel'),'utf8'),'preserve');
 } finally { values.fill(''); fs.rmSync(parent,{recursive:true,force:true}); }
});
