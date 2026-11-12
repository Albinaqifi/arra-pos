const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { openDatabase } = require('../src/desktop/database');
const { createSampleAccounts } = require('../src/desktop/sample-accounts');
const { createSession } = require('../src/desktop/session');
const { registerEmployeeConfig } = require('../src/desktop/employee-config');
const { registerTables } = require('../src/desktop/tables');
const { registerBills } = require('../src/desktop/bills');
const { registerPayments } = require('../src/desktop/payments');
const { registerOrderHistory } = require('../src/desktop/order-history');
const { registerOrderItems } = require('../src/desktop/order-items');

test('isolated sample setup creates separately authenticated roles, rejects repeated or failed setup atomically', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-scope-sample-')); const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  const values = ['sample-pass-1','sample-pass-2','sample-pass-3','sample-pass-4'];
  assert.throws(() => createSampleAccounts(db, [values[0],values[0],values[2],values[3]]));
  db.exec("CREATE TRIGGER reject_scope BEFORE INSERT ON financial_scopes WHEN NEW.scope='B' BEGIN SELECT RAISE(ABORT,'failure'); END");
  assert.throws(() => createSampleAccounts(db, values));
  assert.equal(db.prepare('SELECT count(*) n FROM local_users').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM financial_scopes').get().n, 0);
  db.exec('DROP TRIGGER reject_scope'); createSampleAccounts(db, values);
  assert.deepEqual(db.prepare('SELECT scope FROM financial_scopes ORDER BY user_id').all().map(x => x.scope), ['waiter','A','B','combined']);
  assert.throws(() => createSampleAccounts(db, values));
  const session = createSession(db);
  for (let i = 0; i < 4; i++) {
    const username = ['sample-waiter','sample-owner-a','sample-owner-b','sample-combined'][i];
    assert.equal(session.signIn({username, password: values[(i+1)%4]}).ok, false);
    assert.equal(session.signIn({username, password: values[i]}).ok, true);
    session.signOut();
  }
});

test('owner cannot turn shared services or employee management into cross-account access', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-scope-guards-')); const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  createSampleAccounts(db, ['sample-pass-1','sample-pass-2','sample-pass-3','sample-pass-4']);
  // Test even an owner assigned all ordinary actions: scope still denies shared data.
  for (const permission of ['employees.change','tables.view','orders.view','orders.change']) db.prepare('INSERT OR IGNORE INTO user_permissions VALUES (2,?)').run(permission);
  let current=2, authenticated=2; const session={currentUserId:()=>current, authenticatedUserId:()=>authenticated};
  const handlers={}; const ipc={handle:(name,fn)=>handlers[name]=fn};
  for (const register of [registerEmployeeConfig,registerTables,registerBills,registerPayments,registerOrderHistory,registerOrderItems]) register(ipc,()=>true,db,session);
  const call=(channel,request)=>handlers['arra:'+channel]({},request);
  const denied = [ ['tables',{}], ['bill',{action:'review',orderId:1}], ['payment',{billId:1,method:'cash',account:'B'}], ['order-history',{orderId:null}], ['order-history',{orderId:1}], ['order-items',{action:'list',orderId:1}] ];
  for (const [channel,request] of denied) assert.equal(call(channel,request).ok,false,channel);
  assert.equal(call('employee-config',{action:'create',username:'new',password:'sample-pass-5',pin:''}).ok,false);
  assert.equal(call('employee-config',{action:'credential',id:1,password:'sample-pass-5',pin:null}).ok,false);
  assert.equal(call('employee-config',{action:'credential',id:3,password:'sample-pass-5',pin:null}).ok,false);
  current=1; for(const [channel,request] of denied) assert.equal(call(channel,request).ok,false,channel);
  authenticated=1; current=2; for(const [channel,request] of denied) assert.equal(call(channel,request).ok,false,channel);
});

