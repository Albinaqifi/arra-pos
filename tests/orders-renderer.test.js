const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('desktop opens and restores an order and reports an open failure', async () => {
  let saved = null, fail = false, failItems = false;
  const api = {
    getMenu: async () => ({ ok: true, data: { categories: [], products: [] } }),
    getTables: async () => ({ ok: true, data: [{ id: 1, area: 'Inside', orderId: saved?.id ?? null, openedAt: saved?.openedAt ?? null }] }),
    openOrder: async tableId => fail ? { ok: false } : { ok: true, data: saved ||= { id: 5, tableId, openedAt: Date.now() } },
    orderItems: async () => failItems ? { ok: false } : ({ ok: true, data: { items: [{ id: 1, productId: 'p', name: 'Dish', unitPrice: 120, quantity: 2 }], total: 240 } })
  };
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  const load = async () => { const app = new context.Demo(); app.componentDidMount(); app.loadDesktopData(); await new Promise(resolve => setImmediate(resolve)); return app; };
  let app = await load();
  assert.equal(app.renderVals().sections[0].tables[0].free, true);
  failItems = true; await app.openTable(1);
  assert.equal(app.state.screen, 'login');
  assert.equal(app.renderVals().sections[0].tables[0].taken, true);
  assert.match(app.state.toast.msg, /Could not load order items/);
  failItems = false;
  await app.openTable(1);
  assert.equal(app.state.screen, 'order'); assert.equal(app.state.orders[1].id, 5);
  app.goTables(); assert.equal(app.renderVals().sections[0].tables[0].taken, true);
  app = await load();
  let card = app.renderVals().sections[0].tables[0];
  assert.equal(card.taken, true); assert.equal(card.total, '—');
  assert.equal(card.count, 'Open to view items'); assert.equal(card.hasUnsent, false);
  assert.doesNotMatch(card.aria, /0/);
  await app.openTable(1); assert.equal(app.state.orders[1].id, 5);
  app.goTables(); card = app.renderVals().sections[0].tables[0];
  assert.match(card.total, /240/); assert.equal(card.count, '2 items'); assert.equal(card.unsent, '2 not sent');
  fail = true; await app.openTable(1);
  assert.equal(app.state.screen, 'tables'); assert.match(app.state.toast.msg, /Could not open/);
});
