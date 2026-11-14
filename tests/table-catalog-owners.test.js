const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const rendererBundle = require('./support/renderer-bundle');

function modules(bridge) {
  const context = { React: { Component: class {}, createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment' }, window: { arra: bridge } };
  vm.runInNewContext(rendererBundle(), context);
  return context.RendererModules;
}
const menu = name => ({ ok: true, data: { categories: [{ id: 'food', name: 'Food' }], products: [{ id: 'p', name, categoryId: 'food', price: 100 }], groups: [], options: [] } });
const row = (id, orderId, untouched = false) => ({ id, area: 'Inside', orderId, openedAt: orderId ? 1 : null, untouched });
const item = (id, name = 'Sample dish') => ({ id, productId: 'p', name, unitPrice: 100, quantity: 1, note: '', status: 'pending', modifiers: [] });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('catalog reset and superseding load suppress prior identity success and failure', async () => {
  const releases = [];
  const bridge = { getMenu: () => new Promise(resolve => releases.push(resolve)) };
  const { CatalogModel } = modules(bridge);
  const catalog = new CatalogModel({ bridge });
  const old = catalog.load();
  catalog.clearProtectedData();
  assert.equal(catalog.state.products.length, 0);
  const current = catalog.load();
  releases[1](menu('Current dish')); await current;
  releases[0](menu('Old protected dish')); await old;
  assert.equal(catalog.state.products[0].name, 'Current dish');
  const staleFailure = catalog.load(), newest = catalog.load();
  releases[3](menu('Newest dish')); await newest;
  releases[2]({ ok: false }); await staleFailure;
  assert.equal(catalog.state.menuLoad, 'ready');
  assert.equal(catalog.state.products[0].name, 'Newest dish');
  const pending = catalog.load(); catalog.dispose();
  const before = catalog.state; releases[4](menu('Disposed')); await pending;
  assert.equal(catalog.state, before);
});

test('catalog view keeps hierarchy, service option IDs, search and pending badges scoped to catalog data', async () => {
  const bridge = { getMenu: async () => ({ ok: true, data: {
    categories: [{ id: 'food', name: 'Food' }, { id: 'grill', parentId: 'food', name: 'Grill' }],
    products: [{ id: 'soup', name: 'Soup', price: 100, categoryId: 'food' }, { id: 'steak', name: 'Steak', price: 200, categoryId: 'grill' }],
    groups: [{ id: 'cooking', name: 'Cooking', required: true, productId: 'steak' }],
    options: [{ id: 'medium', groupId: 'cooking', name: 'Medium', adjustment: 20 }],
  } }) };
  const { CatalogModel } = modules(bridge), catalog = new CatalogModel({ bridge });
  await catalog.load();
  assert.equal(catalog.state.G.cooking.opts[0][2], 'medium');
  assert.equal(catalog.state.G.cooking.req, true);
  const added = [];
  const view = () => catalog.view({ language: 'en', pendingItems: [{ pid: 'steak', qty: 2 }], addProduct: id => added.push(id) });
  assert.equal(view().products[0].name, 'Soup');
  view().subs.find(value => value.label === 'Grill').pick();
  assert.equal(view().products[0].badge, '2');
  view().products[0].add(); assert.deepEqual(added, ['steak']);
  view().onSearch({ target: { value: 'soup' } });
  assert.equal(view().products[0].name, 'Soup');
  assert.equal(catalog.state.sub, 'grill');
  view().clearSearch(); assert.equal(view().products[0].name, 'Steak');
});

test('table refresh cannot repopulate an identity that has been cleared', async () => {
  const releases = [];
  const bridge = { getTables: () => new Promise(resolve => releases.push(resolve)) };
  const { TableOrderModel } = modules(bridge), tables = new TableOrderModel({ bridge });
  const old = tables.loadTables();
  tables.clearProtectedData();
  const current = tables.loadTables();
  releases[1]({ ok: true, data: [row(2, 20)] }); await current;
  releases[0]({ ok: true, data: [row(1, 10)] }); await old;
  assert.equal(tables.state.orders[2].id, 20);
  assert.equal(tables.state.orders[1], undefined);
});

test('late open and item-list responses neither reveal old data nor release a newer open', async () => {
  const opened = [], listed = [];
  const bridge = {
    openOrder: tableId => new Promise(resolve => opened.push({ tableId, resolve })),
    orderItems: (action, orderId) => new Promise(resolve => listed.push({ action, orderId, resolve })),
  };
  const { TableOrderModel } = modules(bridge), tables = new TableOrderModel({ bridge });
  const old = tables.openTable(1); tables.clearProtectedData();
  const current = tables.openTable(2);
  opened[0].resolve({ ok: true, data: { id: 10, openedAt: 1 } }); await old;
  assert.equal(tables.opening, true);
  assert.equal(tables.state.orders[1], undefined);
  assert.equal(listed.length, 0);
  opened[1].resolve({ ok: true, data: { id: 20, openedAt: 1 } }); await tick();
  assert.equal(listed[0].orderId, 20);
  tables.clearProtectedData();
  listed[0].resolve({ ok: true, data: { items: [item(20, 'Old identity item')] } }); await current;
  assert.equal(tables.state.items.length, 0);
  assert.equal(tables.state.tableId, null);
  assert.equal(tables.opening, false);
});

test('a lease captures the identity generation and an old completion cannot release a newer write', async () => {
  let orderId = 10;
  const bridge = { getTables: async () => ({ ok: true, data: [row(1, orderId)] }) };
  const { TableOrderModel } = modules(bridge), tables = new TableOrderModel({ bridge });
  await tables.loadTables();
  const old = tables.acquireWrite('add', tables.captureTarget(1));
  assert.ok(old); assert.equal(tables.acquireWrite('correct', old), null);
  tables.clearProtectedData(); orderId = 30; await tables.loadTables();
  const current = tables.acquireWrite('note', tables.captureTarget(1));
  assert.ok(current);
  assert.equal(tables.applyConfirmedItems(old, [item(10, 'Stale item')]), false);
  tables.releaseWrite(old);
  assert.equal(tables.writeBusy, true);
  assert.equal(tables.state.activity, 'note');
  assert.equal(tables.state.items.length, 0);
  tables.releaseWrite(current); assert.equal(tables.writeBusy, false);
});

test('confirmed items and availability follow stable order identity after a move', async () => {
  let records = [row(1, 10), row(2, null), row(3, 30)];
  const bridge = {
    getTables: async () => ({ ok: true, data: records }),
    openOrder: async tableId => ({ ok: true, data: { id: tableId === 3 ? 30 : 10, openedAt: 1 } }),
    orderItems: async (_action, orderId) => ({ ok: true, data: { items: [item(orderId)] } }),
  };
  const { TableOrderModel } = modules(bridge), tables = new TableOrderModel({ bridge });
  await tables.loadTables(); await tables.openTable(1);
  const target = tables.captureTarget();
  assert.equal(tables.applyConfirmedMove(target, 2), true);
  await tables.openTable(3);
  tables.applyConfirmedItems(target, [item(11, 'Moved order item')]);
  assert.equal(tables.state.items.find(value => value.id === 11).tableId, 2);
  assert.equal(tables.state.items.find(value => value.id === 30).tableId, 3);
  records = [row(1, null), row(2, 10, true), row(3, 30)];
  await tables.refreshAvailability(target);
  assert.equal(tables.state.orders[2].untouched, true);
  assert.equal(tables.state.orders[3].untouched, false);
  assert.equal(tables.state.tableId, 3);
});

test('table view opens through its named action without a component instance or unknown-total leak', async () => {
  const bridge = {
    getTables: async () => ({ ok: true, data: [row(1, 10)] }),
    openOrder: async () => ({ ok: true, data: { id: 10, openedAt: 1 } }),
    orderItems: async () => ({ ok: true, data: { items: [item(1)] } }),
  };
  const { TableOrderModel, renderTables } = modules(bridge), tables = new TableOrderModel({ bridge });
  await tables.loadTables();
  const view = tables.tableView({ language: 'en' });
  assert.equal(view.sections[0].tables[0].total, '—');
  assert.equal(view.sections[0].tables[0].count, 'Open to view items');
  const tree = renderTables(view, () => ({}));
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...node.children.flatMap(all)];
  const button = all(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Table 1,'));
  await button.props.onClick();
  assert.equal(tables.state.screen, 'order');
  assert.equal(tables.state.orders[1].id, 10);
  assert.match(tables.tableView({ language: 'en' }).sections[0].tables[0].total, /100/);
});

test('replayed React updaters do not repeat demo data writes, IDs, activity or completion', async () => {
  let updating = false, reentrantRenders = 0;
  class Component {
    constructor(props) { this.props = props; }
    setState(update, callback) {
      if (typeof update === 'function') {
        updating = true;
        update(this.state); // React may discard and replay an updater.
        const committed = update(this.state);
        updating = false;
        Object.assign(this.state, committed);
      } else Object.assign(this.state, update);
      callback?.();
    }
    forceUpdate() { if (updating) reentrantRenders++; }
  }
  const context = { React: { Component, createElement() {} }, window: {}, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(rendererBundle(), context);
  const app = new context.RendererModules.WaiterDemo(); app.componentDidMount();
  await app.session.chooseWaiter({ name: 'Sample' }, '');
  await app.tableOrders.openTable(1);
  app.addProduct('qebapa');
  app.state.modal.sel = { portion: 0, side: 0 };
  await app.modAdd();
  let entered = app.tableOrders.state.items.filter(value => value.tableId === 1);
  assert.equal(entered.length, 1); assert.equal(entered[0].qty, 1); assert.equal(entered[0].id, 'i114');
  app.incItem(entered[0].id);
  app.setState({ printers: { kitchen: false, bar: true, A: true, B: true } });
  app.send();
  assert.equal(app.state.jobs.length, 1); assert.equal(app.state.jobs[0].id, 'j115');
  assert.equal(app.tableOrders.state.orders[1].rounds, 1);
  assert.equal(app.tableOrders.state.orders[1].log.filter(value => value.text.startsWith('Added ')).length, 1);
  assert.equal(app.tableOrders.state.orders[1].log.filter(value => value.text.startsWith('Sent round ')).length, 1);
  app.retryJob('j115'); app.backupJob('j115');
  assert.equal(app.state.jobs[0].attempts, 3);
  assert.equal(app.tableOrders.state.orders[1].log.filter(value => value.text.startsWith('Retry of ')).length, 1);
  assert.equal(app.tableOrders.state.orders[1].log.filter(value => value.text.includes('on the backup printer')).length, 1);
  await app.session.chooseWaiter({ name: 'Sample' }, ''); await app.tableOrders.openTable(1);
  app.setState({ modal: { type: 'cancel', itemId: 'i114', qty: 1, reason: 'Entered by mistake', other: '' } });
  await app.confirmCancel();
  entered = app.tableOrders.state.items.filter(value => value.tableId === 1);
  assert.equal(entered[0].cxQty, 1); assert.equal(entered[0].cx.length, 1);
  app.setState({ modal: { type: 'moveTable', dest: 2 } }); await app.confirmMoveTable();
  assert.equal(app.tableOrders.state.orders[2].log.filter(value => value.text.startsWith('Moved the whole order')).length, 1);
  app.setState({ modal: { type: 'bill', method: 'Card', account: 'A', printed: 0, step: 'review' } });
  app.printBill(false); app.printBill(false);
  assert.equal(app.state.modal.printed, 2);
  assert.equal(app.tableOrders.state.orders[2].log.filter(value => value.text.startsWith('Printed bill on ')).length, 1);
  assert.equal(app.tableOrders.state.orders[2].log.filter(value => value.text.startsWith('Reprinted the bill on ')).length, 1);
  const history = app.state.history.length;
  app.paid(); app.paid();
  assert.equal(app.state.history.length, history + 1);
  assert.equal(app.tableOrders.state.orders[2], undefined);
  assert.equal(app.state.jobs.length, 0);
  assert.equal(reentrantRenders, 0, 'owner notifications never execute within a root updater');
  app.componentWillUnmount();
});
