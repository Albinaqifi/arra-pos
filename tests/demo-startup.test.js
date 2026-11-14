const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { moduleSource } = require('./support/renderer-bundle');
const source = moduleSource(require.resolve('../src/desktop-status.js'), 'Startup');
async function start(mode, bridge) {
  const status = { textContent: '', role: 'status', dataset: {}, setAttribute(k, v) { this[k] = v; } };
  let mounts = 0;
  const events = {};
  const context = { document: { body: { dataset: { mode } }, getElementById(id) { return id === 'application-status' ? status : {}; } }, window: { arra: bridge, addEventListener(name, callback) { events[name] = callback; }, removeEventListener(name) { delete events[name]; } }, React: { Component: class {}, createElement() { return {}; } }, ReactDOM: { createRoot() { return { render() { mounts++; } }; } }, WaiterDemo: class {} };
  vm.runInNewContext(source, context);
  const loadApp = async () => ({ WaiterDemo: context.WaiterDemo });
  await context.Startup.startRenderer(loadApp);
  return { status, get mounts() { return mounts; }, context, events, loadApp };
}
test('explicit browser demo is labeled and desktop cannot fall back when its bridge is missing', async () => {
  const demo = await start('demo');
  assert.equal(demo.mounts, 1);
  assert.match(demo.status.textContent, /Browser demo.*simulated/);
  for (const mode of ['desktop', undefined]) {
    const result = await start(mode);
    assert.equal(result.mounts, 0);
    assert.equal(result.status.role, 'alert');
  }
  assert.equal((await start('demo', {})).mounts, 0);
});
test('desktop startup requires a successful bridge response and displays errors', async () => {
  for (const bridge of [{ getApplicationInfo: async () => ({ ok: false }) }, { getApplicationInfo: async () => { throw Error('failure'); } }, {}]) {
    const result = await start('desktop', bridge);
    assert.equal(result.mounts, 0);
    assert.equal(result.status.role, 'alert');
  }
  const result = await start('desktop', { getApplicationInfo: async () => ({ ok: true, data: { name: 'Arra POS', mode: 'development' } }) });
  assert.equal(result.mounts, 1);
  assert.match(result.status.textContent, /Arra POS/);
});

test('startup captures the bridge, mounts once, and cleans up its language listener', async () => {
  let probes = 0;
  const result = await start('desktop', { getApplicationInfo: async () => { probes++; return { ok: true, data: { name: 'Arra POS' } }; } });
  result.context.window.arra = undefined;
  await Promise.all([result.context.Startup.startRenderer(result.loadApp), result.context.Startup.startRenderer(result.loadApp)]);
  assert.equal(result.mounts, 1);
  assert.equal(probes, 1);
  result.events['arra-language-changed']({ detail: 'sq' });
  assert.match(result.status.textContent, /Zhvillim/);
  result.events.pagehide();
  assert.equal(result.events['arra-language-changed'], undefined);
  const failed = await start('desktop');
  failed.context.window.arra = { getApplicationInfo: async () => ({ ok: true, data: { name: 'Arra POS' } }) };
  await failed.context.Startup.startRenderer(failed.loadApp);
  assert.equal(failed.mounts, 0);
});

test('renderer entry bundles all app modules locally and mounts the explicit demo', async () => {
  const bundled = moduleSource(require.resolve('../src/renderer-entry.js'));
  assert.doesNotMatch(bundled, /\bimport\s*\(/);
  const status = { dataset: {}, setAttribute() {} };
  let mounted;
  const context = { React: { Component: class {}, createElement: type => ({ type }) }, ReactDOM: { createRoot: () => ({ render: element => { mounted = element; } }) }, window: { addEventListener() {} }, document: { body: { dataset: { mode: 'demo' } }, getElementById: () => status } };
  vm.runInNewContext(bundled, context);
  await new Promise(setImmediate);
  assert.equal(typeof mounted?.type, 'function');
  assert.match(status.textContent, /Browser demo.*simulated/);
  for (const file of ['index.html', 'demo.html']) {
    const scripts = [...fs.readFileSync(require.resolve('../' + file), 'utf8').matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(scripts, ['./react.js', './react-dom.js', './renderer-entry.js']);
  }
});
