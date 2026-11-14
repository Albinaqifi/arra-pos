const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(api) {
  class Component { constructor(props) { this.props = props; } setState(update, callback) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); if (callback) callback(); } forceUpdate() {} }
  const context = { React: { Component, Fragment: 'fragment', createElement: (type, props, ...children) => ({type, props: props || {}, children}) }, ReactDOM: { createRoot: () => ({render(){}}) }, document: {getElementById(){}}, window: {arra:api}, crypto: {randomUUID: () => 'send-token'}, setInterval(){}, clearInterval(){}, setTimeout(){}, clearTimeout(){}, renderOrder(){}, renderTables(){}, renderBill(){}, renderMoveTable(){}, ArraComponents:{} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.App=WaiterDemo; this.Jobs=PrintJobs;',context);
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Bill=DesktopBill;',context);
  context.DesktopBill = context.Bill;
  const app = new context.App(); app.componentDidMount();
  arrange(app, {screen:'order', waiter:{id:1,name:'First'}, tableId:1, orders:{1:{id:5,log:[]}}, items:[]});
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
  await app.send(); assert.equal(routeOf(app),'order'); assert.equal(clears,0); assert.match(app.state.toast.msg,/Could not save/);
  outcome='ok'; const sending=app.send(); await tick(); await app.send(); assert.equal(sends,2);
  resolveJobs({ok:true,data:{jobs:[{result:'uncertain'}]}}); await sending;
  assert.equal(routeOf(app),'waiters'); assert.equal(clears,1); assert.match(app.session.state.handoffNotice,/print job needs attention/i);
  await app.session.chooseWaiter({id:2,name:'Next',color:'#123'},''); assert.equal(select,1); assert.equal(routeOf(app),'tables');
});

test('payment uncertainty remains in bill until same selection succeeds, then switches waiter', async () => {
  let calls=[], clear=0, done=false;
  const api={payment:async req=>{calls.push({...req});if(!done){done=true;return {ok:false,uncertain:true,error:'Unknown'};}return {ok:true};},clearWaiter:async()=>{clear++;return {ok:true};},getWaiters:async()=>({ok:true,data:[{id:2,name:'Next',hasPin:false}]}),selectWaiter:async()=>({ok:true}),getMenu:async()=>({ok:true,data:{categories:[],products:[]}}),getTables:async()=>({ok:true,data:[]})};
  const {app,context}=harness(api); app.state.modal={type:'desktopBill'};
  const tree=app.render(), billNode=tree.children[0]; assert.equal(billNode.type,context.Bill);
  const bill=new context.Bill(billNode.props); Object.assign(bill.state,{data:{id:7},method:'card',account:'A'});
  await bill.pay(); assert.equal(routeOf(app),'order'); assert.equal(bill.state.uncertain,true); assert.equal(clear,0);
  await bill.pay(); await tick(); assert.deepEqual(calls[0],calls[1]); assert.equal(calls.length,2); assert.equal(clear,1); assert.equal(routeOf(app),'waiters');
  await app.session.chooseWaiter({id:2,name:'Next'},''); assert.equal(routeOf(app),'tables');
});

test('demo send preserves failed print warning and paid completion returns to selection', async () => {
  const {app}=harness(undefined); arrange(app, {screen:'order',waiter:{name:'Sample'},tableId:1,orders:{1:{rounds:0,log:[]}},items:[{id:'x',tableId:1,status:'pending',qty:1,unit:10,route:'kitchen',cxQty:0}],printers:{kitchen:false,bar:true,A:true,B:true}});
  app.send(); assert.equal(routeOf(app),'waiters'); assert.match(app.session.state.handoffNotice,/ticket did not print/);
  await app.session.chooseWaiter({name:'Next'},''); assert.equal(routeOf(app),'tables'); assert.equal(app.renderVals().hasFailed,true);
  arrange(app, {screen: 'order'}); app.tableOrders.state.tableId=1; app.state.modal={type:'bill',printed:1,method:'Card',account:'A'}; const before=app.state.history.length; app.paid(); assert.equal(routeOf(app),'waiters'); assert.equal(app.state.history.length,before+1); app.paid(); assert.equal(app.state.history.length,before+1);
});


test('navigation cannot interrupt a confirmed send while print status is loading', async () => {
  let release, opened=0, clears=0;
  const api={orderItems:async()=>({ok:true,data:{items:[row('sent')]}}),printJobs:()=>new Promise(r=>{release=r;}),openOrder:async()=>{opened++;return {ok:true,data:{id:6}};},clearWaiter:async()=>{clears++;return {ok:true};},getWaiters:async()=>({ok:true,data:[]})};
  const {app}=harness(api); const sending=app.send(); await tick();
  app.tableOrders.showTables(); await app.tableOrders.openTable(2); await app.session.switchWaiter();
  const controls=app.renderVals(); controls.openBill(); controls.openMoveTable(); controls.goHistory(); app.openCancel(1); app.pending.openNote(1);
  assert.equal(routeOf(app),'order'); assert.equal(app.state.modal,null); assert.equal(opened,0); assert.equal(clears,0);
  release({ok:true,data:{jobs:[]}}); await sending;
  assert.equal(routeOf(app),'waiters'); assert.equal(clears,1);
});

