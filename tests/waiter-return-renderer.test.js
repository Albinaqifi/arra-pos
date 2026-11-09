const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(api) {
  class Component { constructor(props) { this.props = props; } setState(update, callback) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); if (callback) callback(); } forceUpdate() {} }
  const context = { React: { Component, Fragment: 'fragment', createElement: (type, props, ...children) => ({type, props: props || {}, children}) }, ReactDOM: { createRoot: () => ({render(){}}) }, document: {getElementById(){}}, window: {arra:api}, crypto: {randomUUID: () => 'send-token'}, setInterval(){}, clearInterval(){}, setTimeout(){}, clearTimeout(){}, renderOrder(){}, renderTables(){}, renderBill(){}, renderMoveTable(){}, ArraComponents:{} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8') + '\nthis.App=WaiterDemo; this.Jobs=PrintJobs;',context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/waiter/DesktopBill.js'),'utf8') + '\nthis.Bill=DesktopBill;',context);
  context.DesktopBill = context.Bill;
  const app = new context.App(); app.componentDidMount();
  Object.assign(app.state, {screen:'order', waiter:{id:1,name:'First'}, tableId:1, orders:{1:{id:5,log:[]}}, items:[]});
  return {app, context};
}
const row = status => ({id:1,productId:'p',name:'Dish',unitPrice:10,quantity:1,status,note:'',modifiers:[]});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('confirmed send switches identity and shows a print issue; failed send stays for retry', async () => {
  let sends=0, clears=0, select=0, outcome='fail', resolveJobs;
  const api = {orderItems: async () => {sends++; return outcome==='fail' ? {ok:false} : {ok:true,data:{items:[row('sent')]}};},
    printJobs: () => new Promise(resolve => {resolveJobs=resolve;}), clearWaiter: async () => {clears++; return {ok:true};},
    getWaiters: async () => ({ok:true,data:[{id:2,name:'Next',hasPin:false}]}), selectWaiter: async () => {select++; return {ok:true};},
    getMenu: async () => ({ok:true,data:{categories:[],products:[]}}), getTables: async () => ({ok:true,data:[]})};
  const {app}=harness(api);
  await app.send(); assert.equal(app.state.screen,'order'); assert.equal(clears,0); assert.match(app.state.toast.msg,/Could not save/);
  outcome='ok'; const sending=app.send(); await tick(); await app.send(); assert.equal(sends,2);
  resolveJobs({ok:true,data:{jobs:[{result:'uncertain'}]}}); await sending;
  assert.equal(app.state.screen,'waiters'); assert.equal(clears,1); assert.match(app.state.handoffNotice,/print job needs attention/i);
  await app.chooseWaiter({id:2,name:'Next',color:'#123'},''); assert.equal(select,1); assert.equal(app.state.screen,'tables');
});

test('payment uncertainty remains in bill until same selection succeeds, then switches waiter', async () => {
  let calls=[], clear=0, done=false;
  const api={payment:async req=>{calls.push({...req});if(!done){done=true;return {ok:false,uncertain:true,error:'Unknown'};}return {ok:true};},clearWaiter:async()=>{clear++;return {ok:true};},getWaiters:async()=>({ok:true,data:[{id:2,name:'Next',hasPin:false}]}),selectWaiter:async()=>({ok:true}),getMenu:async()=>({ok:true,data:{categories:[],products:[]}}),getTables:async()=>({ok:true,data:[]})};
  const {app,context}=harness(api); app.state.modal={type:'desktopBill'};
  const tree=app.render(), billNode=tree.children[0]; assert.equal(billNode.type,context.Bill);
  const bill=new context.Bill(billNode.props); Object.assign(bill.state,{data:{id:7},method:'card',account:'A'});
  await bill.pay(); assert.equal(app.state.screen,'order'); assert.equal(bill.state.uncertain,true); assert.equal(clear,0);
  await bill.pay(); await tick(); assert.deepEqual(calls[0],calls[1]); assert.equal(calls.length,2); assert.equal(clear,1); assert.equal(app.state.screen,'waiters');
  await app.chooseWaiter({id:2,name:'Next'},''); assert.equal(app.state.screen,'tables');
});

test('demo send preserves failed print warning and paid completion returns to selection', async () => {
  const {app}=harness(undefined); Object.assign(app.state,{screen:'order',waiter:{name:'Sample'},tableId:1,orders:{1:{rounds:0,log:[]}},items:[{id:'x',tableId:1,status:'pending',qty:1,unit:10,route:'kitchen',cxQty:0}],printers:{kitchen:false,bar:true,A:true,B:true}});
  app.send(); assert.equal(app.state.screen,'waiters'); assert.match(app.state.handoffNotice,/ticket did not print/);
  await app.chooseWaiter({name:'Next'},''); assert.equal(app.state.screen,'tables'); assert.equal(app.renderVals().hasFailed,true);
  app.state.screen='order'; app.state.tableId=1; app.state.modal={type:'bill',printed:1,method:'Card',account:'A'}; const before=app.state.history.length; app.paid(); assert.equal(app.state.screen,'waiters'); assert.equal(app.state.history.length,before+1); app.paid(); assert.equal(app.state.history.length,before+1);
});


test('navigation cannot interrupt a confirmed send while print status is loading', async () => {
  let release, opened=0, clears=0;
  const api={orderItems:async()=>({ok:true,data:{items:[row('sent')]}}),printJobs:()=>new Promise(r=>{release=r;}),openOrder:async()=>{opened++;return {ok:true,data:{id:6}};},clearWaiter:async()=>{clears++;return {ok:true};},getWaiters:async()=>({ok:true,data:[]})};
  const {app}=harness(api); const sending=app.send(); await tick();
  app.goTables(); await app.openTable(2); await app.switchWaiter();
  const controls=app.renderVals(); controls.openBill(); controls.openMoveTable(); controls.goHistory(); app.openCancel(1); app.openNote(1);
  assert.equal(app.state.screen,'order'); assert.equal(app.state.modal,null); assert.equal(opened,0); assert.equal(clears,0);
  release({ok:true,data:{jobs:[]}}); await sending;
  assert.equal(app.state.screen,'waiters'); assert.equal(clears,1);
});

test('a lost print retry response keeps its token through automatic handoff and reselection', async () => {
  let ids=[], committed=new Set(), lost=true, sequence=0;
  const api={printJobs:async req=>{if(req.action==='retry'){ids.push(req.requestId);committed.add(req.requestId);if(lost){lost=false;return {ok:false};}} return {ok:true,data:{jobs:[],printers:[]}};},clearWaiter:async()=>({ok:true}),getWaiters:async()=>({ok:true,data:[{id:2,name:'Next',hasPin:false}]}),selectWaiter:async()=>({ok:true}),getMenu:async()=>({ok:true,data:{categories:[],products:[]}}),getTables:async()=>({ok:true,data:[]})};
  const {app,context}=harness(api); context.crypto.randomUUID=()=>`retry-${++sequence}`;
  function panelFromRender(){const find=x=>{if(!x || typeof x!=='object')return; if(x.type===context.Jobs)return x; for(const child of x.children||[]){const found=find(child);if(found)return found;}}; return new context.Jobs(find(app.render()).props);}
  let panel=panelFromRender(); await panel.retry(12); assert.equal(ids.length,1);
  await app.switchWaiter(); await app.chooseWaiter({id:2,name:'Next'},'');
  panel=panelFromRender(); await panel.retry(12); assert.deepEqual(ids,['retry-1','retry-1']); assert.equal(committed.size,1);
});
