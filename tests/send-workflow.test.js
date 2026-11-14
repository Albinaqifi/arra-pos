const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const rendererBundle = require('./support/renderer-bundle');
const { arrange, routeOf } = require('./support/renderer-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const row = (status = 'sent') => ({ id: 1, productId: 'p', name: 'Dish', unitPrice: 10, quantity: 1, status, note: '', modifiers: [] });

function harness(api) {
  class Component {
    constructor(props) { this.props = props; }
    setState(update, callback) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); callback?.(); }
    forceUpdate() {}
  }
  let sequence = 0;
  const context = { React: { Component, createElement: (type, props, ...children) => ({ type, props, children }) }, window: { arra: api }, crypto: { randomUUID: () => 'send-' + ++sequence }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(rendererBundle(), context);
  const app = new context.RendererModules.WaiterDemo(); app.componentDidMount();
  arrange(app, { screen: 'order', waiter: { id: 1, name: 'First' }, tableId: 1, orders: { 1: { id: 5, log: [] } }, items: [{ id: 1, tableId: 1, status: 'pending', qty: 1, cxQty: 0, unit: 10, route: 'kitchen' }] });
  return { app, context };
}

test('send lock spans the item response, print lookup, waiter clearing and staff loading', async () => {
  const item = deferred(), print = deferred(), clear = deferred(), staff = deferred();
  let sends = 0, clears = 0, opens = 0;
  const { app } = harness({ orderItems: () => { sends++; return item.promise; }, printJobs: () => print.promise, clearWaiter: () => { clears++; return clear.promise; }, getWaiters: () => staff.promise, openOrder: () => { opens++; return { ok: false }; } });
  const sending = app.sendWorkflow.send();
  assert.equal(app.sendWorkflow.state.busy, true); assert.equal(app.tableOrders.writeBusy, true);
  await app.sendWorkflow.send(); await app.pending.incItem(1); app.tableOrders.showTables();
  assert.equal(sends, 1); assert.equal(routeOf(app), 'order');
  item.resolve({ ok: true, data: { items: [row()], testPrintEnabled: true } }); await tick();
  assert.equal(app.tableOrders.writeBusy, false); assert.equal(app.sendWorkflow.state.busy, true);
  await app.tableOrders.openTable(2); await app.session.switchWaiter();
  app.renderVals().openBill(); app.renderVals().openMoveTable(); app.correction.open(1); app.pending.openNote(1);
  assert.equal(opens, 0); assert.equal(clears, 0); assert.equal(app.state.modal, null); assert.equal(app.pending.state.dialog, null);
  print.resolve({ ok: true, data: { jobs: [] } }); await tick();
  assert.equal(clears, 1); assert.equal(app.sendWorkflow.state.busy, true); assert.equal(routeOf(app), 'waiters');
  await app.sendWorkflow.send(); clear.resolve({ ok: true }); await tick();
  assert.equal(app.sendWorkflow.state.busy, true); assert.equal(app.session.state.switching, true);
  await app.sendWorkflow.send(); staff.resolve({ ok: true, data: [] }); await sending;
  assert.equal(sends, 1); assert.equal(app.sendWorkflow.state.busy, false); assert.equal(app.session.state.switching, false);
  assert.match(app.session.state.handoffNotice, /Test print output is not confirmed/);
});

test('failed and thrown sends release the lease and retain one request until confirmed', async () => {
  const requests = []; let outcome = 'throw';
  const { app } = harness({
    orderItems: async (action, orderId, token) => { requests.push({ orderId, token }); if (outcome === 'throw') throw Error('lost response'); return outcome === 'fail' ? { ok: false } : { ok: true, data: { items: [row()] } }; },
    printJobs: async () => ({ ok: false }), clearWaiter: async () => ({ ok: true }), getWaiters: async () => ({ ok: true, data: [] }),
  });
  await app.sendWorkflow.send(); outcome = 'fail'; await app.sendWorkflow.send();
  assert.equal(app.tableOrders.writeBusy, false); assert.equal(app.sendWorkflow.state.busy, false); assert.match(app.state.toast.msg, /Could not save order items/);
  outcome = 'ok'; await app.sendWorkflow.send();
  assert.equal(requests.length, 3); assert.ok(requests.every(request => request.orderId === 5 && request.token === requests[0].token));
  assert.match(app.session.state.handoffNotice, /Print status unavailable/); assert.match(app.session.state.handoffNotice, /No physical ticket/);
  arrange(app, { screen: 'order', waiter: { name: 'Next' }, tableId: 2, orders: { 2: { id: 5, log: [] } } });
  await app.sendWorkflow.send(); assert.notEqual(requests[3].token, requests[0].token);
});

