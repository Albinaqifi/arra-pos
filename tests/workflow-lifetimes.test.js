const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('changing language preserves unresolved correction and move requests', async () => {
  class Component {
    setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); }
  }
  const calls = [];
  const context = {
    React: { Component },
    window: { arra: { language: async request => { calls.push(request); return { ok: true, language: request.language }; } } },
    clearTimeout() {},
  };
  vm.runInNewContext(require('./support/renderer-bundle')(), context);
  const app = new context.RendererModules.WaiterDemo();
  app._mounted = true;
  for (const modal of [
    { type: 'cancel', itemId: 4, qty: 1, reason: 'Entered by mistake', requestId: 'correction-request', unresolved: true },
    { type: 'moveTable', dest: 2, unresolved: true },
  ]) {
    arrange(app, { screen: 'order', tableId: 1, orders: { 1: { id: 7, log: [] } }, modal });
    app.moveWorkflow.requests.set('7:1:2', 'move-request');
    const snapshot = () => JSON.stringify({ modal: modal.type === 'moveTable' ? app.moveWorkflow.state.dialog : app.correction.state.dialog, move: [...app.moveWorkflow.requests] });
    const before = snapshot();
    await app.settings.changeLanguage('sq');
    assert.equal(app.settings.state.language, 'sq');
    assert.equal(routeOf(app), 'order');
    assert.equal(app.tableOrders.state.tableId, 1);
    assert.equal(snapshot(), before);
    if (modal.type === 'moveTable') app.moveWorkflow.dismiss(); else app.correction.dismiss();
    assert.ok(modal.type === 'moveTable' ? app.moveWorkflow.state.dialog : app.correction.state.dialog, 'an unresolved operation stays open after language changes');
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(request => request.action === 'set' && request.language === 'sq'));
});

test('an unacknowledged send retains its outbound request through language and waiter changes', async () => {
  class Component {
    setState(update, callback) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); callback?.(); }
    forceUpdate() {}
  }
  const requests = []; let sequence = 0;
  const api = {
    language: async request => ({ ok: true, language: request.language }),
    orderItems: async (action, orderId, requestId) => { requests.push({ orderId, requestId }); return { ok: false }; },
    clearWaiter: async () => ({ ok: true }), getWaiters: async () => ({ ok: true, data: [] }),
    selectWaiter: async () => ({ ok: true }), getMenu: async () => ({ ok: true, data: { categories: [], products: [] } }),
    getTables: async () => ({ ok: true, data: [{ id: 2, orderId: 7, area: 'Inside', openedAt: 1 }] }),
  };
  const context = { React: { Component }, window: { arra: api }, crypto: { randomUUID: () => 'send-' + ++sequence }, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')(), context);
  const app = new context.RendererModules.WaiterDemo(); app._mounted = true;
  arrange(app, { screen: 'order', waiter: { id: 1, name: 'First' }, tableId: 1, orders: { 1: { id: 7, log: [] } } });
  await app.sendWorkflow.send(); await app.settings.changeLanguage('sq'); await app.session.switchWaiter();
  await app.session.chooseWaiter({ id: 2, name: 'Next' }, ''); await app.loadDesktopData();
  arrange(app, { screen: 'order', tableId: 2 });
  await app.sendWorkflow.send();
  assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[0].orderId, 7); assert.equal(sequence, 1);
  assert.equal(app.sendWorkflow.state.busy, false); assert.equal(app.tableOrders.writeBusy, false);
});
