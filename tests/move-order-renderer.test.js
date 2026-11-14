const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
test('move dialog retains retry token and updates the displayed order only after success', async () => {
  const calls=[]; let fail=true;
  const api={moveOrder:async (...args)=>{ calls.push(args); return {ok:!fail}; }, getTables:async()=>({ok:true,data:[{id:1,orderId:10,openedAt:1},{id:2,orderId:null,openedAt:null},{id:3,orderId:11,openedAt:2}]})};
  class Component { setState(update) { Object.assign(this.state,typeof update==='function'?update(this.state):update); } }
  const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo = WaiterDemo;',context);
  const app=new context.Demo(); app.componentDidMount();
  arrange(app, {screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2,3]}],orders:{1:{id:10,openedAt:1,log:[]},3:{id:11,openedAt:2,log:[]}},items:[{id:8,tableId:1,status:'pending',qty:1,unit:100,cxQty:0,name:'Dish'}],modal:{type:'moveTable',dest:null}});
  let v=app.moveWorkflow.view(); assert.equal(v.mtTables.find(x=>x.num==='3').disabled,true);
  v.mtTables.find(x=>x.num==='2').pick(); await app.moveWorkflow.confirm();
  assert.equal(app.tableOrders.state.tableId,1); assert.match(app.moveWorkflow.state.dialog.error,/not moved/); app.moveWorkflow.view().mtTables.find(x=>x.num==='2').pick();
  fail=false; await app.moveWorkflow.confirm(); assert.equal(calls.length,2); assert.deepEqual(calls[0],calls[1]);
  assert.equal(app.tableOrders.state.tableId,2); assert.equal(app.tableOrders.state.orders[2].id,10); assert.equal(app.tableOrders.state.orders[1],undefined); assert.equal(app.tableOrders.state.items[0].tableId,2); assert.equal(app.moveWorkflow.state.dialog,null);
});


test('lost move response reconciles committed move or locks navigation until retry', async () => {
  let tableResult={ok:false}; let calls=0, itemWrites=0, waiterClears=0;
  const api={moveOrder:async()=>{calls++; return {ok:false};},getTables:async()=>tableResult,orderItems:async()=>{itemWrites++;return {ok:false};},clearWaiter:async()=>{waiterClears++;return {ok:true};}};
  class Component { setState(update) { Object.assign(this.state,typeof update==='function'?update(this.state):update); } }
  const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo = WaiterDemo;',context);
  const app=new context.Demo(); app.componentDidMount();
  arrange(app, {screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2,3]}],orders:{1:{id:10,openedAt:1,log:[]}},items:[{id:8,tableId:1,status:'pending',qty:1,unit:100,cxQty:0,name:'Dish'},{id:9,tableId:1,status:'sent',qty:1,unit:100,cxQty:0,cx:[],round:1,sentAt:1,name:'Sent dish'}],modal:{type:'moveTable',dest:2}});
  await app.moveWorkflow.confirm(); assert.equal(app.moveWorkflow.state.dialog.unresolved,true);
  app.moveWorkflow.dismiss(); app.tableOrders.showTables(); app.moveWorkflow.view().mtTables.find(x=>x.num==='3').pick();
  assert.equal(app.moveWorkflow.state.dialog.dest,2); assert.equal(routeOf(app),'order'); assert.equal(calls,1);
  await app.sendWorkflow.send(); await app.pending.incItem(8); app.pending.openNote(8); app.correction.open(9); app.renderVals().openBill(); await app.session.switchWaiter();
  assert.equal(itemWrites,0); assert.equal(waiterClears,0); assert.equal(app.pending.state.dialog,null); assert.equal(app.billing.state.desktop, null); assert.equal(app.demoBilling.state.dialog, null);
  assert.equal(app.moveWorkflow.state.dialog.unresolved,true); assert.equal(app.moveWorkflow.state.dialog.dest,2);
  tableResult={ok:true,data:[{id:1,orderId:null,openedAt:null},{id:2,orderId:10,openedAt:1},{id:3,orderId:null,openedAt:null}]};
  await app.moveWorkflow.confirm(); assert.equal(app.tableOrders.state.tableId,2); assert.equal(app.tableOrders.state.orders[1],undefined); assert.equal(app.tableOrders.state.orders[2].id,10); assert.equal(app.moveWorkflow.state.dialog,null);
});
test('moving an empty order refreshes its destination availability', async () => {
 const api={moveOrder:async()=>({ok:true}),getTables:async()=>({ok:true,data:[{id:2,orderId:10,untouched:true}]})}; class Component {setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u);}}
 const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo=WaiterDemo;',context);
 const app=new context.Demo();app.componentDidMount(); arrange(app, {screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2]}],orders:{1:{id:10,openedAt:1,log:[],untouched:true}},items:[],modal:{type:'moveTable',dest:2}});
 await app.moveWorkflow.confirm(); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[1].free,true);
});
test('a sent order moved and then fully corrected shows its destination free', async () => {
 let corrected=false; const api={moveOrder:async()=>({ok:true}),getTables:async()=>({ok:true,data:[{id:2,orderId:10,openedAt:1,untouched:corrected}]}),orderItems:async()=>{corrected=true;return {ok:true,data:{items:[{id:8,productId:'p',name:'Dish',unitPrice:100,quantity:1,status:'sent',correctedQuantity:1}]}};}};
 class Component {setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u);}}
 const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo=WaiterDemo;',context);const app=new context.Demo();app.componentDidMount(); arrange(app, {screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2]}],orders:{1:{id:10,openedAt:1,log:[],untouched:false}},items:[{id:8,tableId:1,status:'sent',qty:1,unit:100,cxQty:0}],modal:{type:'moveTable',dest:2}});
 await app.moveWorkflow.confirm(); assert.equal(app.tableOrders.state.orders[2].untouched,false); arrange(app, {modal:{type:'cancel',itemId:8,qty:1,reason:'Mistake'}}); await app.correction.confirm(); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[1].free,true);
});
test('moving a fully corrected source reconciles availability even when the move response is lost', async () => {
 for (const lost of [false,true]) {
  let requests=0; const api={moveOrder:async()=>({ok:!lost}),getTables:async()=>{requests++;return {ok:true,data:[{id:2,orderId:10,openedAt:1,untouched:true}]};}};
  class Component {setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u);}} const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo=WaiterDemo;',context);const app=new context.Demo();app.componentDidMount();arrange(app, {screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2]}],orders:{1:{id:10,openedAt:1,log:[],untouched:true}},items:[{id:8,tableId:1,status:'sent',qty:1,unit:100,cxQty:1,cx:[],round:1,sentAt:1}],modal:{type:'moveTable',dest:2}});
  await app.moveWorkflow.confirm(); app.tableOrders.showTables(); assert.equal(app.tableOrders.tableView({language:app.settings.state.language}).sections[0].tables[1].free,true); assert.equal(requests,1);
 }
});
