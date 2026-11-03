const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('desktop screen loads and saves items, shows failures, and does not send demo orders', async () => {
  let rows = [], fail = false;
  const api = {
    getMenu: async () => ({ ok: true, data: { categories: [{ id: 'food', name: 'Food' }], products: [{ id: 'p', categoryId: 'food', name: 'Dish', price: 120 }] } }),
    getTables: async () => ({ ok: true, data: [{ id: 1, area: 'Inside', orderId: 3, openedAt: 1 }] }),
    openOrder: async () => ({ ok: true, data: { id: 3, tableId: 1, openedAt: 1 } }),
    orderItems: async (action, order, value) => {
      assert.equal(order, 3);
      if (fail) return { ok: false };
      if (action === 'add') rows.push({ id: 7, productId: value, name: 'Dish', unitPrice: 120, quantity: 1 });
      if (action === 'increment') rows[0].quantity++;
      if (action === 'remove') rows = [];
      return { ok: true, data: { items: rows.map(x => ({ ...x })), total: rows.reduce((s, x) => s + x.quantity * x.unitPrice, 0) } };
    }
  };
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  const load = async () => { const app = new context.Demo(); app.componentDidMount(); await new Promise(resolve => setImmediate(resolve)); await app.openTable(1); return app; };
  let app = await load();
  await app.addProduct('p'); await app.incItem(7);
  assert.equal(app.state.items[0].qty, 2);
  app.send(); assert.equal(app.state.items[0].status, 'pending');
  app = await load(); assert.equal(app.state.items[0].qty, 2); assert.match(app.renderVals().total, /240/);
  fail = true; await app.removeItem(7); assert.equal(app.state.items.length, 1); assert.match(app.state.toast.msg, /Could not save/);
  fail = false; await app.removeItem(7); assert.equal(app.state.items.length, 0);
});
