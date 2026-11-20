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

function button(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.children.includes(label)) return node;
  for (const child of (node.children || []).flat()) {
    const found = button(child, label);
    if (found) return found;
  }
  return null;
}

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

const trialBill = {...bill, physicalCashControls:false, physicalCardControls:true, physicalCardAvailable:true};
const prepared = {id:2,status:'prepared',profileMatches:true,canDispatch:false};
const approved = {...prepared,status:'approved',canDispatch:true};
const cardFiscal = {...fiscal, method:'card', receipt:{...fiscal.receipt,billId:bill.id,total:bill.total,method:'card',account:'A'}};
const payment = {billId:bill.id, method:'card', account:'A'};
function trialView(data, pay, props) {
  return dialog({bill:async()=>({ok:true,data:data()}),payment:pay},props);
}

test('a device needs both supervised Card A capabilities before offering terminal preparation', async () => {
  for (const data of [bill, {...trialBill,physicalCardControls:false}, {...trialBill,physicalCardAvailable:false}]) {
    const view = trialView(()=>data, ()=>assert.fail('No card request'));
    await view.review();
    assert.equal(button(view.render(),'Card').props.disabled,true);
    view.selectMethod('card');
    assert.equal(view.state.method,'');
    await view.physicalCardAction('prepare');
    assert.equal(button(view.render(),'Prepare Card A trial'),null);
  }
});

test('a commissioned bill reopened without the adapter never offers a fresh or declined card payment',async()=>{
  for (const priorTrial of [{},{physicalCardAvailable:false}]) {
    const data={...bill,fiscalMode:undefined,physicalCashControls:undefined,physicalCardUnavailable:true,...priorTrial};
    const view=trialView(()=>data,()=>assert.fail('No generic payment or terminal action'));
    await view.review();
    assert.equal(button(view.render(),'Card').props.disabled,true);
    view.selectMethod('card');
    assert.equal(view.state.method,'');
    assert.doesNotMatch(JSON.stringify(view.render()),/Prepare Card A trial|Confirm bill|Use the separate terminal/);
    view.setState({method:'card',account:'A'});
    assert.equal(button(view.render(),'Confirm bill'),null);
    await view.pay(true); await view.physicalCardAction('prepare');
    await view.review();
    assert.equal(view.state.method,'');
    view.selectMethod('cash','B');
    assert.equal(view.state.account,'B');
  }
});

test('physical Card A saves intent, observed terminal approval and explicit fiscal confirmation in separate steps', async () => {
  let data=trialBill, confirmed=0, handoffs=0;
  const calls=[];
  const view=trialView(()=>data,async request=>{
    calls.push(JSON.parse(JSON.stringify(request)));
    if (request.preparePhysicalCard) {
      data={...data,physicalCardAvailable:false,physicalCardIntent:prepared};
      return {ok:true,data:{intentId:prepared.id,declineToken:'test-only'}};
    }
    if (request.confirmPhysicalCard) {
      data={...data,physicalCardIntent:approved};
      return {ok:true};
    }
    data={...data,physicalCardIntent:undefined,fiscal:cardFiscal};
    return {ok:true,data:{fiscal:cardFiscal}};
  },{onConfirmed:()=>confirmed++,onPaid:()=>handoffs++});
  await view.review();
  view.selectMethod('card','B');
  assert.equal(view.state.account,'A');
  assert.match(JSON.stringify(view.render()),/before using the separate card terminal for 70 den/);
  await view.pay(true);
  assert.equal(calls.length,0);
  await button(view.render(),'Prepare Card A trial').props.onClick();
  assert.equal(calls.length,1);
  assert.match(JSON.stringify(view.render()),/Use the separate terminal once for 70 den/);
  assert.equal(button(view.render(),'Register real Card A sale on PF700'),null);
  await view.physicalCardAction('register');
  view.selectMethod('cash','B');
  assert.equal(view.state.method,'card');
  await button(view.render(),'Confirm observed terminal approval').props.onClick();
  assert.equal(calls.length,2);
  assert.match(JSON.stringify(view.render()),/terminal approved 70 den.*print a real PF700 receipt/);
  assert.equal(button(view.render(),'Terminal declined or cancelled'),null);
  assert.equal(confirmed,0);
  await button(view.render(),'Register real Card A sale on PF700').props.onClick();
  await view.physicalCardAction('register');
  assert.deepEqual(calls,[{...payment,preparePhysicalCard:true},
    {...payment,physicalCardIntentId:prepared.id,confirmPhysicalCard:true},
    {...payment,physicalCardIntentId:prepared.id}]);
  assert.equal(view.state.receipt.reference,cardFiscal.reference);
  assert.equal(confirmed,1);
  await Promise.all([view.finishReceipt(),view.finishReceipt()]);
  assert.equal(handoffs,1);
});

