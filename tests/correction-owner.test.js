const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { moduleSource } = require('./support/renderer-bundle');
const source = moduleSource('src/correction/CorrectionWorkflow.js', 'CorrectionModule') + moduleSource('src/orders/TableOrderModel.js', 'OrderModule');

function fixture() {
  const calls = [], notices = [];
  let sequence = 0, language = 'en';
  const context = { React: { createElement: (type, props, ...children) => ({ type, props, children }) } };
  vm.runInNewContext(source, context);
  const bridge = {
    orderItems: (action, id, payload) => new Promise((resolve, reject) => calls.push({ action, id, payload, resolve, reject })),
    getTables: async () => ({ ok: true, data: [{ id: 1, orderId: 10, untouched: false }] }),
  };
  const orders = new context.OrderModule.TableOrderModel({ bridge, canNavigate: () => true, getLanguage: () => language, notify() {}, onOrderOpened() {}, onDismiss() {} });
  orders._set({ screen: 'order', tableId: 1, orders: { 1: { id: 10, itemsLoaded: true } }, items: [{ id: 100, tableId: 1, status: 'sent', qty: 3, cxQty: 0, name: 'Sample', unit: 100, cx: [], route: 'kitchen', round: 1, sentAt: 1 }] });
  const workflow = new context.CorrectionModule.CorrectionWorkflow({ bridge, orders: {
    snapshot: () => orders.state, captureTarget: () => orders.captureTarget(), tableForOrder: target => orders.tableForOrder(target),
    writeBusy: () => orders.writeBusy, isCurrent: target => orders.isCurrent(target), acquireWrite: (kind, target) => orders.acquireWrite(kind, target), releaseWrite: lease => orders.releaseWrite(lease),
    applyConfirmedItems: (target, items) => orders.applyConfirmedItems(target, items), refreshAvailability: target => orders.refreshAvailability(target),
  }, getLanguage: () => language, getActor: () => 'Sample waiter', canOpen: () => true, notify: message => notices.push(message), requestId: () => 'correction-' + ++sequence });
  return { workflow, orders, calls, notices, language: value => { language = value; } };
}

test('correction owns confirmation and freezes all retry fields through uncertainty and a later rejection', async () => {
  const { workflow, orders, calls, language } = fixture();
  assert.equal(workflow.open(100), true);
  workflow.changeQuantity(1); workflow.chooseReason('Other'); workflow.setOther('  Wrong portion  ');
  workflow.review(); assert.equal(workflow.state.dialog.confirming, true);
  const first = workflow.review();
  assert.equal(calls.length, 1); assert.equal(calls[0].id, 10);
  assert.equal(JSON.stringify(calls[0].payload), JSON.stringify({ itemId: 100, quantity: 2, reason: 'Wrong portion', requestId: 'correction-1' }));
  workflow.confirm(); workflow.changeQuantity(1); workflow.chooseReason('Entered by mistake'); workflow.setOther('Changed');
  assert.equal(calls.length, 1); assert.equal(workflow.dismiss(), false); assert.equal(orders.writeBusy, true);
  calls[0].reject(Error('Response lost')); await first;
  assert.equal(workflow.locked, true); assert.equal(orders.writeBusy, false);
  language('sq'); workflow.view();
  assert.equal(workflow.state.dialog.confirming, true);
  const retry = workflow.confirm();
  assert.equal(calls[1].payload, calls[0].payload);
  calls[1].resolve({ ok: false, rejected: true, code: 'access_denied' }); await retry;
  assert.equal(workflow.state.dialog.unresolved, true); assert.equal(workflow.dismiss(), false);
  const finalRetry = workflow.confirm();
  assert.equal(calls[2].payload, calls[0].payload);
  calls[2].resolve({ ok: true, data: { items: [{ id: 100, productId: 'sample', name: 'Sample', quantity: 3, correctedQuantity: 2, status: 'sent', unitPrice: 100, corrections: [] }] } });
  await finalRetry;
  assert.equal(workflow.state.dialog, null); assert.equal(orders.writeBusy, false);
  assert.equal(orders.state.items[0].cxQty, 2); assert.equal(orders.state.items[0].qty, 3);
});

test('a definite first rejection permits a revised request without losing the draft', async () => {
  const { workflow, calls } = fixture();
  workflow.open(100); workflow.chooseReason('Entered by mistake');
  const first = workflow.confirm(); calls[0].resolve({ ok: false, rejected: true, code: 'already_billed' }); await first;
  assert.match(workflow.state.dialog.error, /already been billed/);
  assert.equal(workflow.state.dialog.requestId, null);
  workflow.chooseReason('Other'); workflow.setOther('New explanation');
  const second = workflow.confirm();
  assert.equal(calls[1].payload.reason, 'New explanation');
  assert.notEqual(calls[1].payload.requestId, calls[0].payload.requestId);
  calls[1].resolve({ ok: false, rejected: true, code: 'invalid_input' }); await second;
  assert.equal(workflow.dismiss(), true);
});

test('stale correction completion cannot overwrite a replacement order or release its lease', async () => {
  const { workflow, orders, calls, notices } = fixture();
  workflow.open(100); workflow.chooseReason('Entered by mistake'); const pending = workflow.confirm();
  orders.clearProtectedData(); workflow.reset();
  orders._set({ screen: 'order', tableId: 1, orders: { 1: { id: 20 } }, items: [{ id: 200, tableId: 1, status: 'sent', qty: 1, cxQty: 0 }] });
  workflow.open(200); const newer = orders.acquireWrite('add');
  calls[0].resolve({ ok: true, data: { items: [] } }); await pending;
  assert.equal(workflow.state.dialog.itemId, 200); assert.equal(orders.state.items[0].id, 200);
  assert.equal(orders.writeBusy, true); assert.equal(notices.length, 0);
  orders.releaseWrite(newer);
});

test('correction rejects pending items and suppresses disposed completions', async () => {
  const { workflow, orders, calls, notices } = fixture();
  orders._set({ items: orders.state.items.map(item => ({ ...item, status: 'pending' })) });
  assert.equal(workflow.open(100), false);
  orders._set({ items: orders.state.items.map(item => ({ ...item, status: 'sent' })) });
  workflow.open(100); workflow.chooseReason('Entered by mistake');
  const pending = workflow.confirm(); workflow.dispose();
  calls[0].resolve({ ok: true, data: { items: [] } }); await pending;
  assert.equal(orders.state.items.length, 1); assert.equal(notices.length, 0); assert.equal(orders.writeBusy, false);
});
