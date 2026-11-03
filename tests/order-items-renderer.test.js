const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('desktop screen loads and saves items, shows failures, and does not send demo orders', async () => {
  let rows = [], fail = false, reject = false, release;
  const api = {
    getMenu: async () => ({ ok: true, data: { categories: [{ id: 'food', name: 'Food' }], products: [{ id: 'p', categoryId: 'food', name: 'Dish', price: 120 }] } }),
    getTables: async () => ({ ok: true, data: [{ id: 1, area: 'Inside', orderId: 3, openedAt: 1 }] }),
    openOrder: async () => ({ ok: true, data: { id: 3, tableId: 1, openedAt: 1 } }),
    orderItems: async (action, order, value) => {
      assert.equal(order, 3);
      if (reject) throw Error('save failed');
      if (fail) return { ok: false };
      if (action === 'note' && release) await new Promise(resolve => { release = resolve; });
      if (action === 'add') rows.push({ id: 7, productId: value, name: 'Dish', unitPrice: 120, quantity: 1, note: '' });
      if (action === 'note') rows[0].note = value.note;
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
  app.openNote(7); app.state.modal.text = 'Less salt'; await app.saveNote();
  assert.equal(app.state.items[0].note, 'Less salt');
  app.openNote(7); app.state.modal.text = 'Changed'; fail = true; await app.saveNote();
  assert.equal(app.state.modal.text, 'Changed'); assert.match(app.renderVals().modalSub, /Could not save note/);
  fail = false; reject = true; await app.saveNote();
  assert.equal(app.state.modal.saving, false); assert.equal(app.state.modal.text, 'Changed');
  assert.match(app.renderVals().modalSub, /Could not save note/);
  reject = false; release = true;
  const pending = app.saveNote();
  assert.equal(app.renderVals().noteSaving, true);
  app.renderVals().closeModal(); assert.equal(app.state.modal.text, 'Changed');
  release(); await pending; release = null;
  assert.equal(app.state.items[0].note, 'Changed'); assert.equal(app.state.modal, null);
  app.send(); assert.equal(app.state.items[0].status, 'pending');
  app = await load(); assert.equal(app.state.items[0].qty, 2); assert.equal(app.state.items[0].note, 'Changed'); assert.match(app.renderVals().total, /240/);
  fail = true; await app.removeItem(7); assert.equal(app.state.items.length, 1); assert.match(app.state.toast.msg, /Could not save/);
  fail = false; await app.removeItem(7); assert.equal(app.state.items.length, 0);
});
