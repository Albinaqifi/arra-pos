const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
test('move dialog retains retry token and updates the displayed order only after success', async () => {
  const calls=[]; let fail=true;
  const api={moveOrder:async (...args)=>{ calls.push(args); return {ok:!fail}; }, getTables:async()=>({ok:true,data:[{id:1,orderId:10,openedAt:1},{id:2,orderId:null,openedAt:null},{id:3,orderId:11,openedAt:2}]})};
  class Component { setState(update) { Object.assign(this.state,typeof update==='function'?update(this.state):update); } }
  const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo = WaiterDemo;',context);
  const app=new context.Demo(); app.componentDidMount();
  Object.assign(app.state,{screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2,3]}],orders:{1:{id:10,openedAt:1,log:[]},3:{id:11,openedAt:2,log:[]}},items:[{id:8,tableId:1,status:'pending',qty:1,unit:100,cxQty:0,name:'Dish'}],modal:{type:'moveTable',dest:null}});
  let v=app.renderVals(); assert.equal(v.mtTables.find(x=>x.num==='3').disabled,true);
  v.mtTables.find(x=>x.num==='2').pick(); await app.confirmMoveTable();
  assert.equal(app.state.tableId,1); assert.match(app.state.modal.error,/not moved/); app.renderVals().mtTables.find(x=>x.num==='2').pick();
  fail=false; await app.confirmMoveTable(); assert.equal(calls.length,2); assert.deepEqual(calls[0],calls[1]);
  assert.equal(app.state.tableId,2); assert.equal(app.state.orders[2].id,10); assert.equal(app.state.orders[1],undefined); assert.equal(app.state.items[0].tableId,2); assert.equal(app.state.modal,null);
});


test('lost move response reconciles committed move or locks navigation until retry', async () => {
  let tableResult={ok:false}; let calls=0;
  const api={moveOrder:async()=>{calls++; return {ok:false};},getTables:async()=>tableResult};
  class Component { setState(update) { Object.assign(this.state,typeof update==='function'?update(this.state):update); } }
  const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo = WaiterDemo;',context);
  const app=new context.Demo(); app.componentDidMount();
  Object.assign(app.state,{screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2,3]}],orders:{1:{id:10,openedAt:1,log:[]}},items:[],modal:{type:'moveTable',dest:2}});
  await app.confirmMoveTable(); assert.equal(app.state.modal.unresolved,true);
  app.renderVals().closeModal(); app.goTables(); app.renderVals().mtTables.find(x=>x.num==='3').pick();
  assert.equal(app.state.modal.dest,2); assert.equal(app.state.screen,'order'); assert.equal(calls,1);
  tableResult={ok:true,data:[{id:1,orderId:null,openedAt:null},{id:2,orderId:10,openedAt:1},{id:3,orderId:null,openedAt:null}]};
  await app.confirmMoveTable(); assert.equal(app.state.tableId,2); assert.equal(app.state.orders[1],undefined); assert.equal(app.state.orders[2].id,10); assert.equal(app.state.modal,null);
});
