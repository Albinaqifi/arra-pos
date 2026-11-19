const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../src/desktop/database');
const { seedMenu } = require('../src/desktop/menu');
const { seedTables } = require('../src/desktop/tables');
const { authorizedDatabase } = require('./support/authorized-database');

const tick = () => new Promise(resolve => setImmediate(resolve));
const count = (db, table) => db.prepare('SELECT count(*) AS n FROM ' + table).get().n;

// Run the normal main-process startup and IPC registrations. Substitute only
// the window, sample identity and hardware boundaries. No printer or network.
async function fixture(t, mode) {
  let actor = 1;
  const session = {currentUserId:() => actor, authenticatedUserId:() => actor};
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-s098-'));
  const db = authorizedDatabase(openDatabase(directory));
  seedTables(db);
  seedMenu(db);
  db.exec(`INSERT INTO user_permissions VALUES(1,'employees.change'),(1,'employees.view');
    UPDATE menu_products SET destination='bar' WHERE id IN ('cola','espresso');
    INSERT INTO menu_product_fiscal_origin SELECT id,1 FROM menu_products`);
  fs.writeFileSync(path.join(directory,'SAMPLE-DATA-ONLY'), 'Synthetic test data');
  const output = [], hardwareCalls = [];
  let handlers, close, source;
  async function launch(selected) {
    handlers = new Map();
    const app = {
      whenReady:() => Promise.resolve(), getPath:() => directory, quit:assert.fail,
      on(name, fn) { if (name === 'will-quit') close = fn; },
    };
    class BrowserWindow {
      constructor() { source = this.webContents = {mainFrame:{}, setWindowOpenHandler(){}, on(){}}; }
      on() {} loadFile() {}
    }
    const electron = {app, BrowserWindow, dialog:{showErrorBox:assert.fail},
      ipcMain:{handle:(channel, fn) => handlers.set(channel, fn)}};
    const main = require.resolve('../src/desktop/main');
    const localRequire = createRequire(main);
    const physical = ['routine','supervised'].includes(selected);
    const args = physical ? ['--pf700-' + selected + '-checkout'] : ['--sample-data-directory=' + directory];
    if (selected === 'training') args.push('--pf700-offline-checkout');
    function load(name) {
      if (name === 'electron') return electron;
      if (name === './session') return {registerSession:() => session};
      if (name === './windows-test-printer') return {printTestJob(job) {output.push(job); return 'accepted';}};
      // The real commissioning launcher and its credentials are outside this
      // rehearsal. Only the approved production-mode selection is substituted.
      if (physical && name === './pf700-checkout-mode') return {selectPf700Checkout:() => ({
        mode:'device', deviceId:'SYNTHETIC01', domesticProduct:true,
        registerSale() {hardwareCalls.push('fiscal'); throw Error('Unexpected device dispatch');},
      })};
      return localRequire(name);
    }
    vm.runInNewContext(fs.readFileSync(main,'utf8'), {
      require:load, __dirname:path.dirname(main), process:{platform:'win32',argv:args},
    });
    await tick();
    assert.ok(handlers.has('arra:payment'));
  }
  t.after(() => {close?.(); db.close(); fs.rmSync(directory,{recursive:true,force:true});});
  await launch(mode);
  const call = (channel, req) => handlers.get('arra:' + channel)({sender:source, senderFrame:source.mainFrame}, req);
  const ok = (channel, req) => {
    const reply = call(channel,req);
    assert.equal(reply.ok,true,channel + ' ' + JSON.stringify(req));
    return reply.data;
  };
  const items = req => ok('order-items',{orderId:1,...req});
  const status = () => ok('test-printing',{action:'list'});
  const simulate = (destination, result) => ok('print-jobs',{action:'simulate',destination,result});
  const retry = (action, jobId, requestId) => ok('test-printing',{action,jobId,requestId,checked:true});
  async function restart(selected = mode) {close(); close = null; await launch(selected);}
  ok('open-order',{tableId:1});
  return {db,directory,output,hardwareCalls,call,ok,items,status,simulate,retry,restart, as(id) {actor = id;}};
}