test('superseded or disposed sends do not publish old items, handoff or unlock a newer lease', async () => {
  for (const dispose of [false, true]) {
    const response = deferred(); let clears = 0;
    const { app } = harness({ orderItems: () => response.promise, clearWaiter: async () => { clears++; return { ok: true }; } });
    const sending = app.sendWorkflow.send();
    if (dispose) app.componentWillUnmount();
    else {
      app.clearDesktopData();
      arrange(app, { tableId: 2, orders: { 2: { id: 6, log: [] } }, items: [] });
      const newer = app.tableOrders.acquireWrite('newer');
      assert.ok(newer);
    }
    response.resolve({ ok: true, data: { items: [row()] } }); await sending;
    assert.equal(clears, 0); assert.equal(app.sendWorkflow.state.busy, false);
    if (!dispose) { assert.equal(app.tableOrders.state.items.length, 0); assert.equal(app.tableOrders.writeBusy, true); }
  }
});

test('a confirmed send does not become an item failure if the later handoff throws', async () => {
  const { app } = harness({ orderItems: async () => ({ ok: true, data: { items: [row()] } }), printJobs: async () => ({ ok: true, data: { jobs: [] } }) });
  app.session.completeHandoff = async () => { throw Error('handoff interrupted'); };
  await assert.rejects(app.sendWorkflow.send(), /handoff interrupted/);
  assert.equal(app.tableOrders.writeBusy, false); assert.equal(app.sendWorkflow.state.busy, false);
  assert.equal(app.tableOrders.state.items[0].status, 'sent'); assert.equal(app.state.toast, null);
});

test('an unresolved movement or correction blocks direct send after its write lease ends', async () => {
  let sends = 0;
  const { app } = harness({ orderItems: async () => { sends++; return { ok: false }; } });
  for (const type of ['moveTable', 'cancel']) {
    arrange(app, { modal: { type, unresolved: true } });
    assert.equal(app.tableOrders.writeBusy, false);
    await app.sendWorkflow.send();
    assert.equal(sends, 0); assert.equal(app.sendWorkflow.state.busy, false);
  }
  arrange(app, { modal: null }); await app.sendWorkflow.send(); assert.equal(sends, 1);
});

test('demo printing owns route jobs, immutable retry history, movement and retirement', () => {
  const { app } = harness(undefined), printing = app.demoPrinting;
  assert.equal(Object.hasOwn(app.state, 'jobs'), false); assert.equal(Object.hasOwn(app.state, 'printers'), false);
  printing.toggle('kitchen');
  const notice = printing.submitRound({ tableId: 1, round: 2, actor: 'First', items: [{ route: 'kitchen', qty: 2 }, { route: 'bar', qty: 1 }] });
  const original = printing.state.jobs;
  assert.match(notice, /Kitchen ticket did not print/);
  assert.equal(original[0].id, 'j114'); assert.equal(original[1].id, 'j115');
  assert.deepEqual(Array.from(original, job => job.count), [2, 1]);
  assert.equal(printing.failedView().hasFailed, true); printing.failedView().failed[0].retry();
  assert.equal(original[0].attempts, 1); assert.equal(printing.state.jobs[0].attempts, 2); assert.match(app.state.toast.msg, /still not responding/);
  printing.backup(original[0].id); assert.equal(printing.state.jobs[0].status, 'ok'); assert.equal(printing.state.jobs[0].attempts, 3);
  assert.equal(printing.failedView().hasFailed, false); assert.equal(app.tableOrders.state.orders[1].log.length, 3);
  printing.moveJobs(1, 2); assert.ok(printing.state.jobs.every(job => job.tableId === 2));
  printing.retireOrderJobs(1); assert.equal(printing.state.jobs.length, 2); printing.retireOrderJobs(2); assert.equal(printing.state.jobs.length, 0);
});

test('demo bill printing reads the forced card account from its printing owner', () => {
  const { app } = harness(undefined);
  app.demoPrinting.toggle('A'); app.state.modal = { type: 'bill', method: 'Card', account: 'B', printed: 0 };
  app.printBill(false); assert.equal(app.state.modal.account, 'A'); assert.equal(app.state.modal.step, 'failed'); assert.equal(app.state.modal.printed, 0);
  app.printBill(true); assert.equal(app.state.modal.printed, 1); assert.equal(app.state.modal.account, 'A');
});
