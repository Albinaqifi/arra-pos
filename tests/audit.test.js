const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { seedTables } = require('../src/desktop/tables');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');
const { registerMenuConfig } = require('../src/desktop/menu-config');

test('audit records trusted changes atomically and excludes notes and credentials', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-audit-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let db = openDatabase(dir); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO local_users (id,username,salt,password_hash) VALUES (1,'sample',x'00',x'00'); INSERT INTO financial_scopes SELECT id, 'waiter' FROM local_users; INSERT INTO user_permissions VALUES (1,'orders.view'),(1,'orders.change'),(1,'menu.change');");
  const session = {currentUserId: () => 1, authenticatedUserId: () => 1};
  const trusted = {}; let order, items, menu;
  registerOrders({handle: (_, fn) => order = fn}, e => e === trusted, db, session);
  registerOrderItems({handle: (_, fn) => items = fn}, e => e === trusted, db, session);
  registerMenuConfig({handle: (_, fn) => menu = fn}, e => e === trusted, db, session);
  assert.equal(order(trusted, {tableId: 1}).ok, true);
  assert.equal(order(trusted, {tableId: 1}).ok, true);
  const add = () => items(trusted, {action: 'add', orderId: 1, productId: 'qebapa'});
  const item = add().data.items[0];
  assert.equal(items(trusted, {action:'note', orderId:1, itemId:item.id, note:'private note'}).ok, true);
  assert.equal(items(trusted, {action:'increment', orderId:1, itemId:item.id}).ok, true);
  assert.equal(items(trusted, {action:'remove', orderId:1, itemId:item.id}).ok, true);
  const replacement = add().data.items[0];
  assert.notEqual(replacement.id, item.id);
  assert.equal(items(trusted, {action:'remove', orderId:1, itemId:replacement.id}).ok, true);
  assert.equal(items({}, {action:'add', orderId:1, productId:'qebapa'}).ok, false);
  assert.equal(menu(trusted, {action:'product', id:'qebapa', categoryId: db.prepare("SELECT category_id FROM menu_products WHERE id='qebapa'").get().category_id, name:'Sample', price:300, active:true, sortOrder:0}).ok, true);
  const rows = db.prepare('SELECT * FROM application_audit ORDER BY id').all();
  assert.deepEqual(rows.map(r => r.action), ['open','add','note_changed','quantity_changed','remove','add','remove','update']);
  assert.ok(rows.every(r => r.actor_id === 1 && r.occurred_at > 0));
  assert.equal(JSON.stringify(rows).includes('private note'), false);
  assert.equal(JSON.stringify(rows).includes('password'), false);
  assert.throws(() => db.exec('UPDATE application_audit SET action = \'changed\''), /append-only/);
  assert.throws(() => db.exec('DELETE FROM application_audit'), /append-only/);
  const count = rows.length;
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON application_audit BEGIN SELECT RAISE(ABORT, 'failure'); END;");
  assert.equal(add().ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM application_audit').get().n, count);
  assert.equal(menu(trusted, {action:'product', id:'qebapa', categoryId:db.prepare("SELECT category_id FROM menu_products WHERE id='qebapa'").get().category_id, name:'Another', price:400, active:true, sortOrder:0}).ok, false);
  assert.equal(db.prepare("SELECT price FROM menu_products WHERE id='qebapa'").get().price, 300);
  db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) AS n FROM application_audit').get().n, count);
  db.close();
});

test('removing pre-audit items retains modifier snapshots on both removal paths', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-audit-upgrade-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let db = openDatabase(dir); seedTables(db); seedMenu(db);
  db.exec(`DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; INSERT INTO local_users (id,username,salt,password_hash) VALUES (1,'sample',x'00',x'00');
    INSERT INTO user_permissions VALUES (1,'orders.view'),(1,'orders.change');
    INSERT INTO orders VALUES (1,1,100,'open');
    INSERT INTO order_items (id,order_id,product_id,name,unit_price,quantity,status,note)
      VALUES (7,1,'qebapa','Old item',250,2,'pending','private note'), (8,1,'qebapa','Other item',230,1,'pending','');
    INSERT INTO order_item_modifiers VALUES (7,'Size','Large',30), (7,'Extra','Sauce',10), (8,'Size','Small',10);
    DROP TABLE application_audit;
    DROP TRIGGER employee_permission_audit_no_replace;
    DROP TRIGGER employee_account_audit_no_replace;
    DROP TRIGGER employee_credential_audit_no_replace;
    DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 14;`);
  db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) AS n FROM financial_scopes').get().n, 0);
  db.exec("INSERT INTO financial_scopes SELECT id, 'waiter' FROM local_users");
  let handler; const trusted = {};
  registerOrderItems({handle: (_, fn) => handler = fn}, e => e === trusted, db, {currentUserId: () => 1, authenticatedUserId: () => 1});
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON application_audit BEGIN SELECT RAISE(ABORT, 'failure'); END;");
  assert.equal(handler(trusted, {action:'remove',orderId:1,itemId:7}).ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_item_modifiers WHERE item_id=7').get().n, 2);
  db.exec('DROP TRIGGER fail_audit');
  assert.equal(handler(trusted, {action:'remove',orderId:1,itemId:7}).ok, true);
  assert.equal(handler(trusted, {action:'decrement',orderId:1,itemId:8}).ok, true);
  const events = db.prepare('SELECT context FROM application_audit ORDER BY id').all().map(row => JSON.parse(row.context));
  assert.deepEqual(events[0].modifiers, [
    {groupName:'Size', optionName:'Large', adjustment:30},
    {groupName:'Extra', optionName:'Sauce', adjustment:10}
  ]);
  assert.deepEqual(events[1].modifiers, [{groupName:'Size', optionName:'Small', adjustment:10}]);
  assert.equal(JSON.stringify(events).includes('private note'), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_item_modifiers').get().n, 0);
  db.close();
});

test('replace cannot overwrite any audit history with recursive triggers disabled', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-audit-replace-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const db = openDatabase(dir);
  db.exec(`PRAGMA recursive_triggers = OFF;
    INSERT INTO local_users (id,username,salt,password_hash) VALUES (1,'sample',x'00',x'00');
    INSERT INTO application_audit VALUES (1,1,1,'original','employee','1',NULL,'{}');
    INSERT INTO employee_permission_audit VALUES (1,1,1,'orders.view',1,1);
    INSERT INTO employee_account_audit VALUES (1,1,1,'before','after',1,1,1);
    INSERT INTO employee_credential_audit VALUES (1,1,1,1,0,1);`);
  for (const sql of [
    "INSERT OR REPLACE INTO application_audit VALUES (1,1,2,'changed','employee','1',NULL,'{}')",
    "INSERT OR REPLACE INTO employee_permission_audit VALUES (1,1,1,'orders.change',0,2)",
    "INSERT OR REPLACE INTO employee_account_audit VALUES (1,1,1,'x','y',1,1,2)",
    "INSERT OR REPLACE INTO employee_credential_audit VALUES (1,1,1,0,1,2)"
  ]) assert.throws(() => db.exec(sql), /append-only/);
  assert.equal(db.prepare('SELECT action FROM application_audit').get().action, 'original');
  assert.equal(db.prepare('SELECT permission FROM employee_permission_audit').get().permission, 'orders.view');
  assert.equal(db.prepare('SELECT old_username FROM employee_account_audit').get().old_username, 'before');
  assert.equal(db.prepare('SELECT password_changed FROM employee_credential_audit').get().password_changed, 1);
  db.close();
});
