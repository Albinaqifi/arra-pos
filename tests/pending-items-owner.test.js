const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const rendererBundle = require('./support/renderer-bundle');

function appFor(bridge) {
  class Component {
    constructor(props) { this.props = props; }
    setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); }
    forceUpdate() {}
  }
  const context = { React: { Component, createElement: (type, props, ...children) => ({ type, props, children }) }, window: { arra: bridge }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(rendererBundle(), context);
  const app = new context.RendererModules.WaiterDemo();
  app.componentDidMount();
  return app;
}
const item = (id, status = 'pending', note = '') => ({ id, productId: 'p', name: 'Sample dish', unitPrice: 110, quantity: 1, note, status, modifiers: [] });
async function desktop(items = []) {
  const requests = [];
  let orderId = 10;
  const bridge = {
    language: async ({ language = 'en' }) => ({ ok: true, language }),
    getMenu: async () => ({ ok: true, data: { categories: [{ id: 'food', name: 'Food' }], products: [{ id: 'p', categoryId: 'food', name: 'Sample dish', price: 100 }], groups: [{ id: 'size', productId: 'p', name: 'Size', required: true }], options: [{ id: 'regular', groupId: 'size', name: 'Regular', adjustment: 0 }, { id: 'large', groupId: 'size', name: 'Large', adjustment: 10 }] } }),
    getTables: async () => ({ ok: true, data: [{ id: 1, area: 'Inside', orderId, openedAt: 1, untouched: true }] }),
    openOrder: async () => ({ ok: true, data: { id: orderId, openedAt: 1, untouched: true } }),
    orderItems: (action, id, value) => action === 'list' ? Promise.resolve({ ok: true, data: { items } }) : new Promise((resolve, reject) => requests.push({ action, id, value, resolve, reject })),
  };
  const app = appFor(bridge);
  await app.loadDesktopData(); await app.tableOrders.openTable(1);
  return { app, requests, replaceOrder: id => { orderId = id; } };
}

test('pending rows show newest first with stable identities and actions after reload', async () => {
  const older = { ...item(1), name: 'Older dish' };
  const sent = { ...item(2, 'sent'), name: 'Sent dish', round: 1, sentAt: 1, sentBy: 'sample' };
  const newer = { ...item(3), name: 'Newer dish' };
  const { app, requests } = await desktop([older, sent, newer]);
  const otherTable = { ...app.tableOrders.state.items[0], id: 4, tableId: 2, name: 'Other table' };
  app.tableOrders._set({ items: app.tableOrders.state.items.concat(otherTable) });
  const snapshot = app.tableOrders.state.items;
  let rows = app.pending.rowsView();
  assert.deepEqual(Array.from(rows.pending, row => row.id), [3, 1]);
  assert.deepEqual(Array.from(rows.pending, row => row.name), ['Newer dish', 'Older dish']);
  assert.equal(rows.pendingCount, '2 items');
  assert.equal(app.tableOrders.state.items, snapshot);
  assert.deepEqual(Array.from(snapshot, value => value.id), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(app.tableOrders.orderView({ language: 'en', now: 1, onCorrect() {} }).rounds[0].items, value => value.name), ['Sent dish']);

  // Fragment keys must follow items when a new row appears above them.
  const context = { React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }) } };
  vm.runInNewContext(rendererBundle.moduleSource(path.join(__dirname, '../src/pending/PendingList.js'), 'PendingListModule'), context);
  const keys = [];
  function collect(node) {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== 'object') return;
    if (node.props?.key != null) keys.push(node.props.key);
    if (node.children) collect(node.children);
  }
  collect(context.PendingListModule.renderPendingList(rows));
  assert.deepEqual(keys, [3, 1]);

  const changing = rows.pending[0].inc();
  assert.equal(requests[0].action, 'increment'); assert.equal(requests[0].id, 10); assert.equal(requests[0].value, 3);
  requests[0].resolve({ ok: true, data: { items: [older, sent, { ...newer, quantity: 2 }] } });
  await changing;
  rows = app.pending.rowsView();
  assert.deepEqual(Array.from(rows.pending, row => row.id), [3, 1]);
  assert.equal(rows.pending[0].qty, '2');
  await app.tableOrders.openTable(1);
  rows = app.pending.rowsView();
  assert.deepEqual(Array.from(rows.pending, row => row.id), [3, 1]);
  rows.pending[1].editNote(); assert.equal(app.pending.state.dialog.itemId, 1); app.pending.dismiss();
  const removing = rows.pending[1].remove();
  assert.equal(requests[1].action, 'remove'); assert.equal(requests[1].value, 1);
  requests[1].resolve({ ok: true, data: { items: [sent, { ...newer, quantity: 2 }] } });
  await removing;
  assert.deepEqual(Array.from(app.pending.rowsView().pending, row => row.id), [3]);
  app.componentWillUnmount();
});