test('a lost print retry response keeps its token through automatic handoff and reselection', async () => {
  let ids=[], committed=new Set(), lost=true, sequence=0;
  const api={printJobs:async req=>{if(req.action==='retry'){ids.push(req.requestId);committed.add(req.requestId);if(lost){lost=false;return {ok:false};}} return {ok:true,data:{jobs:[],printers:[]}};},clearWaiter:async()=>({ok:true}),getWaiters:async()=>({ok:true,data:[{id:2,name:'Next',hasPin:false}]}),selectWaiter:async()=>({ok:true}),getMenu:async()=>({ok:true,data:{categories:[],products:[]}}),getTables:async()=>({ok:true,data:[]})};
  const {app,context}=harness(api); context.crypto.randomUUID=()=>`retry-${++sequence}`;
  function panelFromRender(){const find=x=>{if(!x || typeof x!=='object')return; if(x.type===context.Jobs)return x; for(const child of x.children||[]){const found=find(child);if(found)return found;}}; return new context.Jobs(find(app.render()).props);}
  let panel=panelFromRender(); await panel.retry(12); assert.equal(ids.length,1);
  await app.session.switchWaiter(); await app.session.chooseWaiter({id:2,name:'Next'},'');
  panel=panelFromRender(); await panel.retry(12); assert.deepEqual(ids,['retry-1','retry-1']); assert.equal(committed.size,1);
});
test('demo cancellation never claims a printed notice', async () => {
  for (const printer of [true,false]) {
    const {app}=harness(undefined);
    arrange(app, {screen:'order',waiter:{name:'Sample'},tableId:1,orders:{1:{log:[]}},items:[{id:'x',tableId:1,status:'sent',name:'Dish',qty:2,cxQty:0,cx:[],route:'kitchen'}],printers:{kitchen:printer},modal:{type:'cancel',itemId:'x',qty:1,reason:'Entered by mistake',other:''}});
    await app.confirmCancel(); assert.match(app.state.toast.msg,/Tell preparation staff in person/i); assert.doesNotMatch(app.state.toast.msg,/print/i);
  }
});

test('definite rejection unlocks correction, but an earlier unknown result stays locked', async () => {
  let outcome={ok:false,rejected:true};
  const api={orderItems:async()=>outcome}; const {app}=harness(api);
  const modal=()=>({type:'cancel',itemId:1,qty:1,reason:'Entered by mistake',other:''});
  app.state.modal=modal(); await app.confirmCancel(); assert.equal(app.state.modal.unresolved,false); assert.equal(app.state.modal.requestId,null); assert.match(app.state.modal.error,/rejected/i);
  app.state.modal=modal(); outcome={ok:false}; await app.confirmCancel(); const token=app.state.modal.requestId; assert.equal(app.state.modal.unresolved,true);
  outcome={ok:false,rejected:true}; await app.confirmCancel(); assert.equal(app.state.modal.unresolved,true); assert.equal(app.state.modal.requestId,token); app.renderVals().closeModal(); assert.ok(app.state.modal);
});


test('correction rejection shows safe, translated reasons without changing uncertain retries', async () => {
  let code; const api={orderItems:async()=>({ok:false,rejected:true,code})}; const {app,context}=harness(api);
  const en=JSON.parse(fs.readFileSync(require.resolve('../src/admin/en.json'),'utf8')), sq=JSON.parse(fs.readFileSync(require.resolve('../src/admin/sq.json'),'utf8'));
  context.ArraComponents.translate=(lang,key)=> (lang==='sq'?sq:en)[key] || key;
  const expected={access_denied:['Sign in as a waiter','Hyni si kamarier'],already_billed:['already been billed','tashmë është faturuar'],unavailable:['remaining quantity changed','sasia e mbetur ka ndryshuar'],invalid_input:['details are invalid','të pavlefshme']};
  for(const language of ['en','sq']) for(const [name,texts] of Object.entries(expected)){ code=name; app.settings.state.language=language; app.state.modal={type:'cancel',itemId:1,qty:1,reason:'Entered by mistake',other:''}; await app.confirmCancel(); assert.ok(app.state.modal.error.includes(texts[language==='sq'?1:0]),app.state.modal.error); assert.equal(app.state.modal.requestId,null); }
});
