const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('changing language preserves unresolved correction and move requests', async () => {
  class Component {
    setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); }
  }
  const calls = [];
  const context = {
    React: { Component },
    window: { arra: { language: async request => { calls.push(request); return { ok: true, language: request.language }; } } },
    clearTimeout() {},
  };
  vm.runInNewContext(require('./support/renderer-bundle')(), context);
  const app = new context.RendererModules.WaiterDemo();
  app._mounted = true;
  for (const modal of [
    { type: 'cancel', itemId: 4, qty: 1, reason: 'Entered by mistake', requestId: 'correction-request', unresolved: true },
    { type: 'moveTable', dest: 2, unresolved: true },
  ]) {
    Object.assign(app.state, { screen: 'order', tableId: 1, modal });
    app._moveRequests = { '7:1:2': 'move-request' };
    app._sendRequests = { 7: 'send-request' };
    const before = JSON.stringify({ modal: app.state.modal, move: app._moveRequests, send: app._sendRequests });
    await app.changeLanguage('sq');
    assert.equal(app.state.language, 'sq');
    assert.equal(app.state.screen, 'order');
    assert.equal(app.state.tableId, 1);
    assert.equal(JSON.stringify({ modal: app.state.modal, move: app._moveRequests, send: app._sendRequests }), before);
    app.renderVals().closeModal();
    assert.ok(app.state.modal, 'an unresolved operation stays open after language changes');
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(request => request.action === 'set' && request.language === 'sq'));
});
