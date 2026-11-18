const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { openDatabase } = require('../src/desktop/database');
const { registerSession } = require('../src/desktop/session');
const { seedSampleIdentities } = require('../src/desktop/sample-accounts');
const { randomBytes, randomInt } = require('node:crypto');
const { registerTables, seedTables } = require('../src/desktop/tables');
const { registerMenu, seedMenu } = require('../src/desktop/menu');
const { registerOrders } = require('../src/desktop/orders');
const { registerOrderItems } = require('../src/desktop/order-items');

test('desktop login and sign-out traverse the bridge and clear credentials', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-auth-ui-'));
  const db = openDatabase(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const passwords = Array.from({length:4},()=>randomBytes(24).toString('hex'));
  const staffPin = String(randomInt(10000)).padStart(4,'0'), managerPin = String(randomInt(1000000)).padStart(6,'0');
  seedSampleIdentities(db, passwords, staffPin, managerPin);
  const handlers = {}, trusted = {};
  const session = registerSession({ handle(channel, fn) { handlers[channel] = fn; } }, event => event === trusted, db);
  seedTables(db); seedMenu(db);
  const ipc = { handle(channel, fn) { handlers[channel] = fn; } };
  registerTables(ipc, event => event === trusted, db, session);
  registerMenu(ipc, event => event === trusted, db, session);
  registerOrders(ipc, event => event === trusted, db, session);
  registerOrderItems(ipc, event => event === trusted, db, session);
  let api;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/desktop/preload.js'), 'utf8'), {
    require() { return { contextBridge: { exposeInMainWorld(_name, value) { api = value; } }, ipcRenderer: {
      invoke(channel, request) { return Promise.resolve(handlers[channel](trusted, JSON.parse(JSON.stringify(request)))); }
    } }; }
  });
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, ArraComponents: {}, renderTables() {}, renderOrder() {}, renderMoveTable() {}, renderBill() {}, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {} };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.Demo = WaiterDemo;', context);
  const app = new context.Demo();
  app._mounted = true;
  app.session.state.user = 'sample-restaurant'; app.session.state.pass = 'wrong';
  await app.session.login();
  assert.equal(routeOf(app), 'login'); assert.equal(app.session.state.pass, ''); assert.equal(session.currentUserId(), null);
  app.session.state.pass = passwords[0];
  await app.session.login();
  assert.equal(routeOf(app), 'tables'); assert.equal(app.session.state.pass, ''); assert.equal(session.currentUserId(), null);
  assert.doesNotThrow(() => app.render());
  assert.equal(app.session.state.waiter,null); assert.ok(app.tableOrders.state.sections.length);
  const waiterId = db.prepare("SELECT id FROM local_users WHERE username='sample-waiter'").get().id;
  app.session.requestTable(1); await app.session.setPin(staffPin);
  assert.equal(session.currentUserId(), waiterId);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(routeOf(app), 'order');
  assert.equal(app.tableOrders.state.tableLoad, 'ready'); assert.equal(app.catalog.state.menuLoad, 'ready');
  assert.ok(app.tableOrders.state.sections.length); assert.ok(app.catalog.state.products.length);
  assert.doesNotThrow(() => app.render());
  await app.session.switchWaiter();
  assert.equal(routeOf(app), 'tables'); assert.equal(session.currentUserId(), null);
  assert.ok(app.tableOrders.state.sections.length); assert.equal(app.tableOrders.state.items.length,0); assert.doesNotThrow(() => app.render());
  app.session.requestTable(1); await app.session.setPin(staffPin);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.tableOrders.state.tableLoad, 'ready'); assert.equal(session.currentUserId(), waiterId);
  await app.session.signOut();
  assert.equal(routeOf(app), 'login'); assert.equal(app.session.state.user, ''); assert.equal(app.session.state.pass, ''); assert.equal(session.currentUserId(), null);
  app.session.state.user = 'sample-combined'; app.session.state.pass = passwords[3];
  await app.session.login(); assert.equal(routeOf(app), 'admin'); assert.equal(session.currentUserId(), db.prepare("SELECT id FROM local_users WHERE username='sample-combined'").get().id);
  await app.session.signOut();
  db.exec('UPDATE local_users SET active = 0');
  app.session.state.user = 'sample-restaurant'; app.session.state.pass = passwords[0];
  await app.session.login();
  assert.equal(routeOf(app), 'login'); assert.equal(session.currentUserId(), null);
});