test('offline mixed rounds, cancellation and paper retries stay independent of the same bill’s PF700 recovery', async t => {
  const f = await fixture(t,'training');
  const {db,items,ok,call,status,simulate,retry} = f;
  const snapshots = () => db.prepare('SELECT snapshot FROM test_print_jobs WHERE ticket_id IS NOT NULL ORDER BY id')
    .all().map(row => JSON.parse(row.snapshot));
  const preparationAttempts = () => [count(db,'test_print_attempts'),count(db,'cancellation_notice_attempts')];
  const deviceFile = path.join(f.directory,'simulated-pf700.sqlite');

  assert.deepEqual(status().queues.map(q => q.queue),['bar','kitchen','kitchen2']);
  simulate('bar','failed');
  const food = items({action:'add',productId:'qebapa'}).items[0];
  items({action:'increment',itemId:food.id});
  items({action:'add',productId:'espresso'});
  const send = {action:'send',requestId:'mixed-round'};
  assert.equal(items(send).preparationMode,'training');
  items(send);
  await tick();
  const first = status().jobs;
  assert.deepEqual(first.map(j => [j.queue,j.round,j.result,j.attempts]),
    [['bar',1,'failed',1],['kitchen',1,'accepted',1]]);
  simulate('bar','uncertain');
  items({action:'add',productId:'cola'});
  items({action:'send',requestId:'later-round'});
  // A correction must follow the already sent ticket after the menu changes.
  db.prepare("UPDATE menu_products SET destination='bar' WHERE id=?").run('qebapa');
  simulate('kitchen','uncertain');
  const correction = {action:'correct',itemId:food.id,quantity:1,reason:'Sample change',requestId:'cancel-one'};
  items(correction);
  items(correction);
  await tick();
  assert.deepEqual(snapshots().map(j => [j.tableId,j.round,j.destination,j.lines.map(l => [l.name,l.quantity])]),[
    [1,1,'kitchen',[['Qebapa',2]]], [1,1,'bar',[['Espresso',1]]], [1,2,'bar',[['Coca-Cola',1]]],
  ]);
  const jobs = status().jobs, notice = status().notices[0];
  assert.equal(jobs[0].result,'uncertain');
  assert.deepEqual([notice.destination,notice.queue,notice.round,notice.lines[0].quantity,notice.result],
    ['kitchen','kitchen',1,1,'uncertain']);
  assert.deepEqual(preparationAttempts(),[3,1]);
  assert.equal(count(db,'print_jobs'),0);
  assert.equal(count(db,'fiscal_checkout_sales'),0);
  assert.equal(count(db,'payments'),0);
  assert.equal(fs.existsSync(deviceFile),false);

  const reviewed = ok('bill',{action:'review',orderId:1});
  const bill = ok('bill',{action:'generate',orderId:1,fingerprint:reviewed.fingerprint});
  assert.equal(bill.total,390);
  const pay = {billId:bill.id,method:'cash',account:'A'};
  const intent = ok('payment',{...pay,prepareSimulatedCash:'after_close'});
  assert.equal((await call('payment',{...pay,simulateInterrupt:'after_close',intentId:intent.intentId})).fiscalStatus,'uncertain');
  assert.equal(count(db,'payments'),0);
  await f.restart();
  assert.deepEqual(ok('payment',{...pay,checkSimulated:true}),{stage:'closed'});
  const recorded = ok('payment',{...pay,finishSimulated:true});
  assert.deepEqual(ok('payment',pay),recorded);
  assert.deepEqual([recorded.fiscal.receipt.total,recorded.fiscal.reference],[390,'SIM-' + bill.id]);
  assert.deepEqual(preparationAttempts(),[3,1]);

  const billJob = db.prepare('SELECT id FROM test_print_jobs WHERE bill_id=?').get(bill.id);
  assert.equal(call('test-printing',{action:'bill',billId:bill.id,requestId:'no-copy'}).ok,false);
  assert.equal(call('test-printing',{action:'retry',jobId:billJob.id,checked:true,requestId:'no-bill-retry'}).ok,false);
  assert.equal(call('test-printing',{action:'retry',jobId:jobs[0].id,checked:false,requestId:'no-paper-check'}).ok,false);
  assert.equal(call('test-printing',{action:'retry',jobId:first[1].id,checked:true,requestId:'cancelled-ticket'}).ok,false);
  assert.equal(call('print-jobs',{action:'retry',jobId:jobs[0].id,requestId:'wrong-ledger'}).ok,false);
  simulate('bar','success');
  simulate('kitchen','success');
  for (const job of jobs.filter(j => j.destination === 'bar')) {
    retry('retry',job.id,'paper-' + job.id);
    await tick();
    retry('retry',job.id,'paper-' + job.id);
  }
  retry('retryNotice',notice.id,'notice-paper');
  await tick();
  retry('retryNotice',notice.id,'notice-paper');
  assert.deepEqual(status().jobs.map(j => [j.queue,j.result,j.attempts]), [
    ['bar','accepted',2],['bar','accepted',2],['kitchen','accepted',1],
  ]);
  assert.equal(status().notices[0].result,'accepted');
  assert.deepEqual(preparationAttempts(),[5,2]);
  const events = ok('order-history',{orderId:1}).events;
  const history = events.filter(e => ['print_attempt','cancellation_print_attempt'].includes(e.action));
  assert.equal(history.length,7);
  assert.ok(history.every(e => e.adapter === 'simulated'));
  assert.deepEqual(history.filter(e => e.action === 'cancellation_print_attempt').map(e => e.result),['uncertain','accepted']);
  assert.deepEqual(history.filter(e => e.destination === 'bar').map(e => e.result),['failed','uncertain','accepted','accepted']);
  assert.deepEqual({...db.prepare('SELECT amount,method,account FROM payments').get()}, {amount:390,method:'cash',account:'A'});
  assert.equal(count(db,'payments'),1);
  assert.equal(count(db,'fiscal_checkout_attempts'),1);
  const device = new DatabaseSync(deviceFile,{readOnly:true});
  try {
    assert.deepEqual(device.prepare('SELECT bill,cash,card FROM documents WHERE bill IS NOT NULL').all().map(r => ({...r})),
      [{bill:bill.id,cash:390,card:0}]);
    assert.equal(device.prepare('SELECT tenders FROM cash_recovery_evidence').get().tenders,1);
  } finally {device.close();}
  assert.deepEqual(f.output,[]);
  // Reopening the same sample directory with Windows test printing must
  // never turn a historical simulated ticket/notice retry into real paper.
  await f.restart('sample');
  assert.equal(call('test-printing',{action:'retry',jobId:jobs[0].id,checked:true,requestId:'cross-mode'}).ok,false);
  assert.equal(call('test-printing',{action:'retryNotice',jobId:notice.id,checked:true,requestId:'cross-notice'}).ok,false);
  await tick();
  assert.deepEqual(f.output,[]);
});