test('only a fresh terminal session can record an observed decline and release this bill', async () => {
  let data=trialBill;
  const calls=[];
  const view=trialView(()=>data,async request=>{
    calls.push(JSON.parse(JSON.stringify(request)));
    if (request.preparePhysicalCard) {
      data={...data,physicalCardIntent:prepared,physicalCardAvailable:false};
      return {ok:true,data:{intentId:prepared.id,declineToken:'test-only'}};
    }
    data={...trialBill,physicalCardAvailable:false};
    return {ok:true};
  });
  await view.review(); view.selectMethod('card'); await view.physicalCardAction('prepare');
  const reopened=trialView(()=>data,()=>assert.fail('Restart must not create another terminal instruction or release an ambiguous intent'));
  await reopened.review();
  assert.match(JSON.stringify(reopened.render()),/Check the original terminal transaction for 70 den/);
  assert.doesNotMatch(JSON.stringify(reopened.render()),/Use the separate terminal once|Prepare Card A trial|Terminal declined or cancelled/);
  await reopened.physicalCardAction('prepare'); await reopened.physicalCardAction('decline');
  assert.ok(button(reopened.render(),'Confirm observed terminal approval'));
  await button(view.render(),'Terminal declined or cancelled').props.onClick();
  assert.deepEqual(calls.at(-1),{...payment,physicalCardIntentId:prepared.id,declineToken:'test-only'});
  assert.equal(view.state.method,'');
  view.selectMethod('cash','A');
  assert.match(JSON.stringify(view.render()),/Cash checkout is unavailable/);
  assert.doesNotMatch(JSON.stringify(view.render()),/Confirming Cash A will register a real sale/);
  view.selectMethod('cash','B');
  assert.equal(view.state.account,'B');
});

test('lost prepare or approval reply reopens only the original terminal result or fiscal step',async()=>{
  let data=trialBill, writes=0;
  const view=trialView(()=>data,async request=>{
    writes++;
    data={...data,physicalCardAvailable:false,physicalCardIntent:request.preparePhysicalCard ? prepared : approved};
    throw Error('Lost reply');
  });
  await view.review(); view.selectMethod('card'); await view.physicalCardAction('prepare');
  assert.match(JSON.stringify(view.render()),/Check the original terminal transaction/);
  assert.doesNotMatch(JSON.stringify(view.render()),/Use the separate terminal once|Terminal declined or cancelled/);
  await view.physicalCardAction('approve');
  assert.equal(writes,2);
  assert.match(JSON.stringify(view.render()),/terminal approved 70 den/);
  assert.ok(button(view.render(),'Register real Card A sale on PF700'));
  assert.equal(button(view.render(),'Finish recording payment'),null);
});

test('uncertain or already attempted Card A stays held across reload without any second terminal or fiscal sale', async () => {
  for (const status of ['uncertain','pending','failed']) {
    const data={...trialBill,physicalCardIntent:{...approved,canDispatch:false},fiscal:{...cardFiscal,status,reference:null}};
    const view=trialView(()=>data,()=>assert.fail('No device or terminal retry'));
    await view.review();
    assert.ok(view.state.fiscalHold);
    assert.match(JSON.stringify(view.render()),/terminal approved 70 den/);
    assert.doesNotMatch(JSON.stringify(view.render()),/Register real Card A sale on PF700|Confirm observed terminal approval|Finish recording payment|retry the same payment method/i);
    view.selectMethod('cash','B'); await view.pay(); await view.physicalCardAction('register');
    await button(view.render(),'Reload saved bill').props.onClick();
    assert.equal(view.state.method,'card');
  }
});

