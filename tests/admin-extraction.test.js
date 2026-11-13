const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, registerSession } = require('../src/desktop/session');
const { registerTableConfig } = require('../src/desktop/table-config');
const { registerMenuConfig } = require('../src/desktop/menu-config');
const { registerEmployeeConfig } = require('../src/desktop/employee-config');
const { registerOrderHistory } = require('../src/desktop/order-history');
const { registerFinancialVisibility } = require('../src/desktop/financial-visibility');
const { registerOperationalReports } = require('../src/desktop/operational-reports');
const { seedSampleIdentities } = require('../src/desktop/sample-accounts');
const { randomBytes, randomInt } = require('node:crypto');
test('navigation capability follows trusted grants and direct services deny an ordinary waiter', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-admin-access-'));
  const db = openDatabase(dir); t.after(() => { db.close(); fs.rmSync(dir, { recursive:true, force:true }); });
  bootstrap(db, 'sample', 'sample password');
  const passwords=Array.from({length:4},()=>randomBytes(24).toString('hex'));
  const pin=String(randomInt(10000)).padStart(4,'0');
  seedSampleIdentities(db,passwords,pin,String(randomInt(1000000)).padStart(6,'0'));
  const waiter=db.prepare("SELECT id FROM local_users WHERE username='sample-waiter'").get().id;
  const handlers = {}, trusted = {}, ipc = { handle(c, f) { handlers[c] = f; } }, allowed = e => e === trusted;
  const session = registerSession(ipc, allowed, db);
  for (const register of [registerTableConfig, registerMenuConfig, registerEmployeeConfig, registerOrderHistory, registerFinancialVisibility, registerOperationalReports]) register(ipc, allowed, db, session);
  const call = (channel, request, event=trusted) => handlers['arra:'+channel](event, request);
  assert.equal(call('sign-in', { username:'sample', password:'sample password' }).ok, true);
  assert.equal(call('sign-in', { username:'sample', password:'sample password' }).admin, true);
  assert.equal(call('admin-access', {}).admin, true);
  assert.equal(call('admin-access', {}, {}).ok, false);
  assert.equal(call('admin-access', {extra:true}).ok, false);
  assert.equal(call('select-waiter', {id:1,pin:''}, {}).ok, false);
  assert.equal(call('sign-in',{username:'sample-restaurant',password:passwords[0]}).ok,true);
  assert.equal(call('select-waiter',{id:waiter,pin}).ok,true);
  assert.equal(call('admin-access', {}).admin, false);
  assert.equal(call('select-waiter', {id:waiter,pin}).admin, false);
  for (const [channel, request] of [['table-config',{action:'list'}],['menu-config',{action:'list'}],['employee-config',{action:'list'}],['order-history',{orderId:null}],['financial-visibility',{action:'search',account:null}],['operational-reports',{from:0,to:1,account:null}]]) assert.equal(call(channel, request).ok, false, channel);
  session.signOut();
  assert.deepEqual(call('admin-access', {}), {ok:true,signedIn:false,selected:false,admin:false});
});
test('switching immediately removes administration while a prior protected response is pending', async () => {
  let releaseClear, releaseList;
  const api = { clearWaiter: () => new Promise(r => releaseClear=r), getWaiters: async () => ({ok:true,data:[]}), tableConfig: () => new Promise(r => releaseList=r) };
  class Component { constructor(props){ this.props=props; } setState(update){ Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const React = {Component, Fragment:'fragment', createElement(type,props,...children){return {type,props:props||{},children};}};
  const ctx={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(),ctx);
  vm.runInNewContext(require('./support/waiter-views')() + fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo=WaiterDemo;',ctx);
  const app=new ctx.Demo(); app.setState({screen:'tableConfig',adminAccess:true,waiter:{name:'Admin'}});
  const pageElement=app.render().children[0], page=new pageElement.type(pageElement.props);
  const pending=page.load(), switching=app.switchWaiter();
  assert.equal(app.state.screen,'waiters'); assert.equal(app.state.adminAccess,false);
  releaseList({ok:true,data:{areas:[{name:'protected'}],tables:[]}}); await pending;
  assert.doesNotMatch(JSON.stringify(app.render()), /protected|Administration →/);
  releaseClear({ok:true}); await switching;
  app.setState({screen:'tables',waiter:{name:'Waiter'}});
  assert.doesNotMatch(JSON.stringify(app.render()), /protected|Administration →/);
});
test('switch blocks selection and sign-out until clear and waiter loading finish, including failure', async () => {
  for (const success of [true, false]) {
    let releaseClear, releaseWaiters, selected=0, signedOut=0;
    const api={clearWaiter:()=>new Promise(r=>releaseClear=r),getWaiters:()=>new Promise(r=>releaseWaiters=r), selectWaiter:async()=>{selected++;return {ok:true}},signOut:async()=>{signedOut++;return {ok:true}}};
    class Component {constructor(props){this.props=props} setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u)}}
    const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
    const ctx={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},clearTimeout(){}};
    vm.runInNewContext(require('./support/admin-bundle')(),ctx); vm.runInNewContext(require('./support/waiter-views')() + fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo=WaiterDemo;',ctx);
    const app=new ctx.Demo(); app.setState({screen:'admin',adminAccess:true,waiter:{name:'Admin'}});
    const pending=app.switchWaiter();
    app.pickWaiter({id:2,name:'Waiter',pin:true}); await app.chooseWaiter({id:2},''); await app.signOut();
    assert.equal(selected,0); assert.equal(signedOut,0); assert.equal(app.state.screen,'waiters'); assert.equal(app.state.switching,true);
    releaseClear({ok:success});
    if (success) { await new Promise(setImmediate); await app.chooseWaiter({id:2},''); await app.signOut(); assert.equal(selected,0); assert.equal(signedOut,0); releaseWaiters({ok:true,data:[]}); }
    await pending; assert.equal(app.state.switching,false);
    if (!success) assert.match(app.state.waiterMessage,/Could not switch/);
    await app.signOut(); assert.equal(signedOut,1); assert.equal(app.state.screen,'login');
  }
});
test('employee mutation rechecks access and removes revoked or invalidated sessions', async () => {
  for (const result of [{ok:true,signedIn:true,selected:true,admin:false},{ok:true,signedIn:false,selected:false,admin:false}]) {
    let menuLoads=0, tableLoads=0;
    const api={employeeConfig:async()=>({ok:true}),adminAccess:async()=>result, getMenu:async()=>{menuLoads++;return {ok:true,data:{categories:[],products:[]}}},getTables:async()=>{tableLoads++;return {ok:true,data:[{id:42,area:'Sample',orderId:null}]}}};
    class Component {constructor(props){this.props=props} setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u)}}
    const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
    const ctx={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},clearTimeout(){}};
    vm.runInNewContext(require('./support/admin-bundle')(),ctx); vm.runInNewContext(require('./support/waiter-views')() + fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo=WaiterDemo;',ctx);
    const app=new ctx.Demo(); app.componentDidMount(); app.setState({screen:'employeeConfig',adminAccess:true,waiter:{id:1,name:'Admin'}});
    const element=app.render().children[0], page=new element.type(element.props); await page.save({action:'permissions'});
    assert.equal(app.state.adminAccess,false); assert.equal(app.state.screen,result.signedIn?'tables':'login');
    await new Promise(setImmediate);
    assert.equal(menuLoads,result.signedIn?1:0); assert.equal(tableLoads,result.signedIn?1:0);
    if (result.signedIn) { assert.equal(app.state.tableLoad,'ready'); assert.equal(app.state.sections[0].ids[0],42); }
  }
});