test('routine startup routes Windows preparation only; supervised commissioning keeps it disabled', async t => {
  const f = await fixture(t,'routine');
  const {db,items,ok,status,call} = f;
  assert.equal(status().preparationMode,'routine');
  assert.deepEqual(status().queues.map(q => q.destination),['bar','kitchen','kitchen2']);
  for (const destination of ['bar','kitchen2']) {
    ok('test-printing',{action:'configure',destination,queue:'Local ' + destination});
  }
  assert.equal(call('test-printing',{action:'configure',destination:'bill-A',queue:'Wrong output'}).ok,false);
  assert.equal(call('print-jobs',{action:'simulate',destination:'bar',result:'uncertain'}).ok,false);
  db.exec("UPDATE menu_products SET destination='kitchen2' WHERE id='qebapa'");
  items({action:'add',productId:'qebapa'});
  items({action:'add',productId:'espresso'});
  items({action:'send',requestId:'two-stations'});
  await tick();
  assert.deepEqual(f.output.map(j => [j.queue,j.snapshot.lines[0].name]), [
    ['Local kitchen2','Qebapa'],['Local bar','Espresso'],
  ]);
  const {textForJob} = require('../src/desktop/windows-test-printer');
  assert.match(textForJob(f.output[0]),/^KITCHEN 2 TICKET/);
  assert.deepEqual(status().jobs.map(j => j.result),['accepted','accepted']);
  const history = ok('order-history',{orderId:1}).events.filter(e => e.action === 'print_attempt');
  assert.equal(history.length,2);
  assert.ok(history.every(e => e.adapter === 'windows' && e.result === 'accepted'));
  assert.deepEqual(f.hardwareCalls,[]);
  assert.equal(count(db,'fiscal_checkout_sales'),0);
  await f.restart('supervised');
  items({action:'add',productId:'cola'});
  items({action:'send',requestId:'trial-only'});
  assert.equal(call('test-printing',{action:'list'}).disabled,true);
  assert.equal(call('test-printing',{action:'retry',jobId:1,checked:true,requestId:'no-trial-retry'}).ok,false);
  await tick();
  assert.equal(f.output.length,2);
  assert.deepEqual(f.hardwareCalls,[]);
});

