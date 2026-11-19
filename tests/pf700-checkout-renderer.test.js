const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const source = require('./support/renderer-bundle').moduleSource(path.resolve('src/waiter/DesktopBill.js'), 'Feature');

function dialog(api, props = {}) {
  class Component {
    constructor(props) { this.props = props; }
    setState(update) { Object.assign(this.state, update); }
  }
  const React = { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const context = { React, window: { arra: api } };
  vm.runInNewContext(source, context);
  return new context.Feature.DesktopBill({ language: 'en', orderId: 1, ...props });
}

const line = { itemId: 3, name: 'Coffee', unitPrice: 70, quantity: 1, modifiers: [], taxRate: 10, taxGroup: 'В' };
const bill = { id: 1, lines: [line], total: 70, fiscalMode: 'device', fiscalDomesticProduct: true, physicalCashControls: true };
const fiscal = { mode: 'device', status: 'accepted', reference: '0001235', method: 'cash', receipt: { lines: [line], domesticProduct: true } };

test('training card requires an explicit simulated approval and a decline leaves the bill payable', async () => {
  let payments = 0;
  let training = { ...bill, fiscalMode: 'simulation' };
  const view = dialog({ bill: async () => ({ok:true,data:training}), payment: async selection => {
    if (selection.prepareSimulated) { training={...training,simulatedCardIntent:{id:42}}; return {ok:true,data:{intentId:42}}; }
    payments++;
    assert.equal(selection.method,'card'); assert.equal(selection.account,'A');
    assert.equal(selection.terminalApproved,true);
    assert.equal(selection.intentId,42);
    return {ok:true,data:{fiscal:{...fiscal,mode:'simulation',method:'card',reference:'SIM-1'}}};
  }});
  const button = (node, label) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.children.includes(label)) return node;
    for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) {
      const found = button(item,label); if (found) return found;
    }
    return null;
  };
  await view.review();
  view.selectMethod('card');
  await view.pay();
  assert.equal(payments,0);
  assert.match(JSON.stringify(view.render()), /No terminal charge is made/);
  button(view.render(),'Simulate decline or cancellation').props.onClick();
  assert.equal(view.state.method,'');
  assert.equal(payments,0);
  view.selectMethod('card');
  await button(view.render(),'Prepare simulated terminal').props.onClick();
  await button(view.render(),'Record observed simulated approval').props.onClick();
  assert.equal(payments,1);
  assert.equal(view.state.receipt.method,'card');
});

test('lost approval bridge request preserves the prepared intent after remount', async () => {
  let data={...bill,fiscalMode:'simulation'}, approvalCalls=0;
  const api={bill:async()=>({ok:true,data}),payment:async req=>{
    if (req.prepareSimulated) {data={...data,simulatedCardIntent:{id:71}};return {ok:true};}
    if (req.terminalApproved) {approvalCalls++;throw Error('Rejected before delivery');}
  }};
  const first=dialog(api); await first.review(); first.selectMethod('card');
  await first.terminalIntent();
  await first.pay(true);
  assert.equal(first.state.uncertain,true);
  const reopened=dialog(api); await reopened.review();
  assert.equal(reopened.state.method,'card');
  assert.equal(reopened.state.fiscalTenderFixed,true);
  reopened.selectMethod('cash','B'); assert.equal(reopened.state.method,'card');
  assert.match(JSON.stringify(reopened.render()),/Record the observed simulated terminal result/);
  assert.match(JSON.stringify(reopened.render()),/Record observed simulated approval/);
  assert.doesNotMatch(JSON.stringify(reopened.render()),/Simulate decline or cancellation/);
  assert.equal(approvalCalls,1);
});

test('reloaded simulated approval keeps the original tender without asking for approval again', async () => {
  let calls = 0;
  const view = dialog({ bill: async () => ({ok:true,data:{...bill,fiscalMode:'simulation',simulatedCardApproval:true}}),
    payment: async selection => { calls++; assert.equal(selection.method,'card'); assert.equal(selection.account,'A');
      assert.equal(Object.hasOwn(selection,'terminalApproved'),false); return {ok:false,fiscalStatus:'unmapped'}; } });
  await view.review();
  assert.equal(view.state.fiscalTenderFixed,true);
  view.selectMethod('cash','B');
  assert.equal(view.state.method,'card');
  const output = JSON.stringify(view.render());
  assert.match(output,/simulated terminal payment was approved/);
  assert.doesNotMatch(output,/Simulate terminal approval|Simulate decline or cancellation/);
  await view.pay();
  assert.equal(calls,1);
});

test('an ordinary launch keeps a previously failed device receipt bound to the original profile', async () => {
  const data = { ...bill, fiscalMode: undefined, fiscal: { ...fiscal, status: 'failed', reference: null } };
  const view = dialog({ bill: async () => ({ ok: true, data }), payment: () => assert.fail('No sale outside the original profile') });
  await view.review();
  const output = JSON.stringify(view.render());
  assert.match(output, /Reopen checkout with the original printer/);
  assert.doesNotMatch(output, /Register cash sale|Confirm bill/);
  await view.pay();
  view.selectMethod('cash','B');
  assert.equal(view.state.account, 'A');
});

test('a missing device profile before any fiscal reservation leaves cash B available', async () => {
  const selections = [];
  const view = dialog({
    bill: async () => ({ ok: true, data: { ...bill, fiscalMode: undefined } }),
    payment: async selection => { selections.push(selection.account); return selection.account === 'A' ? {ok:false,fiscalStatus:'profile'} : {ok:true}; }
  });
  await view.review();
  view.selectMethod('cash','A');await view.pay();
  view.selectMethod('cash','B');await view.pay();
  assert.deepEqual(selections, ['A','B']);
});