test('sample launch chooses the isolated path and rejects invalid flags without falling back', t => {
  const { dataDirectory } = require('../src/desktop/sample-data-directory');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-scope-launch-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  assert.equal(dataDirectory([], 'normal'), 'normal');
  assert.throws(() => dataDirectory(['--sample-data-directory='], 'normal'));
  assert.throws(() => dataDirectory(['--sample-data-directory=relative'], 'normal'));
  assert.throws(() => dataDirectory([`--sample-data-directory=${dir}`], 'normal'));
  fs.writeFileSync(path.join(dir, 'SAMPLE-DATA-ONLY'), 'sample');
  assert.equal(dataDirectory([`--sample-data-directory=${dir}`], 'normal'), dir);
  assert.throws(() => dataDirectory([`--sample-data-directory=${dir}`, `--sample-data-directory=${dir}`], 'normal'));
});

test('sample recovery snapshots populated old database, authenticates and preserves original', async t => {
  const { bootstrap } = require('../src/desktop/session');
  const { recoverSample } = require('../src/desktop/sample-recovery');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-old-sample-')); let copied;
  t.after(()=>{ if(copied) fs.rmSync(copied,{recursive:true,force:true}); fs.rmSync(dir,{recursive:true,force:true}); });
  let db=openDatabase(dir); bootstrap(db,'sample-legacy','sample-legacy-password');
  db.exec("INSERT INTO dining_tables(id,area) VALUES(1,'sample'); INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TRIGGER IF EXISTS payment_assign_business_day; DROP TABLE IF EXISTS payment_account_corrections; DROP TABLE IF EXISTS transfer_managers; DROP TABLE IF EXISTS payment_business_days; DROP TABLE IF EXISTS business_days; DROP TABLE financial_scopes; DROP INDEX one_open_order_per_table; ALTER TABLE orders DROP COLUMN retired_empty; CREATE UNIQUE INDEX one_open_order_per_table ON orders(table_id) WHERE status=char(111,112,101,110); DROP TABLE IF EXISTS test_print_results; DROP TABLE IF EXISTS test_print_attempts; DROP TABLE IF EXISTS test_print_jobs; DROP TABLE IF EXISTS test_printer_queues; DROP TABLE IF EXISTS day_print_settings; DROP TABLE IF EXISTS day_print_results; DROP TABLE IF EXISTS day_print_attempts; DROP TABLE IF EXISTS day_print_jobs; PRAGMA user_version=21;"); db.close();
  const source=path.join(dir,'arra.sqlite'), original=fs.readFileSync(source);
  await assert.rejects(recoverSample(source,'sample-legacy','wrong-sample-password'));
  assert.deepEqual(fs.readFileSync(source),original);
  copied=await recoverSample(source,'sample-legacy','sample-legacy-password');
  assert.notEqual(copied,dir); assert.deepEqual(fs.readFileSync(source),original);
  db=openDatabase(copied);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 27);
  assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1);
  assert.equal(db.prepare('SELECT scope FROM financial_scopes WHERE user_id=1').get().scope,'waiter');
  assert.equal(db.prepare("SELECT count(*) n FROM application_audit WHERE action='sample_waiter_setup'").get().n,1);
  db.close();
  db=new (require('node:sqlite').DatabaseSync)(source,{readOnly:true});
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,21); assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1); db.close();
});

test('sample recovery scope assignment fails atomically and never reclassifies owners', t => {
  const { bootstrap } = require('../src/desktop/session');
  const { provisionSampleWaiter } = require('../src/desktop/sample-recovery');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arra-sample-fail-')), db=openDatabase(dir);
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
  bootstrap(db,'sample-user','sample-password'); db.exec('DELETE FROM financial_scopes');
  db.exec("CREATE TRIGGER reject_setup BEFORE INSERT ON application_audit WHEN NEW.action='sample_waiter_setup' BEGIN SELECT RAISE(ABORT,'fail'); END");
  assert.throws(()=>provisionSampleWaiter(db,'sample-user','sample-password'));
  assert.equal(db.prepare('SELECT count(*) n FROM financial_scopes').get().n,0);
  db.exec('DROP TRIGGER reject_setup'); db.exec("INSERT INTO financial_scopes VALUES(1,'A')");
  assert.throws(()=>provisionSampleWaiter(db,'sample-user','sample-password'));
  assert.equal(db.prepare('SELECT scope FROM financial_scopes').get().scope,'A');
});
