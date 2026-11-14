const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { openDatabase: realOpenDatabase } = require('../src/desktop/database');
const { authorizedDatabase } = require('./support/authorized-database');
const openDatabase = directory => authorizedDatabase(realOpenDatabase(directory));
const { registerTables, seedTables } = require('../src/desktop/tables');

test('desktop renderer displays persisted table identities, empty and failed states', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-grid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir);
  const trusted = {};
  let handler;
  const register = () => registerTables({ handle(_channel, fn) { handler = fn; } }, event => event === trusted, db, { currentUserId: () => 1, authenticatedUserId: () => 1 });
  register();
  let api;
  let invoke = (_channel, request) => Promise.resolve(handler(trusted, JSON.parse(JSON.stringify(request))));
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/desktop/preload.js'), 'utf8'), {
    require() { return { contextBridge: { exposeInMainWorld(_name, value) { api = value; } }, ipcRenderer: { invoke(...args) { return invoke(...args); } } }; }
  });
  class Component { setState(update) { Object.assign(this.state, update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo;', context);
  async function load() {
    const app = new context.Demo();
    app.componentDidMount(); app.loadDesktopData();
    await new Promise(resolve => setImmediate(resolve));
    return app.renderVals();
  }
  let view = await load();
  assert.match(view.tableMessage, /No tables available/);
  assert.equal(view.sections.length, 0);
  seedTables(db);
  db.exec("INSERT INTO dining_areas (name) VALUES ('Garden'); UPDATE dining_tables SET area = 'Garden', area_id = (SELECT id FROM dining_areas WHERE name = 'Garden') WHERE id = 1;");
  seedTables(db);
  db.close();
  db = openDatabase(dir);
  register();
  view = await load();
  assert.equal(view.tableMessage, '');
  assert.deepEqual(JSON.parse(JSON.stringify(view.sections.map(s => [s.label, s.tables.map(table => table.num)]))), [
    ['Garden', ['1']], ['Inside', ['2','3','4','5','6','7','8','9','10']], ['Terrace', ['11','12','13','14','15','16']]
  ]);
  db.close();
  view = await load();
  assert.match(view.tableMessage, /Tables unavailable/);
  assert.equal(view.sections.length, 0);
  invoke = () => Promise.resolve({ ok: true, data: [{ id: -1, area: 'bad' }] });
  assert.equal((await api.getTables()).ok, false);
});

test('desktop renderer clears prior financial state across sign-out and denies stale table results', async () => {
  let resolveOld;
  const oldTables = new Promise(resolve => { resolveOld = resolve; });
  let owner = false;
  const api = { signOut:async()=>({ok:true}), selectWaiter:async()=>({ok:true}), getMenu:async()=>({ok:false}), getTables:()=>owner ? Promise.resolve({ok:false}) : oldTables };
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React:{Component,createElement(){}}, ReactDOM:{createRoot(){return {render(){}};}}, document:{getElementById(){}}, window:{arra:api}, setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){} };
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Demo = WaiterDemo;',context);
  const app = new context.Demo(); app.componentDidMount();
  arrange(app, {screen:'tables',waiter:{id:1,name:'waiter'},sections:[{label:'previous',ids:[1]}],orders:{1:{id:4}},items:[{tableId:1,name:'Private item',unit:100,qty:2}],tableId:1});
  app.loadDesktopData(); await app.session.signOut();
  assert.equal(routeOf(app),'login'); assert.equal(app.state.sections.length,0); assert.equal(Object.keys(app.state.orders).length,0); assert.equal(app.state.items.length,0); assert.equal(app.state.tableId,null);
  owner=true; await app.session.chooseWaiter({id:2,name:'owner'},''); await new Promise(setImmediate);
  assert.equal(app.state.tableLoad,'error'); assert.equal(app.state.sections.length,0); assert.equal(app.state.items.length,0);
  resolveOld({ok:true,data:[{id:1,area:'previous',orderId:4,openedAt:1}]}); await new Promise(setImmediate);
  assert.equal(app.state.sections.length,0); assert.equal(Object.keys(app.state.orders).length,0); assert.equal(app.state.items.length,0);
  arrange(app, {sections:[{label:'stale',ids:[1]}],orders:{1:{id:4}},items:[{tableId:1,name:'Private item',qty:1,unit:100}]});
  app.loadDesktopData(); await new Promise(setImmediate);
  assert.equal(app.state.sections.length,0); assert.equal(Object.keys(app.state.orders).length,0); assert.equal(app.state.items.length,0);
});
