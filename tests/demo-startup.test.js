const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/desktop-status.js'), 'utf8');
async function start(mode, bridge) {
  const status = { textContent: '', role: 'status', setAttribute(k, v) { this[k] = v; } };
  let mounts = 0;
  const context = { document: { body: { dataset: { mode } }, getElementById(id) { return id === 'application-status' ? status : {}; } }, window: { arra: bridge }, React: { createElement() { return {}; } }, ReactDOM: { createRoot() { return { render() { mounts++; } }; } }, WaiterDemo: class {} };
  await vm.runInNewContext(source, context);
  return { status, mounts };
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
