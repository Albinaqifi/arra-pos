const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openDatabase} = require('../src/desktop/database');
const {authorizedDatabase} = require('./support/authorized-database');
const {seedTables} = require('../src/desktop/tables');
const {seedMenu} = require('../src/desktop/menu');
const {registerOrderItems} = require('../src/desktop/order-items');
const printing = require('../src/desktop/test-printing');
const {textForJob} = require('../src/desktop/windows-test-printer');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s107-recovery-'));
  const db = authorizedDatabase(openDatabase(dir));
  t.after(() => { db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
  seedTables(db); seedMenu(db);
  db.exec("UPDATE menu_products SET destination='bar' WHERE id='espresso'; INSERT INTO orders(id,table_id,opened_at,status) VALUES(1,1,1,'open'); INSERT INTO order_waiter_ownership VALUES(1,1,1,1,'open')");
  return db;
}
const session = {currentUserId:()=>1, authenticatedUserId:()=>1};
const handle = callback => ({handle:(_, fn)=>callback(fn)});

test('a persisted pre-S-107 preparation snapshot can still be retried', async t => {
  const db = setup(t); let orders, jobs; const outputs = [];
  // Create the historical snapshot shape through the original send transaction.
  const legacyPrinting = {...printing, adapter: async a => {outputs.push(a); return 'failed';},
    createPreparationJob(db, ticketId, mode) {
      const ticket = db.prepare('SELECT t.destination, r.table_id AS tableId, r.number AS round FROM preparation_tickets t JOIN preparation_rounds r ON r.id=t.round_id WHERE t.id=?').get(ticketId);
      const lines = db.prepare('SELECT i.id, i.name, i.note, ti.quantity FROM preparation_ticket_items ti JOIN order_items i ON i.id=ti.item_id WHERE ti.ticket_id=? ORDER BY i.id').all(ticketId);
      for (const line of lines) line.modifiers = [];
      return db.prepare('INSERT INTO test_print_jobs(destination,ticket_id,snapshot,created_at) VALUES(?,?,?,?)').run(ticket.destination,ticketId,JSON.stringify({...ticket,lines,preparationMode:mode}),Date.now()).lastInsertRowid;
    }};
  registerOrderItems(handle(fn=>orders=fn),()=>true,db,session,legacyPrinting);
  printing.registerTestPrinting(handle(fn=>jobs=fn),()=>true,db,session,legacyPrinting.adapter,true);
  assert.equal(orders({}, {action:'add',orderId:1,productId:'qebapa'}).ok,true);
  assert.equal(orders({}, {action:'send',orderId:1,requestId:'legacy-send'}).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  const original = db.prepare('SELECT snapshot FROM test_print_jobs WHERE id=1').get().snapshot;
  assert.equal(jobs({}, {action:'retry',jobId:1,requestId:'legacy-retry',checked:true}).ok,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(outputs.length,2);
  assert.deepEqual(outputs[1].snapshot,JSON.parse(original));
  assert.match(textForJob(outputs[1]), /1 x Qebapa/);
  assert.doesNotMatch(textForJob(outputs[1]), /\n(?:Time|Waiter):/);
});

test('failure creating a later station snapshot rolls back the entire send', async t => {
  const db = setup(t); let orders, dispatches=0, creates=0;
  const failing = {...printing, adapter:async()=>{dispatches++; return 'accepted';},
    createPreparationJob(...args) {
      if (++creates === 2) throw Error('sample snapshot failure');
      return printing.createPreparationJob(...args);
    }};
  registerOrderItems(handle(fn=>orders=fn),()=>true,db,session,failing);
  assert.equal(orders({}, {action:'add',orderId:1,productId:'qebapa'}).ok,true);
  assert.equal(orders({}, {action:'add',orderId:1,productId:'espresso'}).ok,true);
  assert.equal(orders({}, {action:'send',orderId:1,requestId:'failed-send'}).ok,false);
  await new Promise(resolve=>setImmediate(resolve));
  for (const table of ['preparation_rounds','preparation_tickets','test_print_jobs','test_print_attempts'])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM order_items WHERE status='pending'").get().n,2);
  assert.equal(dispatches,0);
});
