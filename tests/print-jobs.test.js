const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const { seedTables } = require('../src/desktop/tables'); const { seedMenu } = require('../src/desktop/menu');
const { registerOrderItems } = require('../src/desktop/order-items'); const { registerPrintJobs } = require('../src/desktop/print-jobs');
test('simulated failure and uncertainty persist, retries refer to one job and never add items', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-print-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db); db.exec("INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open')");
  let orders, jobs; const event = {}, session = { currentUserId: () => 1, authenticatedUserId: () => 1 };
  const register = () => { registerOrderItems({ handle: (_, fn) => orders = fn }, e => e === event, db, session); registerPrintJobs({ handle: (_, fn) => jobs = fn }, e => e === event, db, session); }; register();
  const call = r => jobs(event, r);
  assert.equal(call({ action: 'simulate', destination: 'kitchen', result: 'failed' }).ok, true);
  orders(event, { action: 'add', orderId: 1, productId: 'qebapa' }); orders(event, { action: 'send', orderId: 1, requestId: 'send' });
  let job = call({ action: 'list' }).data.jobs[0]; assert.equal(job.result, 'failed'); assert.equal(job.attempts, 1);
  assert.equal(jobs({}, { action: 'retry', jobId: job.id, requestId: 'x' }).ok, false);
  call({ action: 'simulate', destination: 'kitchen', result: 'uncertain' });
  assert.equal(call({ action: 'retry', jobId: job.id, requestId: 'x' }).ok, true);
  assert.equal(call({ action: 'retry', jobId: job.id, requestId: 'x' }).ok, true);
  db.close(); db = authorizedDatabase(openDatabase(dir)); register(); job = call({ action: 'list' }).data.jobs[0]; assert.equal(job.result, 'uncertain'); assert.equal(job.attempts, 2);
  call({ action: 'simulate', destination: 'kitchen', result: 'success' });
  assert.equal(call({ action: 'retry', jobId: job.id, requestId: 'y' }).ok, true);
  job = call({ action: 'list' }).data.jobs[0]; assert.equal(job.result, 'success'); assert.equal(job.hadUncertain, 1);
  assert.equal(call({ action: 'retry', jobId: job.id, requestId: 'z' }).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM order_items').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM print_jobs').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM print_attempts').get().n, 3);
  assert.throws(() => db.exec('DELETE FROM print_attempts')); db.close();
});
test('version 16 tickets migrate without claiming confirmed output', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-print-upgrade-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
  db.exec("DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open'); INSERT INTO preparation_rounds (order_id,request_id,number,actor_id,sent_at) VALUES (1,'old',1,1,10); INSERT INTO preparation_tickets (round_id,destination,adapter) VALUES (1,'kitchen','simulated'); DROP TABLE print_attempts; DROP TABLE print_jobs; DROP TABLE simulated_printers; ALTER TABLE preparation_rounds DROP COLUMN table_id; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); PRAGMA user_version=16;");
  db.close(); db = openDatabase(dir);
  assert.deepEqual({ ...db.prepare('SELECT j.ticket_id, a.result, a.actor_id FROM print_jobs j JOIN print_attempts a ON a.job_id=j.id').get() }, { ticket_id: 1, result: 'uncertain', actor_id: null });
  assert.equal(db.prepare('SELECT count(*) n FROM preparation_tickets').get().n, 1); db.close();
});

test('direct requests require grants and retry rolls back if audit recording fails', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-print-access-'));
  const db = authorizedDatabase(openDatabase(dir)); t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open')");
  const event = {}; let orders, jobs, actor = 1; const session = { currentUserId: () => actor, authenticatedUserId: () => actor };
  registerOrderItems({ handle: (_, fn) => orders = fn }, e => e === event, db, session);
  registerPrintJobs({ handle: (_, fn) => jobs = fn }, e => e === event, db, session);
  const call = request => jobs(event, request);
  assert.equal(call({ action: 'simulate', destination: 'kitchen', result: 'failed' }).ok, true);
  assert.equal(orders(event, { action: 'add', orderId: 1, productId: 'qebapa' }).ok, true);
  assert.equal(orders(event, { action: 'send', orderId: 1, requestId: 'access' }).ok, true);
  const jobId = call({ action: 'list' }).data.jobs[0].id;
  actor = null;
  for (const request of [{ action: 'list' }, { action: 'simulate', destination: 'kitchen', result: 'success' }, { action: 'retry', jobId, requestId: 'access' }]) assert.equal(call(request).ok, false);
  actor = 1; db.prepare("DELETE FROM user_permissions WHERE user_id=1 AND permission='orders.change'").run();
  assert.equal(call({ action: 'list' }).ok, true);
  assert.equal(call({ action: 'retry', jobId, requestId: 'access' }).ok, false);
  assert.equal(call({ action: 'simulate', destination: 'kitchen', result: 'success' }).ok, false);
  db.prepare("INSERT INTO user_permissions VALUES (1,'orders.change')").run();
  for (const request of [{ action: 'retry', jobId: 0, requestId: 'x' }, { action: 'retry', jobId, requestId: '' }, { action: 'retry', jobId: 9999, requestId: 'x' }, { action: 'list', extra: true }]) assert.equal(call(request).ok, false);
  db.exec("CREATE TRIGGER test_reject_retry BEFORE INSERT ON application_audit WHEN NEW.action='print_retry' BEGIN SELECT RAISE(ABORT, 'test'); END");
  assert.equal(call({ action: 'retry', jobId, requestId: 'rollback' }).ok, false);
  assert.equal(db.prepare('SELECT count(*) n FROM print_attempts').get().n, 1);
  db.exec('DROP TRIGGER test_reject_retry');
  assert.equal(call({ action: 'retry', jobId, requestId: 'rollback' }).ok, true);
  assert.equal(db.prepare('SELECT count(*) n FROM print_attempts').get().n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM order_items').get().n, 1);
});