for (const [sent, reopened] of [['sample','training'],['training','sample']]) {
  test(`waiter and admin cancellations of a ${sent} ticket are deferred in ${reopened}`, async t => {
    const f = await fixture(t,sent);
    const {db,items,call,status,retry} = f;
    db.exec(`INSERT INTO local_users(id,username,salt,password_hash)
        SELECT 2,'combined-fixture',salt,password_hash FROM local_users WHERE id=1;
      INSERT INTO financial_scopes VALUES(2,'combined');
      INSERT INTO user_permissions VALUES(2,'orders.correct_sent')`);
    const itemId = items({action:'add',productId:'espresso'}).items[0].id;
    items({action:'increment',itemId});
    items({action:'send',requestId:'original-round'});
    await tick();
    const originalOutputs = f.output.length;
    await f.restart(reopened);
    db.exec("UPDATE menu_products SET destination='kitchen' WHERE id='espresso'");
    for (const [channel,actor] of [['order-items',1],['admin-sent-correction',2]]) {
      f.as(actor);
      const request = {action:'correct',orderId:1,itemId,quantity:1,reason:'Sample cancellation',requestId:'correction-' + actor};
      const response = call(channel,request);
      assert.equal(response.ok,true);
      assert.deepEqual(call(channel,request),response);
      if (actor === 1) assert.equal(response.data.noticeDeferred,true);
      else assert.equal(response.testPrintEnabled,false);
    }
    f.as(1);
    await tick();
    assert.equal(count(db,'sent_item_corrections'),2);
    assert.equal(count(db,'cancellation_notice_jobs'),2);
    assert.equal(count(db,'cancellation_notice_attempts'),0);
    assert.equal(status().notices.length,0);
    for (const {id} of db.prepare('SELECT id FROM cancellation_notice_jobs').all()) {
      assert.equal(call('test-printing',{action:'retryNotice',jobId:id,checked:true,requestId:'wrong-' + id}).ok,false);
    }
    assert.equal(f.output.length,originalOutputs);
    await f.restart(sent);
    const notices = status().notices;
    assert.deepEqual(notices.map(n => [n.destination,n.result,n.attempts]),[
      ['bar','unattempted',0],['bar','unattempted',0],
    ]);
    for (const {id} of notices) retry('retryNotice',id,'resume-' + id);
    await tick();
    assert.ok(status().notices.every(n => n.result === 'accepted' && n.attempts === 1));
    assert.equal(f.output.length,originalOutputs + (sent === 'sample' ? 2 : 0));
    const events = f.ok('order-history',{orderId:1}).events.filter(e => e.action === 'cancellation_print_attempt');
    assert.equal(events.length,2);
    assert.ok(events.every(e => e.destination === 'bar' && e.adapter === (sent === 'sample' ? 'windows' : 'simulated')));
    assert.equal(count(db,'payments'),0);
    assert.equal(count(db,'fiscal_checkout_sales'),0);
  });
}

test('a legacy Windows cancellation attempt against a simulator-only ticket stays on hold', async t => {
  const f = await fixture(t,'supervised');
  const {items,db,status,call} = f;
  const itemId = items({action:'add',productId:'cola'}).items[0].id;
  items({action:'send',requestId:'legacy-simulated-round'});
  const correction = db.prepare(`INSERT INTO sent_item_corrections(request_id,item_id,order_id,actor_id,quantity,reason,occurred_at)
    VALUES('old-cancel',?,1,1,1,'Training fixture',1)`).run(itemId).lastInsertRowid;
  const snap = {tableId:1,round:1,lines:[{name:'Coca-Cola',quantity:1,modifiers:[]}],cancellation:true};
  const notice = db.prepare(`INSERT INTO cancellation_notice_jobs(correction_id,destination,snapshot,created_at)
    VALUES(?,'bar',?,1)`).run(correction,JSON.stringify(snap)).lastInsertRowid;
  db.prepare(`INSERT INTO cancellation_notice_attempts(job_id,request_id,actor_id,queue,beep,started_at)
    VALUES(?,'retry-old',1,'Previously selected Windows bar',0,1)`).run(notice);
  for (const selected of ['training','sample']) {
    await f.restart(selected);
    const saved = status().notices[0];
    assert.deepEqual([saved.id,saved.retryBlocked,saved.result,saved.attempts],[notice,true,'uncertain',1]);
    assert.equal(call('test-printing',{action:'retryNotice',jobId:notice,requestId:'no-dispatch',checked:true}).ok,false);
    await tick();
  }
  assert.equal(count(db,'cancellation_notice_attempts'),1);
  assert.deepEqual(f.output,[]);
});

test('a cancellation saved without its preparation adapter stays deferred on replay until attempted', async t => {
  const f = await fixture(t,'routine');
  const itemId = f.items({action:'add',productId:'espresso'}).items[0].id;
  f.items({action:'send',requestId:'start-in-routine'});
  await tick();
  await f.restart('supervised');
  const correction = {action:'correct',itemId,quantity:1,reason:'Sample change',requestId:'save-without-adapter'};
  assert.equal(f.items(correction).noticeDeferred,true);
  assert.equal(f.items(correction).noticeDeferred,true);
  await f.restart('routine');
  assert.equal(f.items(correction).noticeDeferred,true);
  const notice = f.status().notices[0];
  assert.equal(notice.attempts,0);
  f.retry('retryNotice',notice.id,'manual-after-check');
  await tick();
  assert.equal(f.items(correction).noticeDeferred,undefined);
  assert.equal(f.status().notices[0].attempts,1);
  assert.equal(f.output.length,2);
});
