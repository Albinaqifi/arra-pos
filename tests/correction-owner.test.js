const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { moduleSource } = require('./support/renderer-bundle');
const source = moduleSource('src/correction/CorrectionWorkflow.js', 'CorrectionModule') + moduleSource('src/orders/TableOrderModel.js', 'OrderModule');

function fixture(schedule = setTimeout, monotonicNow = () => performance.now()) {
  const calls = [], notices = [], approvals = [], revocations = [];
  let sequence = 0, language = 'en';
  const context = { React: { createElement: (type, props, ...children) => ({ type, props, children }) }, setTimeout: schedule, performance: { now: monotonicNow } };
  vm.runInNewContext(source, context);
  const bridge = {
    authorizeCancellation: (orderId, itemId, pin) => new Promise((resolve, reject) => approvals.push({ orderId, itemId, pin, resolve, reject })),
    revokeCancellationApproval: async token => { revocations.push(token); return {ok:true}; },
    orderItems: (action, id, payload) => new Promise((resolve, reject) => calls.push({ action, id, payload, resolve, reject })),
    getTables: async () => ({ ok: true, data: [{ id: 1, orderId: 10, untouched: false }] }),
  };
  const orders = new context.OrderModule.TableOrderModel({ bridge, canNavigate: () => true, getLanguage: () => language, notify() {}, onOrderOpened() {}, onDismiss() {} });
  orders._set({ screen: 'order', tableId: 1, orders: { 1: { id: 10, itemsLoaded: true } }, items: [{ id: 100, tableId: 1, status: 'sent', qty: 3, cxQty: 0, name: 'Sample', unit: 100, cx: [], route: 'kitchen', round: 1, sentAt: Date.now() }] });
  const workflow = new context.CorrectionModule.CorrectionWorkflow({ bridge, orders: {
    snapshot: () => orders.state, captureTarget: () => orders.captureTarget(), tableForOrder: target => orders.tableForOrder(target),
    writeBusy: () => orders.writeBusy, isCurrent: target => orders.isCurrent(target), acquireWrite: (kind, target) => orders.acquireWrite(kind, target), releaseWrite: lease => orders.releaseWrite(lease),
    applyConfirmedItems: (target, items) => orders.applyConfirmedItems(target, items), refreshAvailability: target => orders.refreshAvailability(target),
  }, getLanguage: () => language, getActor: () => 'Sample waiter', canOpen: () => true, notify: message => notices.push(message), requestId: () => 'correction-' + ++sequence });
  return { workflow, orders, bridge, calls, approvals, revocations, notices, language: value => { language = value; } };
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

test('desktop success shows the same concise toast whether printing is enabled', async () => {
  for (const enabled of [true,false]) {
    const { workflow, calls, notices } = fixture();workflow.open(100);workflow.chooseReason('Entered by mistake');const pending=workflow.confirm();
    calls[0].resolve({ok:true,data:{items:[],testPrintEnabled:enabled}});await pending;
    assert.equal(notices[0],'Correction saved.');
  }
});

test('stale correction completion cannot overwrite a replacement order or release its lease', async () => {
  const { workflow, orders, calls, notices } = fixture();
  workflow.open(100); workflow.chooseReason('Entered by mistake'); const pending = workflow.confirm();
  orders.clearProtectedData(); workflow.reset();
  orders._set({ screen: 'order', tableId: 1, orders: { 1: { id: 20 } }, items: [{ id: 200, tableId: 1, status: 'sent', sentAt: Date.now(), qty: 1, cxQty: 0 }] });
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

test('late PIN verification precedes the correction and preserves uncertain retry identity', async () => {
  const { workflow, orders, calls, approvals } = fixture();
  const pin=String(require('node:crypto').randomInt(0,1000000)).padStart(6,'0'), token=require('node:crypto').randomBytes(32).toString('hex');
  orders._set({ items: orders.state.items.map(item => ({ ...item, sentAt: Date.now()-120001 })) });
  assert.equal(workflow.open(100),true);assert.equal(workflow.state.dialog.phase,'pin');
  workflow.setPin(pin); const firstVerify=workflow.verifyPin();assert.equal(workflow.state.dialog.pin,'');approvals[0].resolve({ok:false});await firstVerify;assert.equal(workflow.state.dialog.phase,'pin');
  workflow.setPin(pin);const verify=workflow.verifyPin();approvals[1].resolve({ok:true,token});await verify;assert.equal(workflow.state.dialog.phase,'correction');
  workflow.chooseReason('Entered by mistake');const first=workflow.confirm();assert.equal(calls[0].payload.approvalToken,token);assert.equal(Object.hasOwn(workflow.state.dialog.payload,'approvalToken'),false);assert.equal(Object.hasOwn(workflow.state.dialog.payload,'pin'),false);
  calls[0].reject(Error('Lost response'));await first;const retry=workflow.confirm();assert.equal(calls[1].payload.requestId,calls[0].payload.requestId);
  calls[1].resolve({ok:false,rejected:true,code:'window_expired'});await retry;assert.equal(workflow.state.dialog.unresolved,true);assert.equal(workflow.state.dialog.phase,'pin');
  workflow.setPin(pin);const again=workflow.verifyPin();approvals[2].resolve({ok:true,token});await again;const recovery=workflow.confirm();assert.equal(calls[2].payload.requestId,calls[0].payload.requestId);
  calls[2].resolve({ok:true,data:{items:[]}});await recovery;assert.equal(workflow.state.dialog,null);
});

test('dismissing or resetting a verified approval revokes its token', async () => {
  const { workflow, orders, approvals, revocations } = fixture(), pin=String(require('node:crypto').randomInt(0,1000000)).padStart(6,'0');
  orders._set({items:orders.state.items.map(item=>({...item,sentAt:Date.now()-120001}))});
  for (const action of ['dismiss','reset','dispose']) {
    const token=require('node:crypto').randomBytes(32).toString('hex');workflow.open(100);workflow.setPin(pin);const verify=workflow.verifyPin();approvals.at(-1).resolve({ok:true,token});await verify;
    workflow[action]();await new Promise(setImmediate);assert.equal(revocations.at(-1),token);
  }
});

test('closing a verified approval waits for revocation and safely retries an unknown result', async () => {
  const { workflow, orders, bridge, approvals, calls } = fixture(), pin=String(require('node:crypto').randomInt(0,1000000)).padStart(6,'0'), token=require('node:crypto').randomBytes(32).toString('hex');
  orders._set({items:orders.state.items.map(item=>({...item,sentAt:Date.now()-120001}))});workflow.open(100);workflow.setPin(pin);const verifying=workflow.verifyPin();approvals[0].resolve({ok:true,token});await verifying;workflow.chooseReason('Entered by mistake');
  let resolve;bridge.revokeCancellationApproval=()=>new Promise(r=>{resolve=r});assert.equal(workflow.dismiss(),false);assert.equal(workflow.locked,true);await workflow.confirm();assert.equal(calls.length,0);resolve({ok:false});await new Promise(setImmediate);assert.equal(workflow.state.dialog.approvalToken,token);assert.ok(workflow.state.dialog.error);assert.equal(workflow.locked,true);workflow.chooseReason('Other');await workflow.confirm();assert.equal(calls.length,0);assert.equal(workflow.state.dialog.reason,'Entered by mistake');
  bridge.revokeCancellationApproval=async()=>{throw Error('acknowledgement lost')};assert.equal(workflow.dismiss(),false);await new Promise(setImmediate);assert.equal(workflow.state.dialog.approvalToken,token);
  bridge.revokeCancellationApproval=async seen=>({ok:seen===token});assert.equal(workflow.dismiss(),false);await new Promise(setImmediate);assert.equal(workflow.state.dialog,null);
});

test('a late PIN authorization response is revoked after reset or disposal', async () => {
  for (const action of ['reset','dispose']) {
    const { workflow, orders, approvals, revocations } = fixture(), pin=String(require('node:crypto').randomInt(0,1000000)).padStart(6,'0'), token=require('node:crypto').randomBytes(32).toString('hex');
    orders._set({items:orders.state.items.map(item=>({...item,sentAt:Date.now()-120001}))});workflow.open(100);workflow.setPin(pin);const pending=workflow.verifyPin();workflow[action]();approvals[0].resolve({ok:true,token});await pending;await new Promise(setImmediate);assert.equal(revocations.at(-1),token);
  }
});

test('teardown and stale-response cleanup retry failed revocations until acknowledged', async () => {
  for (const action of ['reset','dispose','stale']) {
    const scheduled=[], f=fixture(fn=>scheduled.push(fn)), { workflow, orders, bridge, approvals }=f;
    const pin=String(require('node:crypto').randomInt(0,1000000)).padStart(6,'0'), token=require('node:crypto').randomBytes(32).toString('hex');let attempts=0;
    bridge.revokeCancellationApproval=async seen=>{assert.equal(seen,token);return {ok:++attempts>1}};
    orders._set({items:orders.state.items.map(item=>({...item,sentAt:Date.now()-120001}))});workflow.open(100);workflow.setPin(pin);const pending=workflow.verifyPin();
    if(action==='stale') { workflow.reset();approvals[0].resolve({ok:true,token});await pending; }
    else { approvals[0].resolve({ok:true,token});await pending;workflow[action](); }
    await new Promise(setImmediate);assert.equal(attempts,1);assert.equal(scheduled.length,1);await scheduled[0]();assert.equal(attempts,2);assert.equal(scheduled.length,1);
  }
});

test('teardown retry terminates after the trusted monotonic lifetime', async () => {
  const scheduled=[];let tick=0;const { workflow, orders, bridge, approvals }=fixture(fn=>scheduled.push(fn),()=>tick);
  const pin=String(require('node:crypto').randomInt(0,1000000)).padStart(6,'0'),token=require('node:crypto').randomBytes(32).toString('hex');let attempts=0;
  bridge.revokeCancellationApproval=async()=>{attempts++;return {ok:false}};orders._set({items:orders.state.items.map(item=>({...item,sentAt:Date.now()-120001}))});workflow.open(100);workflow.setPin(pin);const pending=workflow.verifyPin();approvals[0].resolve({ok:true,token});await pending;workflow.reset();
  await new Promise(setImmediate);assert.equal(attempts,1);assert.equal(scheduled.length,1);tick=120000;await scheduled[0]();assert.equal(attempts,2);assert.equal(scheduled.length,1);
});
