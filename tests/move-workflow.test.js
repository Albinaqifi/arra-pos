const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');

const source = esbuild.buildSync({ stdin: { contents: "export { MoveWorkflow } from './src/movement/MoveWorkflow.js'; export { TableOrderModel } from './src/orders/TableOrderModel.js';", resolveDir: path.resolve(__dirname, '..') }, bundle: true, format: 'iife', globalName: 'Modules', write: false }).outputFiles[0].text;
const initialTables = () => [{ id: 1, area: 'Inside', orderId: 10, openedAt: 1 }, { id: 2, area: 'Inside', orderId: null }, { id: 3, area: 'Inside', orderId: 30, openedAt: 2 }, { id: 4, area: 'Inside', orderId: 40, untouched: true }];
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup({ demo = false } = {}) {
  const context = { React: { createElement: (type, props, ...children) => ({ type, props, children }) } };
  vm.runInNewContext(source, context);
  const calls = [], notices = [], movedJobs = [];
  let tablesResult = { ok: true, data: initialTables() }, blocked = false, sequence = 0, workflow;
  const bridge = demo ? null : {
    getTables: async () => tablesResult,
    openOrder: async id => ({ ok: true, data: { id: tablesResult.data.find(row => row.id === id).orderId, openedAt: 1 } }),
    orderItems: async () => ({ ok: true, data: { items: [{ id: 5, productId: 'p', name: 'Sample dish', unitPrice: 100, quantity: 1, status: 'pending' }] } }),
    moveOrder: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
  };
  const orders = new context.Modules.TableOrderModel({ bridge, canNavigate: () => !workflow?.locked && !blocked, onDismiss: () => workflow.dismiss(), nextId: () => 'unused', demoOrders: demo ? { sections: [{ label: 'Inside', ids: [1, 2, 3, 4] }], orders: { 1: { id: 'demo-10', rounds: 0, log: [] }, 3: { id: 'demo-30', rounds: 0, log: [] } }, items: [{ id: 'item', tableId: 1, status: 'pending', qty: 1 }] } : undefined });
  const port = { snapshot: () => orders.state, writeBusy: () => orders.writeBusy, captureTarget: id => orders.captureTarget(id), isCurrent: target => orders.isCurrent(target), acquireWrite: (kind, target) => orders.acquireWrite(kind, target), releaseWrite: lease => orders.releaseWrite(lease), applyConfirmedMove: (target, to, untouched) => orders.applyConfirmedMove(target, to, untouched), reconcileOrderLocations: (target, rows) => orders.reconcileOrderLocations(target, rows), abandonChangedOrder: target => orders.abandonChangedOrder(target), refreshAvailability: target => orders.refreshAvailability(target), moveDemoOrder: (from, to, actor) => orders.moveDemoOrder(from, to, actor) };
  workflow = new context.Modules.MoveWorkflow({ bridge, orders: port, getLanguage: () => 'en', getActor: () => 'Sample', isHandoffPending: () => blocked, canOpen: () => true, dismissOtherDialogs: () => true, notify: (...args) => notices.push(args), onDemoMoved: (from, to) => movedJobs.push([from, to]), createRequestId: () => 'move-' + ++sequence });
  if (!demo) await orders.loadTables();
  await orders.openTable(1);
  return { workflow, orders, calls, notices, movedJobs, setTables: value => { tablesResult = value; }, setBlocked: value => { blocked = value; } };
}

test('move owner accepts only a free or untouched destination and shares the order write lease', async () => {
  const { workflow, orders, calls, setTables } = await setup();
  workflow.open();
  assert.equal(workflow.view().mtTables.find(row => row.num === '3').disabled, true);
  assert.equal(workflow.view().mtTables.find(row => row.num === '4').disabled, false);
  workflow.chooseDestination(3); workflow.chooseDestination(99); workflow.chooseDestination(1);
  assert.equal(workflow.state.dialog.dest, null);
  const other = orders.acquireWrite('note');
  workflow.chooseDestination(4); await workflow.confirm();
  assert.equal(calls.length, 0);
  orders.releaseWrite(other);
  const moving = workflow.confirm();
  assert.equal(calls.length, 1); assert.equal(orders.writeBusy, true);
  assert.deepEqual(calls[0].args.slice(0, 3), [10, 1, 4]);
  workflow.chooseDestination(2); assert.equal(workflow.dismiss(), false);
  workflow.open(); orders.showTables();
  assert.equal(workflow.state.dialog.dest, 4); assert.equal(orders.state.screen, 'order');
  assert.equal(orders.acquireWrite('send'), null);
  setTables({ ok: true, data: [{ id: 4, orderId: 10, untouched: true }] });
  calls[0].resolve({ ok: true }); await moving;
  assert.equal(orders.state.orders[4].id, 10); assert.equal(orders.state.orders[4].untouched, true);
  assert.equal(orders.state.orders[1], undefined); assert.equal(orders.state.items[0].tableId, 4);
  assert.equal(orders.writeBusy, false); assert.equal(workflow.state.dialog, null);
});

