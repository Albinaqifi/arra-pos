const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { seedMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items');

test('version 12 upgrade preserves an existing order and rejects invalid choices atomically', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-mod-independent-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir);
  seedMenu(db);
  db.exec(`DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE application_audit; DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; INSERT INTO local_users (id,username,salt,password_hash) VALUES (1,'sample',x'00',x'00');
    INSERT INTO user_permissions VALUES (1,'orders.view'),(1,'orders.change');
    INSERT INTO dining_areas (id,name) VALUES (1,'Inside');
    INSERT INTO dining_tables (id,area,area_id) VALUES (1,'Inside',1);
    INSERT INTO orders VALUES (1,1,1,'open');
    INSERT INTO order_items (order_id,product_id,name,unit_price,quantity,status) VALUES (1,'qebapa','Historical',200,2,'pending');
    DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 12;`);
  db.close();
  db = openDatabase(dir);
  assert.equal(db.prepare('SELECT count(*) AS n FROM financial_scopes').get().n, 0);
  db.exec("INSERT INTO financial_scopes SELECT id, 'waiter' FROM local_users");
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.deepEqual({ ...db.prepare('SELECT name,unit_price,quantity FROM order_items').get() }, {name:'Historical',unit_price:200,quantity:2});
  db.exec(`INSERT INTO modifier_groups VALUES ('required','qebapa','Size',1,1),('optional','qebapa','Extra',0,1),('foreign','cola','Ice',0,1),('inactive','qebapa','Old',0,0);
    INSERT INTO modifier_options VALUES ('size','required','Large',30,1),('discount','optional','Discount',-500,1),('foreign-option','foreign','Ice',0,1),('old-option','inactive','Old',0,1),('disabled','required','Disabled',0,0);`);
  let handler, user = 1; const trusted = {};
  registerOrderItems({handle: (_, fn) => {handler = fn;}}, e => e === trusted, db, {currentUserId: () => user, authenticatedUserId: () => user});
  const add = optionIds => handler(trusted, {action:'add',orderId:1,productId:'qebapa',optionIds});
  for (const options of [[], ['foreign-option'], ['size','old-option'], ['disabled'], ['size','discount'], ['size','size']]) {
    assert.equal(add(options).ok, false, JSON.stringify(options));
    assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM order_item_modifiers').get().n, 0);
  }
  user = null; assert.equal(add(['size']).ok, false);
  user = 1; assert.equal(handler({}, {action:'add',orderId:1,productId:'qebapa',optionIds:['size']}).ok, false);
  db.exec("DELETE FROM user_permissions WHERE permission IN ('employees.view','employees.change'); DROP TABLE employee_permission_audit; DROP TABLE employee_credential_audit; DROP TABLE employee_account_audit; CREATE TRIGGER fail_modifier BEFORE INSERT ON order_item_modifiers BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
  assert.equal(add(['size']).ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM order_item_modifiers').get().n, 0);
  db.exec('DROP TRIGGER fail_modifier');
  const saved = add(['size']); assert.equal(saved.ok, true); assert.equal(saved.data.total, 650);
  assert.deepEqual({...saved.data.items[1].modifiers[0]}, {groupName:'Size',optionName:'Large',adjustment:30});
  db.close();
});

test('version 13 migration failure rolls back schema and preserves version 12 data', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-mod-migration-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  let db = openDatabase(dir);
  db.exec("DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; INSERT INTO app_metadata (key,value) VALUES ('sample','retained'); DROP TABLE order_item_modifiers; DROP TABLE modifier_options; DROP TABLE modifier_groups; CREATE TABLE modifier_options (conflict TEXT); DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; DROP TABLE preparation_ticket_items; DROP TABLE preparation_tickets; DROP TABLE preparation_rounds; ALTER TABLE menu_products DROP COLUMN destination; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; PRAGMA user_version = 12;");
  db.close();
  assert.throws(() => openDatabase(dir));
  const {DatabaseSync} = require('node:sqlite');
  db = new DatabaseSync(path.join(dir, 'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
  assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='sample'").get().value, 'retained');
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='modifier_groups'").get().n, 0);
  db.close();
});
