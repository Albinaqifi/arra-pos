const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('a later simulated success retains the earlier uncertain-output warning', () => {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const context = { React: { Component, createElement: (type, props, ...children) => ({ type, props, children }) }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: {} } };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.PrintJobs = PrintJobs;', context);
  const printing = new context.RendererModules.PrintingSession({ bridge: context.window.arra });
  const panel = new context.PrintJobs({ printing });
  panel.state.jobs = [{ id: 1, destination: 'kitchen', tableId: 1, round: 1, attempts: 2, result: 'success', hadUncertain: 1 }];
  assert.match(JSON.stringify(panel.render()), /earlier attempt was uncertain; duplicate output is possible/);
});

test('correction summary distinguishes the total from the latest event', () => {
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: {} }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo;', context);
  const app = new context.Demo(); arrange(app, {screen: 'order', tableId: 1, orders: {1: {id: 5, log: []}}});
  app.tableOrders.applyConfirmedItems(app.tableOrders.captureTarget(), [{ id: 1, productId: 'p', name: 'Dish', unitPrice: 10, quantity: 4, note: '', status: 'sent', round: 1, sentAt: 1, sentBy: 'Waiter', route: 'kitchen', correctedQuantity: 3, corrections: [{ quantity: 2, reason: 'First', actor: 'One', occurredAt: 2 }, { quantity: 1, reason: 'Second', actor: 'Two', occurredAt: 3 }] }]);
  const text = app.renderVals().rounds[0].items[0].cxText;
  assert.match(text, /3 cancelled total · latest: 1 · Second · Two/);
});

