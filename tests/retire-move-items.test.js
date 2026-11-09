const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');

test('desktop startup registers no selected-item move handler', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-retired-move-'));
  const handlers = {}, callbacks = {};
  const ipcMain = { handle(channel, handler) { assert.equal(handlers[channel], undefined); handlers[channel] = handler; } };
  class BrowserWindow {
    constructor() { this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {} }; }
    on() {} loadFile() {} static getAllWindows() { return []; }
  }
  const app = { whenReady: () => Promise.resolve(), getPath: () => dir, on(name, fn) { callbacks[name] = fn; }, quit() {} };
  const electron = { app, BrowserWindow, ipcMain, dialog: { showErrorBox() { throw new Error('startup failed'); } } };
  const filename = require.resolve('../src/desktop/main.js');
  const localRequire = name => name === 'electron' ? electron : name === './sample-data-directory' ? { dataDirectory: () => dir } : require(name.startsWith('./') ? path.join(path.dirname(filename), name) : name);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: localRequire, __dirname: path.dirname(filename), process, console });
  await new Promise(resolve => setImmediate(resolve));
  t.after(() => { callbacks['will-quit'](); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(handlers['arra:move-items'], undefined);
  assert.equal(typeof handlers['arra:move-order'], 'function');
  const invoke = async (channel, request) => {
    if (!handlers[channel]) throw new Error('No handler registered');
    return handlers[channel]({}, request);
  };
  await assert.rejects(invoke('arra:move-items', { orderId: 1, sourceId: 1, destinationId: 2, destinationOrderId: null, itemIds: [1], requestId: 'sample' }), /No handler registered/);
});
