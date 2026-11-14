const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const rendererBundle = require('./support/renderer-bundle');
const { arrange, routeOf } = require('./support/renderer-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const data = { id: 7, total: 100, lines: [], fingerprint: 'reviewed-items' };

function harness(api, batched = false) {
  class Component {
    constructor(props) { this.props = props; this.queue = []; }
    setState(update, callback) {
      const apply = () => { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); callback?.(); };
      if (batched) this.queue.push(apply); else apply();
    }
    flush() { while (this.queue.length) this.queue.shift()(); }
    forceUpdate() {}
  }
  let sequence = 0;
  const context = { React: { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) }, window: { arra: api }, document: { addEventListener() {}, removeEventListener() {} }, crypto: { randomUUID: () => 'bill-print-' + ++sequence }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(rendererBundle(), context);
  const app = new context.RendererModules.WaiterDemo(); app._mounted = true;
  arrange(app, { screen: 'order', waiter: { id: 1, name: 'First' }, tableId: 1, orders: { 1: { id: 5, rounds: 1, log: [] } }, items: [{ id: 1, tableId: 1, name: 'Dish', status: 'sent', qty: 2, cxQty: 1, cx: [], unit: 100, route: 'kitchen', mods: '', round: 1 }] });
  function bill() { app.billing.open(); const element = app.billing.render(); const owner = new element.type(element.props); owner.state.data = { ...data }; owner.state.loading = false; return owner; }
  return { app, context, bill };
}

test('batched React state cannot duplicate payment, alter its in-flight selection or repeat confirmed handoff', async () => {
  const response = deferred(), handoff = deferred(), calls = []; let paid = 0;
  const { context } = harness({ payment: request => { calls.push(request); return response.promise; } }, true);
  const bill = new context.RendererModules.DesktopBill({ orderId: 5, onPaid: () => { paid++; return handoff.promise; } });
  Object.assign(bill.state, { data, method: 'cash', account: 'B', loading: false });
  const paying = bill.pay(); bill.pay(); bill.selectMethod('card'); bill.selectAccount('A'); bill.close();
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'cash'); assert.equal(calls[0].account, 'B');
  response.resolve({ ok: true }); await tick(); bill.pay();
  assert.equal(paid, 1); assert.equal(calls.length, 1);
  handoff.resolve(); await paying; bill.flush(); await bill.pay(); assert.equal(calls.length, 1);
});

test('unknown then definite failure freezes the payment payload and blocks all selection and navigation commands', async () => {
  const calls = [], outcomes = [new Error('reply lost'), { ok: false }, { ok: true }]; let paid = 0, closed = 0;
  const { context } = harness({ payment: async request => { calls.push(request); const outcome = outcomes.shift(); if (outcome instanceof Error) throw outcome; return outcome; } });
  const bill = new context.RendererModules.DesktopBill({ orderId: 5, onPaid: () => paid++, onClose: () => closed++ });
  Object.assign(bill.state, { data, method: 'card', account: 'B', loading: false });
  await bill.pay(); assert.equal(bill.state.uncertain, true); assert.equal(calls[0].account, 'A');
  bill.selectMethod('cash'); bill.selectAccount('B'); bill.close(); await bill.review(); await bill.generate();
  assert.equal(closed, 0); assert.equal(calls.length, 1);
  // Even a stale render's selection cannot change the saved uncertain request.
  Object.assign(bill.state, { method: 'cash', account: 'B' });
  await bill.pay(); assert.equal(bill.state.uncertain, true); await bill.pay();
  assert.equal(paid, 1); assert.ok(calls.every(request => request === calls[0]));
});

test('payment holds the shared lease then a continuous navigation lock through clear and waiter loading', async () => {
  const response = deferred(), clear = deferred(), staff = deferred(); let sends = 0, payments = 0, clears = 0;
  const { app, bill: createBill } = harness({ payment: () => { payments++; return response.promise; }, orderItems: async () => { sends++; return { ok: false }; }, clearWaiter: () => { clears++; return clear.promise; }, getWaiters: () => staff.promise });
  const bill = createBill(); Object.assign(bill.state, { method: 'card', account: 'A' });
  const paying = bill.pay(); assert.equal(app.tableOrders.writeBusy, true); assert.equal(app.billing.locked, true);
  await app.sendWorkflow.send(); await app.session.switchWaiter(); app.tableOrders.showTables(); app.moveWorkflow.open(); app.correction.open(1); app.pending.openNote(1);
  assert.equal(sends, 0); assert.equal(clears, 0); assert.equal(routeOf(app), 'order');
  assert.equal(app.moveWorkflow.state.dialog, null); assert.equal(app.correction.state.dialog, null); assert.equal(app.pending.state.dialog, null);
  const observed = []; const unsubscribe = app.billing.subscribe(() => observed.push(app.billing.locked));
  response.resolve({ ok: true }); await tick();
  assert.equal(payments, 1); assert.equal(clears, 1); assert.equal(app.tableOrders.writeBusy, false); assert.equal(app.billing.locked, true);
  assert.ok(observed.every(Boolean), 'there is no unlocked publication between payment and handoff');
  await bill.pay(); assert.equal(payments, 1); clear.resolve({ ok: true }); await tick();
  assert.equal(app.billing.locked, true); assert.equal(app.session.state.switching, true);
  staff.resolve({ ok: true, data: [] }); await paying;
  assert.equal(app.billing.locked, false); assert.equal(routeOf(app), 'waiters'); unsubscribe();
});