test('demo modifier opening, cancellation and invalid submission do not create an order', async () => {
  const app = appFor();
  app.session.setUsername('sample'); app.session.setPassword('sample password'); await app.session.login();
  app.session.requestTable(1); await app.session.setPin(String(require('node:crypto').randomInt(10000)).padStart(4,'0'));
  assert.equal(app.tableOrders.state.orders[1], undefined);
  app.pending.addProduct('qebapa');
  assert.equal(app.tableOrders.state.orders[1], undefined);
  assert.equal(app.pending.dismiss(), true);
  assert.equal(app.tableOrders.state.orders[1], undefined);
  app.pending.addProduct('qebapa'); await app.pending.modAdd();
  assert.equal(app.tableOrders.state.orders[1], undefined);
  app.pending.chooseModifier('portion', 0); app.pending.chooseModifier('side', 0);
  await app.pending.modAdd();
  assert.ok(app.tableOrders.state.orders[1].id);
  const entered = app.tableOrders.state.items.filter(value => value.tableId === 1);
  assert.equal(entered.length, 1); assert.equal(entered[0].qty, 1);
  assert.equal(app.pending.state.dialog, null);
  assert.equal(app.tableOrders.writeBusy, false);
  app.componentWillUnmount();
});

test('uncertain modifier add preserves its choices and never resubmits on a render or language change', async () => {
  const { app, requests } = await desktop();
  app.pending.addProduct('p'); app.pending.chooseModifier('size', 1);
  const saving = app.pending.modAdd();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'add'); assert.equal(requests[0].id, 10);
  assert.equal(JSON.stringify(requests[0].value), JSON.stringify({ productId: 'p', optionIds: ['large'] }));
  assert.equal(app.tableOrders.state.orders[1].untouched, false);
  app.pending.chooseModifier('size', 0); app.pending.addProduct('p');
  assert.equal(app.pending.dismiss(), false);
  await app.tableOrders.showTables();
  assert.equal(app.tableOrders.state.screen, 'order');
  assert.equal(app.pending.state.dialog.sel.size, 1);
  requests[0].reject(Error('Response unavailable')); await saving;
  assert.equal(app.pending.state.dialog.saving, false);
  assert.equal(app.pending.state.dialog.sel.size, 1);
  assert.equal(app.tableOrders.writeBusy, false);
  app.pending.view(); app.pending.render();
  await app.settings.changeLanguage('sq'); app.pending.view();
  assert.equal(app.settings.state.language, 'sq');
  assert.equal(requests.length, 1);
  const retry = app.pending.modAdd();
  assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(requests[1].value), JSON.stringify(requests[0].value));
  requests[1].resolve({ ok: true, data: { items: [item(1)] } }); await retry;
  assert.equal(app.pending.state.dialog, null);
  assert.equal(app.tableOrders.state.items.length, 1);
  app.componentWillUnmount();
});

test('note save locks its payload and pending-only commands reject sent items', async () => {
  const { app, requests } = await desktop([item(1), item(2, 'sent')]);
  await app.pending.incItem(2); await app.pending.decItem(2); await app.pending.removeItem(2); app.pending.openNote(2);
  assert.equal(requests.length, 0); assert.equal(app.pending.state.dialog, null);
  app.pending.openNote(1); app.pending.setNoteText('  Less salt  ');
  const saving = app.pending.saveNote();
  assert.equal(requests[0].value.note, 'Less salt');
  app.pending.setNoteText('Different'); app.pending.toggleNoteChip('No onions');
  assert.equal(app.pending.dismiss(), false);
  await app.pending.incItem(1); app.pending.openNote(2);
  assert.equal(app.pending.state.dialog.text, '  Less salt  ');
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: false }); await saving;
  assert.equal(app.pending.state.dialog.text, '  Less salt  ');
  assert.match(app.pending.state.dialog.error, /Could not save note/);
  assert.equal(app.tableOrders.state.items[0].note, '');
  assert.equal(app.tableOrders.writeBusy, false);
  app.componentWillUnmount();
});

test('an old note completion cannot clear a new draft, replace a new order, or release its write lease', async () => {
  const { app, requests, replaceOrder } = await desktop([item(1)]);
  app.pending.openNote(1); app.pending.setNoteText('Old note');
  const oldSave = app.pending.saveNote();
  app.clearDesktopData(); replaceOrder(20);
  await app.loadDesktopData(); await app.tableOrders.openTable(1);
  app.pending.openNote(1); app.pending.setNoteText('Current note');
  const currentSave = app.pending.saveNote();
  assert.equal(requests[1].id, 20);
  requests[0].resolve({ ok: true, data: { items: [item(9, 'pending', 'Old note')] } }); await oldSave;
  assert.equal(app.pending.state.dialog.text, 'Current note');
  assert.equal(app.pending.state.dialog.saving, true);
  assert.equal(app.tableOrders.writeBusy, true);
  assert.equal(app.tableOrders.state.items[0].id, 1);
  requests[1].resolve({ ok: true, data: { items: [item(1, 'pending', 'Current note')] } }); await currentSave;
  assert.equal(app.tableOrders.state.items[0].note, 'Current note');
  assert.equal(app.pending.state.dialog, null); assert.equal(app.tableOrders.writeBusy, false);
  app.componentWillUnmount();
});

test('disposing the renderer suppresses pending save completion and removes feature subscribers', async () => {
  const { app, requests } = await desktop([item(1)]);
  app.pending.openNote(1); app.pending.setNoteText('Saved after close');
  const saving = app.pending.saveNote();
  let notifications = 0; app.pending.subscribe(() => notifications++);
  app.componentWillUnmount();
  const pendingState = app.pending.state, orderState = app.tableOrders.state;
  requests[0].resolve({ ok: true, data: { items: [item(1, 'pending', 'Saved after close')] } }); await saving;
  assert.equal(app.pending.state, pendingState); assert.equal(app.tableOrders.state, orderState);
  assert.equal(app.pending.listeners.size, 0); assert.equal(app.tableOrders.listeners.size, 0);
  assert.equal(notifications, 0);
});
