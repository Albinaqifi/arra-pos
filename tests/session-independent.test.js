const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { openDatabase } = require('../src/desktop/database');
const { bootstrap, registerSession } = require('../src/desktop/session');

test('desktop login and sign-out traverse the bridge and clear credentials', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-auth-ui-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  bootstrap(db, 'sample', 'sample password');
  const handlers = {}, trusted = {};
  const session = registerSession({ handle(channel, fn) { handlers[channel] = fn; } }, event => event === trusted, db);
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
  assert.equal(app.state.screen, 'waiters'); assert.equal(app.state.pass, ''); assert.equal(session.currentUserId(), 1);
  await app.signOut();
  assert.equal(app.state.screen, 'login'); assert.equal(app.state.user, ''); assert.equal(app.state.pass, ''); assert.equal(session.currentUserId(), null);
  db.exec('UPDATE local_users SET active = 0');
  app.state.user = 'sample'; app.state.pass = 'sample password';
  await app.login();
  assert.equal(app.state.screen, 'login'); assert.equal(session.currentUserId(), null);
});
