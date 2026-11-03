const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, registerSession } = require('../src/desktop/session');
const { registerTables, seedTables } = require('../src/desktop/tables');
const { registerMenu, seedMenu } = require('../src/desktop/menu');

test('desktop login and sign-out traverse the bridge and clear credentials', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-auth-ui-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  bootstrap(db, 'sample', 'sample password');
  const handlers = {}, trusted = {};
  const session = registerSession({ handle(channel, fn) { handlers[channel] = fn; } }, event => event === trusted, db);
  seedTables(db); seedMenu(db);
  const ipc = { handle(channel, fn) { handlers[channel] = fn; } };
  registerTables(ipc, event => event === trusted, db, session);
  registerMenu(ipc, event => event === trusted, db, session);
  let api;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/desktop/preload.js'), 'utf8'), {
    require() { return { contextBridge: { exposeInMainWorld(_name, value) { api = value; } }, ipcRenderer: {
      invoke(channel, request) { return Promise.resolve(handlers[channel](trusted, JSON.parse(JSON.stringify(request)))); }
    } }; }
  });
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  const app = new context.Demo();
  app._mounted = true;
  app.state.user = 'sample'; app.state.pass = 'wrong';
  await app.login();
  assert.equal(app.state.screen, 'login'); assert.equal(app.state.pass, ''); assert.equal(session.currentUserId(), null);
  app.state.pass = 'sample password';
  await app.login();
  assert.equal(app.state.screen, 'waiters'); assert.equal(app.state.pass, ''); assert.equal(session.currentUserId(), null);
  assert.doesNotThrow(() => app.render());
  assert.deepEqual(app._menu.waiters.map(w => w.name), ['sample']);
  await app.chooseWaiter({ id: 1, name: 'sample', color: '#000' }, '');
  assert.equal(session.currentUserId(), 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.screen, 'tables');
  assert.equal(app.state.tableLoad, 'ready'); assert.equal(app.state.menuLoad, 'ready');
  assert.ok(app.state.sections.length); assert.ok(app._menu.products.length);
  assert.doesNotThrow(() => app.render());
  await app.switchWaiter();
  assert.equal(app.state.screen, 'waiters'); assert.equal(session.currentUserId(), null);
  assert.equal(app.state.sections.length, 0); assert.doesNotThrow(() => app.render());
  await app.chooseWaiter({ id: 1, name: 'sample', color: '#000' }, '');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.state.tableLoad, 'ready'); assert.equal(session.currentUserId(), 1);
  await app.signOut();
  assert.equal(app.state.screen, 'login'); assert.equal(app.state.user, ''); assert.equal(app.state.pass, ''); assert.equal(session.currentUserId(), null);
  db.exec('UPDATE local_users SET active = 0');
  app.state.user = 'sample'; app.state.pass = 'sample password';
  await app.login();
  assert.equal(app.state.screen, 'login'); assert.equal(session.currentUserId(), null);
});