test('confirmed source reconciliation unlocks choices but preserves the retry token across close and reopen', async () => {
  const { workflow, calls } = await setup();
  workflow.open(); workflow.chooseDestination(2);
  const first = workflow.confirm(); calls[0].resolve({ ok: false }); await first;
  assert.equal(workflow.locked, false); assert.equal(workflow.state.dialog.dest, null);
  assert.match(workflow.state.dialog.error, /not moved/);
  workflow.dismiss(); workflow.open(); workflow.chooseDestination(2);
  const second = workflow.confirm();
  assert.deepEqual(calls[1].args, calls[0].args);
  calls[1].resolve({ ok: true }); await second;
  assert.equal(workflow.state.dialog, null);
});

test('unknown movement keeps a frozen request and navigation lock until destination reconciliation succeeds', async () => {
  const { workflow, orders, calls, setTables } = await setup();
  workflow.open(); workflow.chooseDestination(2);
  const first = workflow.confirm(); const request = workflow.state.dialog.request;
  assert.equal(Object.isFrozen(request), true);
  setTables({ ok: false }); calls[0].reject(Error('Response unavailable')); await first;
  assert.equal(workflow.state.dialog.unresolved, true); assert.equal(orders.writeBusy, false);
  assert.match(workflow.view().modalSub, /status is unknown/);
  workflow.chooseDestination(4); assert.equal(workflow.dismiss(), false); orders.showTables();
  assert.equal(workflow.state.dialog.dest, 2); assert.equal(orders.state.screen, 'order');
  const retry = workflow.confirm();
  assert.equal(workflow.state.dialog.request, request); assert.deepEqual(calls[1].args, calls[0].args);
  setTables({ ok: true, data: [{ id: 1, orderId: null }, { id: 2, orderId: 10, openedAt: 1, untouched: true }] });
  calls[1].resolve({ ok: false }); await retry;
  assert.equal(orders.state.tableId, 2); assert.equal(orders.state.orders[2].id, 10);
  assert.equal(orders.state.orders[2].untouched, true); assert.equal(workflow.state.dialog, null);
  assert.equal(orders.writeBusy, false);
});

test('unexpected or missing order location returns to tables without applying a guessed destination', async () => {
  for (const rows of [[{ id: 3, orderId: 10, openedAt: 1 }], [{ id: 2, orderId: null }]]) {
    const { workflow, orders, calls, notices, setTables } = await setup();
    workflow.open(); workflow.chooseDestination(2);
    const moving = workflow.confirm(); setTables({ ok: true, data: rows }); calls[0].resolve({ ok: false }); await moving;
    assert.equal(workflow.state.dialog, null); assert.equal(orders.state.screen, 'tables');
    assert.equal(orders.state.tableId, null); assert.equal(orders.state.items.length, 0);
    assert.equal(orders.state.orders[2], undefined); assert.match(notices[0][0], /location changed/);
    assert.equal(orders.writeBusy, false);
  }
});

test('reset invalidates a delayed move and its completion cannot release a newer request', async () => {
  const { workflow, orders, calls, setTables } = await setup();
  workflow.open(); workflow.chooseDestination(2); const first = workflow.confirm();
  workflow.reset(); orders.clearProtectedData();
  setTables({ ok: true, data: [{ id: 1, area: 'Inside', orderId: 50, openedAt: 1 }, { id: 2, area: 'Inside', orderId: null }] });
  await orders.loadTables(); await orders.openTable(1);
  workflow.open(); workflow.chooseDestination(2); const current = workflow.confirm();
  calls[0].resolve({ ok: true }); await first;
  assert.equal(orders.state.orders[1].id, 50); assert.equal(orders.state.orders[2], undefined);
  assert.equal(workflow.state.dialog.saving, true); assert.equal(orders.writeBusy, true);
  calls[1].resolve({ ok: true }); await current;
  assert.equal(orders.state.orders[2].id, 50); assert.equal(orders.writeBusy, false);
});

test('dispose during reconciliation suppresses late dialog, record and notification updates', async () => {
  const { workflow, orders, calls, notices, setTables } = await setup();
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  // getTables awaits this thenable, just like a delayed bridge response.
  setTables(deferred);
  workflow.open(); workflow.chooseDestination(2); const moving = workflow.confirm();
  calls[0].resolve({ ok: false }); await tick();
  workflow.dispose(); const snapshot = workflow.state, records = orders.state.orders;
  release({ ok: true, data: [{ id: 2, orderId: 10 }] }); await moving;
  assert.equal(workflow.state, snapshot); assert.equal(orders.state.orders, records);
  assert.equal(notices.length, 0); assert.equal(orders.writeBusy, false);
});

test('handoff prevents opening and submission, while demo movement moves records and printing through named commands', async () => {
  const { workflow, orders, movedJobs, setBlocked } = await setup({ demo: true });
  setBlocked(true); workflow.open(); assert.equal(workflow.state.dialog, null);
  setBlocked(false); workflow.open(); workflow.chooseDestination(2);
  setBlocked(true); await workflow.confirm(); assert.equal(orders.state.tableId, 1);
  setBlocked(false); await workflow.confirm();
  assert.equal(orders.state.orders[2].id, 'demo-10'); assert.equal(orders.state.items[0].tableId, 2);
  assert.deepEqual(movedJobs, [[1, 2]]); assert.equal(workflow.state.dialog, null);
  await workflow.confirm(); assert.equal(movedJobs.length, 1);
  assert.equal(orders.state.orders[2].log.length, 1); assert.equal(orders.writeBusy, false);
});