test('a paid receipt reopened for review shows paper details and hands off exactly once without taking payment', async () => {
  let paid = 0, confirmed = 0;
  const view = dialog({ bill: async () => ({ ok: true, data: { ...bill, fiscal } }),
    payment: () => assert.fail('Paid receipt must be read only') },
    { onPaid() { paid++; }, onConfirmed() { confirmed++; } });
  await view.review();
  const output = JSON.stringify(view.render());
  for (const note of ['Registered PF700 receipt', '0001235', 'VAT 10% (В)', 'Macedonian-product mark included', 'Continue']) {
    assert.ok(output.includes(note), note);
  }
  assert.ok(!output.includes('Register cash sale'));
  assert.equal(confirmed, 1);
  await Promise.all([view.finishReceipt(), view.finishReceipt()]);
  assert.equal(paid, 1);
});

test('live confirmation names the sale and saved origin; uncertainty refreshes evidence without another payment', async () => {
  let reads = 0, writes = 0;
  const unknown = { ...fiscal, status: 'uncertain', reference: null,
    receipt: { ...fiscal.receipt, domesticProduct: false },
    baseline: { deviceId: 'SYNTHETIC01', previousDocumentNumber: '0001234', expectedDocumentNumber: '0001235' } };
  const view = dialog({
    bill: async () => ({ ok: true, data: ++reads === 1 ? bill : { ...bill, fiscal: unknown } }),
    payment: async request => { if (request.preparePhysicalCash) return {ok:true,data:{intentId:15}}; writes++; return { ok: false, fiscalStatus: 'uncertain' }; }
  });
  await view.review();
  view.selectMethod('cash');
  assert.match(JSON.stringify(view.render()), /Register cash sale/);
  assert.ok(JSON.stringify(view.render()).includes('VAT 10% (В)'));
  assert.match(JSON.stringify(view.render()), /Macedonian-product mark included/);
  await view.pay();
  await view.pay();
  const output = JSON.stringify(view.render());
  assert.match(output, /expected document 0001235 on printer SYNTHETIC01/);
  assert.match(output, /Ask for help; do not take another payment or run printer checks/);
  assert.match(output, /Reload saved bill/);
  assert.doesNotMatch(output, /Check receipt status/);
  assert.match(output, /Macedonian-product mark omitted/);
  assert.ok(!output.includes('Registered PF700 receipt') && !output.includes('Register cash sale'));
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});

test('a submitted receipt offers local settlement and shows the saved document in both languages', async () => {
  for (const [language, label] of [['en', 'Finish recording payment'], ['sq', 'Perfundo regjistrimin e pageses']]) {
    let writes = 0;
    const view = dialog({
      bill: async () => ({ ok: true, data: { ...bill, fiscal: { ...fiscal, status: 'submitted' } } }),
      payment: async selection => {
        assert.equal(selection.account, 'A');
        assert.equal(selection.method, 'cash');
        writes++;
        return { ok: true, data: { fiscal } };
      }
    }, { language });
    await view.review();
    const output = JSON.stringify(view.render());
    assert.ok(output.includes(label) && output.includes('0001235'));
    assert.ok(!output.includes('Register cash sale'));
    await view.pay();
    assert.equal(view.state.receipt.status, 'accepted');
    assert.equal(writes, 1);
  }
});


test('uncertain receipt guidance remains visible when saved-bill reload fails or throws', async () => {
  for (const throws of [false, true]) {
    let reads = 0, payments = 0;
    const unknown = { ...fiscal, status: 'uncertain', reference: null };
    const view = dialog({
      bill: async () => {
        if (++reads === 1) return { ok: true, data: { ...bill, fiscal: unknown } };
        if (throws) throw Error('Unavailable');
        return { ok: false, error: 'Could not prepare bill' };
      },
      payment: async () => { payments++; }
    });
    await view.review();
    await view.review();
    const output = JSON.stringify(view.render());
    assert.match(output, /Ask for help; do not take another payment or run printer checks/);
    assert.match(output, /Could not prepare bill/);
    assert.match(output, /Reload saved bill/);
    assert.equal(view.state.fiscalHold, true);
    await view.pay();
    assert.equal(payments, 0);
  }
});


test('lost device Cash A bridge response warns and retains the locked original selection', async () => {
  const selections = []; let preparations = 0;
  const view = dialog({
    bill: async () => ({ ok: true, data: bill }),
    payment: async selection => { if (selection.preparePhysicalCash) { preparations++; return {ok:true,data:{intentId:15}}; } selections.push(selection); throw Error('Lost response'); }
  });
  await view.review();
  view.selectMethod('cash', 'A');
  await view.pay();
  assert.equal(preparations, 1);
  const output = JSON.stringify(view.render());
  assert.match(output, /Ask for help; do not take another payment or run printer checks/);
  assert.doesNotMatch(output, /Register cash sale|Retry the same selection/);
  assert.equal(view.state.uncertain, true);
  view.selectMethod('cash', 'B');
  assert.equal(view.state.account, 'A');
  await view.pay();
  assert.deepEqual(selections.map(({billId,method,account}) => [billId,method,account]), [[1,'cash','A']]);
  assert.deepEqual([view.paymentSelection.billId,view.paymentSelection.method,view.paymentSelection.account], [1,'cash','A']);
});