test('uncertain desktop payment retains the boundary lock after the service lease releases', async () => {
  const { app, bill: createBill } = harness({ payment: async () => ({ ok: false, uncertain: true }) });
  const bill = createBill(); Object.assign(bill.state, { method: 'cash', account: 'B' });
  await bill.pay(); assert.equal(app.tableOrders.writeBusy, false); assert.equal(app.billing.locked, true);
  assert.equal(app.billing.dismiss(), false); app.tableOrders.showHistory(); await app.session.switchWaiter();
  assert.equal(routeOf(app), 'order'); assert.ok(app.billing.state.desktop);
});

test('late bill review and payment completions cannot publish or hand off after unmount or identity reset', async () => {
  for (const action of ['review', 'pay']) {
    for (const unmount of [false, true]) {
      const response = deferred(); let clears = 0;
      const { app, bill: createBill } = harness({ bill: () => response.promise, payment: () => response.promise, clearWaiter: async () => { clears++; return { ok: true }; } });
      const bill = createBill(); Object.assign(bill.state, { method: 'cash', account: 'B' });
      const pending = bill[action](), before = JSON.stringify(bill.state);
      if (unmount) bill.componentWillUnmount(); else app.clearDesktopData();
      response.resolve(action === 'review' ? { ok: true, data: { ...data, total: 999 } } : { ok: true }); await pending;
      assert.equal(JSON.stringify(bill.state), before); assert.equal(clears, 0); assert.equal(app.tableOrders.writeBusy, false);
    }
  }
});

test('review and generation have one synchronous request gate and retain the reviewed fingerprint', async () => {
  const review = deferred(), generation = deferred(), requests = [];
  const { context } = harness({ bill: request => { requests.push(request); return request.action === 'review' ? review.promise : generation.promise; } }, true);
  const bill = new context.RendererModules.DesktopBill({ orderId: 5 });
  const reviewing = bill.review(); bill.review(); await bill.generate(); assert.equal(requests.length, 1);
  review.resolve({ ok: true, data: { ...data, id: null } }); await reviewing; bill.flush();
  const generating = bill.generate(); bill.generate(); bill.review(); assert.equal(requests.length, 2);
  assert.equal(requests[1].fingerprint, 'reviewed-items'); assert.equal(requests[1].orderId, 5);
  generation.resolve({ ok: false, error: 'Order changed; review the bill again' }); await generating; bill.flush();
  assert.match(bill.state.error, /Order changed/); assert.equal(bill.state.busy, false);
});

test('a stale bill close callback cannot dismiss its replacement', () => {
  const { app, bill: createBill } = harness({});
  const old = createBill(); app.billing.dismiss(); createBill();
  const current = app.billing.state.desktop;
  old.close(); assert.equal(app.billing.state.desktop, current);
  old.componentWillUnmount(); old.close(); assert.equal(app.billing.state.desktop, current);
});

test('test-bill printing keeps one request across lost replies, panel replacement and identity changes', async () => {
  const requests = [];
  const { app, bill: createBill } = harness({ testPrinting: async request => { requests.push(request); return { ok: requests.length > 1 }; } });
  let bill = createBill(); await bill.printTestBill(); assert.match(bill.state.printNotice, /status unavailable/);
  bill.componentWillUnmount(); app.billing.dismiss();
  app.tableOrders.dismissSelectedOrder(); arrange(app, { screen: 'order', tableId: 1 });
  bill = createBill(); await bill.printTestBill(); await bill.printTestBill();
  assert.equal(requests.length, 3); assert.ok(requests.every(request => request.requestId === requests[0].requestId && request.billId === 7));
  assert.match(bill.state.printNotice, /not proof of printing/);
});

test('demo bill gates pending items and preserves backup, reprint, totals and one history entry', async () => {
  const { app } = harness(undefined); app.billing.open();
  app.tableOrders.state.items.push({ id: 2, tableId: 1, status: 'pending', qty: 1, cxQty: 0, unit: 20 });
  app.demoBilling.continue(); assert.equal(app.demoBilling.state.dialog.step, 'confirm'); assert.equal(app.demoBilling.view().billBlocked, true);
  app.tableOrders.state.items.pop(); app.demoBilling.continue(); app.demoBilling.selectMethod('Cash'); app.demoBilling.selectAccount('B');
  app.demoPrinting.toggle('B'); app.demoBilling.print(false); assert.equal(app.demoBilling.state.dialog.step, 'failed');
  await app.demoBilling.paid(); assert.equal(app.demoBilling.state.history.length, 4);
  app.demoBilling.print(true); app.demoBilling.print(true); assert.equal(app.demoBilling.state.dialog.printed, 2);
  assert.equal(app.demoBilling.view().billNo, 'Bill #1045'); assert.equal(app.demoBilling.view().billTotal, '100 den');
  const paying = app.demoBilling.paid(); await app.demoBilling.paid(); await paying;
  assert.equal(app.demoBilling.state.history.length, 5); assert.equal(app.demoBilling.state.billNo, 1046);
  const record = app.demoBilling.state.history[0]; assert.equal(record.total, 100); assert.equal(record.count, 1); assert.equal(record.account, 'B');
  assert.equal(app.tableOrders.state.orders[1], undefined); assert.equal(routeOf(app), 'waiters');
  assert.equal(app.demoBilling.historyView().hCount, '5');
  for (const field of ['modal', 'history', 'billNo']) assert.equal(Object.hasOwn(app.state, field), false);
});