test('card recovery finishes only the acknowledged local document and holds a mismatched reply or missing read',async()=>{
  let data={...trialBill,fiscalMode:undefined,physicalCardControls:undefined,physicalCardUnavailable:true,
    physicalCardIntent:{...approved,profileMatches:false},fiscal:{...cardFiscal,status:'submitted'}};
  let reads=0,confirmed=0;
  const calls=[];
  const view=dialog({bill:async()=>{
    if (++reads===2) throw Error('Lost review');
    return {ok:true,data};
  },payment:async req=>{
    calls.push(JSON.parse(JSON.stringify(req)));
    data={...data,fiscal:{...cardFiscal,reference:'0009999'}};
    return {ok:true};
  }},{onConfirmed:()=>confirmed++});
  await view.review();
  assert.ok(button(view.render(),'Finish recording payment'));
  assert.equal(button(view.render(),'Register real Card A sale on PF700'),null);
  await button(view.render(),'Finish recording payment').props.onClick();
  await view.physicalCardAction('settle'); await view.pay();
  assert.deepEqual(calls,[{...payment,acknowledgedDocument:cardFiscal.reference}]);
  assert.equal(view.state.uncertain,true);
  await button(view.render(),'Reload saved bill').props.onClick();
  assert.equal(confirmed,0);
  assert.equal(view.state.fiscalHold,true);
  data={...data,physicalCardIntent:undefined,fiscal:cardFiscal};
  await button(view.render(),'Reload saved bill').props.onClick();
  assert.equal(confirmed,1);
  assert.equal(calls.length,1);
});

test('a mismatched external ledger blocks payment and gives the original slip instruction in both languages',async()=>{
  for (const [language,warning] of [['en',/Keep the original terminal slip/],['sq',/deshmine fillestare/]]) {
    const view=trialView(()=>({...trialBill,physicalCardHold:true}),()=>assert.fail('Ledger mismatch must hold all payments'),{language});
    await view.review();
    assert.match(JSON.stringify(view.render()),warning);
    view.selectMethod('cash','B'); view.selectMethod('card'); await view.pay(); await view.physicalCardAction('prepare');
    assert.equal(view.state.account,'');
  }
});

test('repeated clicks and identity loss during terminal preparation never reveal a new terminal instruction',async()=>{
  let resolve,current=true,reads=0,writes=0,leases=0;
  const view=dialog({bill:async()=>{reads++;return {ok:true,data:trialBill};},
    payment:()=>{writes++;return new Promise(done=>{resolve=done;});}},
    {isCurrent:()=>current,beginOperation:()=>{leases++;return {};},endOperation:()=>leases--});
  await view.review(); view.selectMethod('card');
  const first=view.physicalCardAction('prepare'); await view.physicalCardAction('prepare');
  current=false;
  resolve({ok:true,data:{intentId:prepared.id,declineToken:'test-only'}}); await first;
  assert.equal(writes,1); assert.equal(reads,1); assert.equal(leases,0);
  assert.doesNotMatch(JSON.stringify(view.render()),/Use the separate terminal once/);
});

test('a new ledger mismatch reported by Cash A preparation or an ordinary payment locks all tenders',async()=>{
  for (const account of ['A','B']) {
    let requests=0;
    const view=trialView(()=>bill,async()=>{requests++;return {ok:false,fiscalStatus:'cardTrialHold'};});
    await view.review(); view.selectMethod('cash',account); await view.pay();
    assert.match(JSON.stringify(view.render()),/Payments are on hold.*Keep the original terminal slip/);
    view.selectMethod('cash',account==='A'?'B':'A'); await view.pay();
    assert.equal(view.state.account,account); assert.equal(requests,1);
  }
});