test('print jobs retain their send-time table through moves and retries', t => {
  const { registerMoveOrder } = require('../src/desktop/move-order');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-move-print-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db);
  db.exec("INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open')");
  let items,jobs,move; const session={currentUserId: () => 1, authenticatedUserId: () => 1}, ipc=fn=>({handle:(_,f)=>fn(f)});
  registerOrderItems(ipc(f=>items=f),()=>true,db,session); registerPrintJobs(ipc(f=>jobs=f),()=>true,db,session); registerMoveOrder(ipc(f=>move=f),()=>true,db,session);
  jobs({}, {action:'simulate',destination:'kitchen',result:'failed'}); items({}, {action:'add',orderId:1,productId:'qebapa'}); items({}, {action:'send',orderId:1,requestId:'before'});
  const before=jobs({}, {action:'list'}).data.jobs[0]; assert.equal(before.tableId,1);
  assert.equal(move({}, {orderId:1,sourceId:1,destinationId:2,requestId:'move'}).ok,true);
  assert.equal(jobs({}, {action:'list'}).data.jobs[0].tableId,1);
  assert.equal(jobs({}, {action:'retry',jobId:before.id,requestId:'retry'}).ok,true);
  const after=jobs({}, {action:'list'}).data.jobs[0]; assert.equal(after.tableId,1); assert.equal(after.id,before.id); assert.equal(after.attempts,2);
  items({}, {action:'add',orderId:1,productId:'espresso'}); items({}, {action:'send',orderId:1,requestId:'after'});
  assert.deepEqual(jobs({}, {action:'list'}).data.jobs.map(j=>j.tableId),[2,1]); db.close();
});

test('version 17 jobs retain table and history after migration', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-move-upgrade-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let db=authorizedDatabase(openDatabase(dir)); seedTables(db); seedMenu(db); db.exec("INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open')");
  let items; registerOrderItems({handle:(_,f)=>items=f},()=>true,db,{currentUserId: () => 1, authenticatedUserId: () => 1});
  items({}, {action:'add',orderId:1,productId:'qebapa'}); items({}, {action:'send',orderId:1,requestId:'legacy'});
  db.exec('DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; ALTER TABLE preparation_rounds DROP COLUMN table_id; DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); PRAGMA user_version=17'); db.close();
  db=openDatabase(dir); db.exec("INSERT INTO financial_scopes SELECT id, 'waiter' FROM local_users"); assert.equal(db.prepare('SELECT table_id FROM preparation_rounds').get().table_id,1);
  db.exec('UPDATE orders SET table_id=2 WHERE id=1');
  let jobs; registerPrintJobs({handle:(_,f)=>jobs=f},()=>true,db,{currentUserId: () => 1, authenticatedUserId: () => 1});
  assert.equal(jobs({}, {action:'list'}).data.jobs[0].tableId,1); assert.equal(db.prepare('SELECT count(*) n FROM print_attempts').get().n,1); db.close();
});

test('failed version 18 migration leaves version 17 data intact', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-move-upgrade-fail-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let db=authorizedDatabase(openDatabase(dir)); seedTables(db);
  db.exec("DROP TRIGGER IF EXISTS billed_item_insert; DROP TRIGGER IF EXISTS billed_item_update; DROP TRIGGER IF EXISTS billed_item_delete; DROP TRIGGER IF EXISTS billed_correction; DROP TRIGGER IF EXISTS billed_order_move; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS bill_lines; DROP TABLE IF EXISTS bills; INSERT INTO orders (table_id,opened_at,status) VALUES (1,1,'open'); INSERT INTO app_metadata(key,value) VALUES ('sample','kept'); DROP TABLE IF EXISTS sent_item_corrections; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE IF EXISTS financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); PRAGMA user_version=17"); db.close();
  assert.throws(()=>openDatabase(dir));
  const { DatabaseSync }=require('node:sqlite'); db=new DatabaseSync(path.join(dir,'arra.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,17); assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key='sample'").get().value,'kept'); assert.equal(db.prepare('SELECT table_id FROM orders').get().table_id,1);
  db.exec('ALTER TABLE preparation_rounds DROP COLUMN table_id'); db.close(); db=openDatabase(dir); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25); db.close();
});
