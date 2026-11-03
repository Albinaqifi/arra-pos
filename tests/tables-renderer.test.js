const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { openDatabase } = require('../src/desktop/database');
const { registerTables, seedTables } = require('../src/desktop/tables');

test('desktop renderer displays persisted table identities, empty and failed states', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-grid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(dir);
  const trusted = {};
  let handler;
  const register = () => registerTables({ handle(_channel, fn) { handler = fn; } }, event => event === trusted, db);
  register();
  let api;
  let invoke = (_channel, request) => Promise.resolve(handler(trusted, JSON.parse(JSON.stringify(request))));
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/desktop/preload.js'), 'utf8'), {
    require() { return { contextBridge: { exposeInMainWorld(_name, value) { api = value; } }, ipcRenderer: { invoke(...args) { return invoke(...args); } } }; }
  });
  class Component { setState(update) { Object.assign(this.state, update); } }
  const context = { React: { Component, createElement() {} }, ReactDOM: { createRoot() { return { render() {} }; } }, document: { getElementById() {} }, window: { arra: api }, setInterval() {}, clearInterval() {}, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'), 'utf8') + '\nthis.Demo = WaiterDemo;', context);
  async function load() {
    const app = new context.Demo();
    app.componentDidMount();
    await new Promise(resolve => setImmediate(resolve));
    return app.renderVals();
  }
  let view = await load();
  assert.match(view.tableMessage, /No tables available/);
  assert.equal(view.sections.length, 0);
  seedTables(db);
  db.prepare('UPDATE dining_tables SET area = ? WHERE id = ?').run('Garden', 1);
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