test('desktop screen loads and saves items, shows failures, and does not send demo orders', async () => {
  let rows = [], fail = false, reject = false, release;
  const api = {
    getMenu: async () => ({ ok: true, data: { categories: [{ id: 'food', name: 'Food' }], products: [{ id: 'p', categoryId: 'food', name: 'Dish', price: 120 }] } }),
    getTables: async () => ({ ok: true, data: [{ id: 1, area: 'Inside', orderId: 3, openedAt: 1 }] }),
    openOrder: async () => ({ ok: true, data: { id: 3, tableId: 1, openedAt: 1 } }),
    orderItems: async (action, order, value) => {
      assert.equal(order, 3);
      if (action === 'send') return {ok: false};
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
  const context = { crypto: { randomUUID: () => 'request-id' }, React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo;', context);
  const load = async () => { const app = new context.Demo(); app.componentDidMount(); app.loadDesktopData(); await new Promise(resolve => setImmediate(resolve)); await app.tableOrders.openTable(1); return app; };
  let app = await load();
  await app.pending.addProduct('p'); await app.pending.incItem(7);
  assert.equal(app.tableOrders.state.items[0].qty, 2);
  app.pending.openNote(7); app.pending.state.dialog.text = 'Less salt'; await app.pending.saveNote();
  assert.equal(app.tableOrders.state.items[0].note, 'Less salt');
  app.pending.openNote(7); app.pending.state.dialog.text = 'Changed'; fail = true; await app.pending.saveNote();
  assert.equal(app.pending.state.dialog.text, 'Changed'); assert.match(app.pending.view().modalSub, /Could not save note/);
  fail = false; reject = true; await app.pending.saveNote();
  assert.equal(app.pending.state.dialog.saving, false); assert.equal(app.pending.state.dialog.text, 'Changed');
  assert.match(app.pending.view().modalSub, /Could not save note/);
  reject = false; release = true;
  const pending = app.pending.saveNote();
  assert.equal(app.pending.view().noteSaving, true);
  app.pending.dismiss(); assert.equal(app.pending.state.dialog.text, 'Changed');
  release(); await pending; release = null;
  assert.equal(app.tableOrders.state.items[0].note, 'Changed'); assert.equal(app.pending.state.dialog, null);
  app.send(); assert.equal(app.tableOrders.state.items[0].status, 'pending');
  app = await load(); assert.equal(app.tableOrders.state.items[0].qty, 2); assert.equal(app.tableOrders.state.items[0].note, 'Changed'); assert.match(app.renderVals().total, /240/);
  fail = true; await app.pending.removeItem(7); assert.equal(app.tableOrders.state.items.length, 1); assert.match(app.state.toast.msg, /Could not save/);
  fail = false; await app.pending.removeItem(7); assert.equal(app.tableOrders.state.items.length, 0);
});
test('modifier dialog locks during save, closes after success and remains retryable after failure', async () => {
  let resolveSave, calls = 0;
  const api = {
    getMenu: async () => ({ ok:true, data:{ categories:[{id:'food',name:'Food'}], products:[{id:'p',categoryId:'food',name:'Dish',price:120}], groups:[{id:'g',productId:'p',name:'Size',required:1}], options:[{id:'o',groupId:'g',name:'Large',adjustment:10}] } }),
    getTables: async () => ({ ok:true, data:[{id:1,area:'Inside',orderId:3,openedAt:1}] }),
    openOrder: async () => ({ok:true,data:{id:3,tableId:1,openedAt:1}}),
    orderItems: async action => action === 'list' ? {ok:true,data:{items:[],total:0}} : (calls++, await new Promise(resolve => { resolveSave = resolve; }))
  };
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React:{Component,createElement(){}}, ReactDOM:{createRoot(){return {render(){}};}}, document:{getElementById(){}}, window:{arra:api}, setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){} };
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo = WaiterDemo;',context);
  const app = new context.Demo(); app.componentDidMount(); app.loadDesktopData(); await new Promise(resolve => setImmediate(resolve)); await app.tableOrders.openTable(1);
  app.pending.addProduct('p'); app.pending.view().modGroups[0].options[0].pick();
  const pending=app.pending.modAdd(); assert.equal(calls,1); assert.equal(app.pending.view().modAddDisabled,true); assert.equal(app.pending.view().modGroups[0].options[0].disabled,true);
  app.pending.dismiss(); app.pending.view().modGroups[0].options[0].pick(); await app.pending.modAdd(); assert.equal(calls,1); assert.equal(app.pending.state.dialog.sel.g,0);
  resolveSave({ok:false}); await pending; assert.equal(app.pending.state.dialog.saving,false); assert.equal(app.pending.state.dialog.sel.g,0);
  const retry=app.pending.modAdd(); assert.equal(calls,2); resolveSave({ok:true,data:{items:[{id:1,productId:'p',name:'Dish',unitPrice:130,quantity:1,note:'',modifiers:[]}],total:130}}); await retry;
  assert.equal(app.pending.state.dialog,null); assert.equal(app.tableOrders.state.items.length,1);
});

test('a replay after a lost send response warns that newly added items remain pending', async () => {
  let rows = [], round = false, first = true, nextId = 1, token = 0; const sends = [];
  const api = {
    clearWaiter: async () => ({ok:true}), getWaiters: async () => ({ok:true,data:[{id:1,name:'Sample',hasPin:false}]}), selectWaiter: async () => ({ok:true}), printJobs: async () => ({ok:true,data:{jobs:[]}}),
    getMenu: async () => ({ok:true,data:{categories:[{id:'c',name:'Food'}],products:[{id:'p',categoryId:'c',name:'Dish',price:10}]}}),
    getTables: async () => ({ok:true,data:[{id:1,area:'Inside',orderId:3,openedAt:1}]}),
    openOrder: async () => ({ok:true,data:{id:3,tableId:1,openedAt:1}}),
    orderItems: async (action, order, value) => {
      if (action === 'add') rows.push({id:nextId++,productId:'p',name:'Dish',unitPrice:10,quantity:1,note:'',status:'pending'});
      if (action === 'send') {
        sends.push(value);
        if (!round || value !== sends[0]) { rows = rows.map(i => i.status === 'pending' ? {...i,status:'sent',round:round ? 2 : 1,sentAt:1,sentBy:'waiter',route:'kitchen'} : i); round = true; }
        if (first) { first = false; return {ok:false}; }
      }
      return {ok:true,data:{items:rows.map(x=>({...x})),total:rows.length*10}};
    }
  };
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context={crypto:{randomUUID:()=>`request-${++token}`},React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}};}},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo = WaiterDemo;',context);
  const app=new context.Demo(); app.componentDidMount(); app.loadDesktopData(); await new Promise(resolve=>setImmediate(resolve)); await app.tableOrders.openTable(1);
  await app.pending.addProduct('p'); await app.send(); await app.pending.addProduct('p'); await app.send();
  assert.equal(sends[0],sends[1]); assert.equal(routeOf(app),'waiters'); assert.match(app.session.state.handoffNotice,/still pending/);
  await app.session.chooseWaiter({id:1,name:'Sample',color:'#123'},''); await app.tableOrders.openTable(1); assert.equal(app.tableOrders.state.items[1].status,'pending');
  await app.send(); assert.notEqual(sends[2],sends[1]); assert.equal(routeOf(app),'waiters'); assert.equal(rows[1].status,'sent'); assert.match(app.session.state.handoffNotice,/No physical ticket/);
});
