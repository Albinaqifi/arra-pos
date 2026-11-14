const { arrange, routeOf } = require('./support/renderer-fixture');
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
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo;', context);
  const load = async () => { const app = new context.Demo(); app.componentDidMount(); app.loadDesktopData(); await new Promise(resolve => setImmediate(resolve)); return app; };
  let app = await load();
  assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].free, true);
  failItems = true; await app.tableOrders.openTable(1);
  assert.equal(routeOf(app), 'login');
  // The service fixture below represents an already selected waiter; account
  // entry is now owned separately from the table/order route under test.
  app.session.state.screen = 'waiter';
  assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken, true);
  assert.match(app.state.toast.msg, /Could not load order items/);
  failItems = false;
  await app.tableOrders.openTable(1);
  assert.equal(routeOf(app), 'order'); assert.equal(app.tableOrders.state.orders[1].id, 5);
  app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken, true);
  app = await load();
  app.session.state.screen = 'waiter';
  let card = app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0];
  assert.equal(card.taken, true); assert.equal(card.total, '—');
  assert.equal(card.count, 'Open to view items'); assert.equal(card.hasUnsent, false);
  assert.doesNotMatch(card.aria, /0/);
  await app.tableOrders.openTable(1); assert.equal(app.tableOrders.state.orders[1].id, 5);
  app.tableOrders.showTables(); card = app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0];
  assert.match(card.total, /240/); assert.equal(card.count, '2 items'); assert.equal(card.unsent, '2 not sent');
  fail = true; await app.tableOrders.openTable(1);
  assert.equal(routeOf(app), 'tables'); assert.match(app.state.toast.msg, /Could not open/);
});
test('desktop leaves untouched tables free and keeps failed item saves free', async () => {
 let added=false, failSave=true, loseResponse=false;
 const api={getMenu:async()=>({ok:true,data:{categories:[{id:'food',name:'Food'}],products:[{id:'p',name:'Dish',categoryId:'food',price:100}]}}),getTables:async()=>({ok:true,data:[{id:1,area:'Inside',orderId:5,openedAt:1,untouched:!added}]}),openOrder:async()=>({ok:true,data:{id:5,tableId:1,openedAt:1,untouched:!added}}),orderItems:async action=>{if(action==='add'){if(failSave)return {ok:false}; added=true; if(loseResponse) return {ok:false};} return {ok:true,data:{items:added?[{id:1,productId:'p',name:'Dish',unitPrice:100,quantity:1,status:'pending'}]:[]}};}};
 class Component {setState(update){Object.assign(this.state,typeof update==='function'?update(this.state):update);}}
 const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}};}},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo=WaiterDemo;',context);
 const load=async()=>{const app=new context.Demo();app.componentDidMount();app.loadDesktopData();await new Promise(resolve=>setImmediate(resolve));return app;};
 let app=await load(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].free,true); await app.tableOrders.openTable(1); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].free,true);
 await app.tableOrders.openTable(1); await app.pending.addProduct('p'); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken,true); app=await load(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].free,true);
 await app.tableOrders.openTable(1); failSave=false; loseResponse=true; await app.pending.addProduct('p'); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken,true);
 app=await load(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken,true);
});
test('removing the last pending item refreshes availability; an uncertain refresh stays taken', async () => {
 let hasItem=true, failTables=false, loseRemoval=false;
 const api={openOrder:async()=>({ok:true,data:{id:5,tableId:1,openedAt:1,untouched:!hasItem}}),getTables:async()=>failTables?{ok:false}:{ok:true,data:[{id:1,area:'Inside',orderId:5,openedAt:1,untouched:!hasItem}]}, orderItems:async action=>{if(action==='remove'){hasItem=false; if(loseRemoval)return {ok:false};}return {ok:true,data:{items:hasItem?[{id:1,productId:'p',name:'Dish',unitPrice:100,quantity:1,status:'pending'}]:[]}};}};
 class Component {setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u);}}
 const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo=WaiterDemo;',context);
 const app=new context.Demo(); app.componentDidMount(); arrange(app, {screen:'tables',sections:[{label:'Inside',ids:[1]}],orders:{1:{id:5,openedAt:1,untouched:false,log:[]}}});
 await app.tableOrders.openTable(1); await app.pending.removeItem(1); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].free,true);
 hasItem=true; await app.tableOrders.openTable(1); failTables=true; await app.pending.removeItem(1); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken,true);
 hasItem=true; failTables=false; await app.tableOrders.openTable(1); loseRemoval=true; await app.pending.removeItem(1); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken,true);
});
test('correcting the final sent item refreshes the card and preserves uncertainty', async () => {
 let available=false, failTables=false, loseResponse=false;
 const api={getTables:async()=>failTables?{ok:false}:{ok:true,data:[{id:1,orderId:5,openedAt:1,untouched:available}]},orderItems:async()=>{available=true;if(loseResponse)return {ok:false};return {ok:true,data:{items:[{id:1,productId:'p',name:'Dish',unitPrice:100,quantity:1,status:'sent',correctedQuantity:1}]}};}};
 class Component {setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u);}}
 const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'correction-token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo=WaiterDemo;',context);
 const app=new context.Demo();app.componentDidMount(); const init=()=>arrange(app, {screen:'order',tableId:1,sections:[{label:'Inside',ids:[1]}],orders:{1:{id:5,openedAt:1,untouched:false,log:[]}},items:[{id:1,tableId:1,status:'sent',qty:1,unit:100,cxQty:0}],modal:{type:'cancel',itemId:1,qty:1,reason:'Mistake'}});
 init(); await app.confirmCancel(); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].free,true);
 init(); failTables=true; await app.confirmCancel(); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[0].taken,true);
 init(); failTables=false; loseResponse=true; await app.confirmCancel(); app.tableOrders.showTables(); assert.equal(routeOf(app),'order'); assert.equal(app.state.modal.unresolved,true);
});
