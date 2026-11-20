const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const source = require('./support/renderer-bundle').moduleSource(path.resolve('src/waiter/DesktopBill.js'), 'Feature');

function dialog(api, props = {}) {
  class Component { constructor(props) { this.props=props; } setState(update) { Object.assign(this.state,update); } }
  const React={Component,createElement:(type,props,...children)=>({type,props:props||{},children})};
  const context={React,window:{arra:api}};
  vm.runInNewContext(source,context);
  return new context.Feature.DesktopBill({language:'en',orderId:1,...props});
}
const line={itemId:3,name:'Sample',unitPrice:50,quantity:1,modifiers:[],taxRate:10,taxGroup:'В',domesticProduct:false};
const base={id:1,lines:[line],total:50,fiscalMode:'device',physicalCashControls:true,fiscalDomesticProduct:false};
const intent={id:12,profileMatches:true};
const fiscal={mode:'device',method:'cash',status:'accepted',reference:'0000002',receipt:{lines:[line],domesticProduct:false}};
const keys=request=>JSON.parse(JSON.stringify(request));
function find(node,type,predicate=()=>true){
  if(!node||typeof node!=='object')return null;
  if(node.type===type&&predicate(node))return node;
  for(const child of node.children||[])for(const item of Array.isArray(child)?child:[child]){const found=find(item,type,predicate);if(found)return found;}
  return null;
}

test('physical Cash A is durably prepared before the original sale and uses one identity',async()=>{
  const calls=[];const view=dialog({bill:async()=>({ok:true,data:base}),payment:async request=>{
    calls.push(keys(request));
    if(request.preparePhysicalCash)return {ok:true,data:{intentId:intent.id}};
    return {ok:true,data:{fiscal}};
  }});
  await view.review();view.selectMethod('cash');await view.pay();
  assert.deepEqual(calls,[{billId:1,method:'cash',account:'A',preparePhysicalCash:true},
    {billId:1,method:'cash',account:'A',physicalIntentId:intent.id}]);
  assert.equal(view.state.receipt.status,'accepted');
});

test('lost preparation stays locked and retries the same preparation before any device sale',async()=>{
  const calls=[];const locks=[];const view=dialog({bill:async()=>({ok:true,data:base}),payment:async request=>{
    calls.push(keys(request));if(calls.length===1)throw Error('Lost response');
    if(request.preparePhysicalCash)return {ok:true,data:{intentId:intent.id}};
    return {ok:false,fiscalStatus:'uncertain'};
  }},{onUncertain:value=>locks.push(value)});
  await view.review();view.selectMethod('cash');await view.pay();
  assert.equal(view.state.uncertain,true);assert.equal(view.state.physicalPreparationUncertain,true);
  assert.match(JSON.stringify(view.render()),/Retry to register cash sale/);
  view.selectMethod('cash','B');assert.equal(view.state.account,'A');
  assert.equal(calls.length,1);
  await view.pay();
  assert.deepEqual(calls.map(x=>Object.hasOwn(x,'preparePhysicalCash')?'prepare':'sale'),['prepare','prepare','sale']);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[2].physicalIntentId,intent.id);
  assert.equal(locks[0],true);
});

test('lost physical sale reloads only saved state and never sends another printer request',async()=>{
  let current=base;const calls=[];const locks=[];
  const view=dialog({bill:async()=>({ok:true,data:current}),payment:async request=>{
    calls.push(keys(request));if(request.preparePhysicalCash){current={...base,physicalCashIntent:intent};return {ok:true,data:{intentId:intent.id}};}
    throw Error('Lost sale response');
  }},{onUncertain:value=>locks.push(value)});
  await view.review();view.selectMethod('cash');await view.pay();
  assert.equal(view.state.uncertain,true);assert.equal(calls.length,2);
  await view.pay();assert.equal(calls.length,2);
  current={...base,physicalCashIntent:intent,fiscal:{...fiscal,status:'uncertain',reference:null}};
  await view.reloadPhysicalCash();
  assert.equal(calls.length,2);assert.equal(view.state.fiscalHold,true);
  assert.equal(view.state.fiscalStatus,'uncertain');assert.equal(locks.at(-1),false);
  assert.doesNotMatch(JSON.stringify(view.render()),/Cancel prepared checkout|Register cash sale/);
});

test('mismatched profile and failed reload keep the original device selection locked',async()=>{
  let data={...base,physicalCashIntent:{id:12,profileMatches:false}};
  let writes=0;const view=dialog({bill:async()=>({ok:true,data}),payment:async()=>{writes++;}});
  await view.review();assert.equal(view.state.fiscalHold,true);view.selectMethod('cash','B');
  assert.equal(view.state.account,'A');await view.pay();assert.equal(writes,0);
  assert.match(JSON.stringify(view.render()),/Reopen checkout with the original printer/);
  assert.doesNotMatch(JSON.stringify(view.render()),/Cancel prepared checkout/);
});

test('prepared intent may be cancelled only before any fiscal attempt',async()=>{
  let data={...base,physicalCashIntent:intent};const calls=[];
  const view=dialog({bill:async()=>({ok:true,data}),payment:async request=>{
    calls.push(keys(request));if(request.releasePhysicalCash){data=base;return {ok:true};}throw Error('Unexpected sale');
  }});
  await view.review();assert.match(JSON.stringify(view.render()),/Cancel prepared checkout/);
  await view.cancelPhysicalCash();assert.equal(calls.length,1);assert.equal(calls[0].releasePhysicalCash,true);
  assert.equal(view.state.fiscalTenderFixed,false);view.selectMethod('cash','B');assert.equal(view.state.account,'B');
});

test('a stale identity response cannot start the device after preparation',async()=>{
  let current=true,release;const calls=[];let starts=0,ends=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const view=dialog({bill:async()=>({ok:true,data:base}),payment:async request=>{
    calls.push(keys(request));return pending;
  }},{isCurrent:()=>current,beginOperation:()=>{starts++;return {};},endOperation:()=>{ends++;}});
  await view.review();view.selectMethod('cash');const work=view.pay();current=false;
  release({ok:true,data:{intentId:intent.id}});await work;
  assert.equal(calls.length,1);assert.equal(calls[0].preparePhysicalCash,true);assert.equal(starts,ends);
});

for (const profile of ['device','different device','no printer','simulation']) {
  test(`saved physical acknowledgement finishes locally after a lost settlement reply with ${profile}`,async()=>{
    const calls=[];
    const data={...base, fiscalMode:profile==='different device'?'device':profile==='no printer'?undefined:profile,
      physicalCashIntent:{...intent,profileMatches:profile==='device'}, simulationRecoveryControls:profile==='simulation',
      fiscal:{...fiscal,status:'submitted'}};
    const view=dialog({bill:async()=>({ok:true,data}),payment:async request=>{
      calls.push(keys(request));
      if (calls.length===1) throw Error('Lost local response');
      return {ok:true,data:{fiscal}};
    }});
    await view.review();
    for (let i=0;i<2;i++) {
      const output=JSON.stringify(view.render());
      assert.doesNotMatch(output,/Register cash sale|Check printer status|Cancel prepared checkout|uses a simulated printer|Check simulated receipt/);
      const finish=find(view.render(),'button',n=>n.children.includes('Finish recording payment'));
      assert.ok(finish && !finish.props.disabled);
      view.selectMethod('cash','B');
      assert.equal(view.state.account,'A');
      await finish.props.onClick();
    }
    const localRequest={billId:1,method:'cash',account:'A',acknowledgedDocument:fiscal.reference};
    assert.deepEqual(calls,[localRequest,localRequest]);
    assert.equal(view.state.receipt.status,'accepted');
  });
}

test('local settlement retains its document on a mismatched reply and clears the bill when access is withdrawn',async()=>{
  const calls=[], locks=[];
  const data={...base,physicalCashIntent:intent,fiscal:{...fiscal,status:'submitted'}};
  const view=dialog({bill:async()=>({ok:true,data}),payment:async request=>{
    calls.push(keys(request));
    return calls.length===1 ? {ok:true,data:{fiscal:{...fiscal,reference:'0000009'}}} : {ok:false,error:'Access denied'};
  }},{onUncertain:value=>locks.push(value)});
  await view.review();await view.pay();
  assert.equal(view.state.uncertain,true);
  assert.equal(view.state.receipt,undefined);
  await view.pay();
  assert.deepEqual(calls[0],calls[1]);
  assert.equal(calls[1].acknowledgedDocument,fiscal.reference);
  assert.equal(view.state.data,null);
  assert.equal(view.state.error,'Access denied');
  assert.equal(locks.at(-1),false);
});

test('the waiter reopens the journal-confirmed Cash A receipt and retries only its local finish', async () => {
  const calls = [];
  const lines = [{...line,name:'Espresso',unitPrice:70,domesticProduct:true},
    {...line,itemId:4,name:'Macchiato',unitPrice:80,domesticProduct:true}];
  const confirmed = {...fiscal, reference:'0000030',receipt:{domesticProduct:false,lines},
    evidence:{kind:'numbered-journal',documentNumber:'0000030'}};
  // The recovery package has no active printer profile. Bill review still
  // includes the frozen receipt with both original VAT groups and origins.
  const data = {id:2,total:150,lines:lines.map(({taxRate,taxGroup,domesticProduct,...billLine}) => billLine),
    physicalCashIntent:{...intent,profileMatches:false},fiscal:{...confirmed,status:'submitted'}};
  const view = dialog({bill:async () => ({ok:true,data}), payment:async request => {
    calls.push(keys(request));
    if (calls.length === 1) throw Error('Lost local response');
    return {ok:true,data:{id:1,fiscal:confirmed}};
  }});
  await view.review();
  assert.equal(calls.length,0);
  for (let i = 0; i < 2; i++) {
    const output = JSON.stringify(view.render());
    assert.match(output,/journal confirms receipt 0000030/);
    assert.match(output,/150 den/);
    assert.equal(output.match(/Macedonian-product mark included/g)?.length,2);
    assert.equal(output.match(/VAT 10%/g)?.length,2);
    assert.doesNotMatch(output,/acknowledged|Check printer status|Register cash sale|Macedonian-product mark omitted/i);
    const button = find(view.render(),'button',n => n.children.includes('Finish recording payment'));
    assert.ok(button && !button.props.disabled);
    await button.props.onClick();
  }
  assert.deepEqual(calls,Array(2).fill({billId:2,account:'A',method:'cash',acknowledgedDocument:'0000030'}));
  assert.equal(view.state.receipt.status,'accepted');
});

test('a definitely failed historic attempt is prepared again before another printer request',async()=>{
  const calls=[];const view=dialog({bill:async()=>({ok:true,data:{...base,fiscal:{...fiscal,status:'failed',reference:null}}}),payment:async request=>{
    calls.push(keys(request));return request.preparePhysicalCash ? {ok:true,data:{intentId:intent.id}} : {ok:false,fiscalStatus:'uncertain'};
  }});
  await view.review();await view.pay();
  assert.equal(calls.length,2);assert.equal(calls[0].preparePhysicalCash,true);assert.equal(calls[1].physicalIntentId,intent.id);
});

test('missing physical capability prevents a sale and explains why',async()=>{
  let writes=0;const view=dialog({bill:async()=>({ok:true,data:{...base,physicalCashControls:false}}),payment:async()=>{writes++;}});
  await view.review();view.selectMethod('cash');await view.pay();
  assert.equal(writes,0);assert.match(JSON.stringify(view.render()),/Cash checkout is unavailable/);
  assert.doesNotMatch(JSON.stringify(view.render()),/Register cash sale/);
});

test('printer status requires explicit attestation and never releases the unresolved bill',async()=>{
  const calls=[];const data={...base,physicalCashIntent:intent,canInspectPhysicalCash:true,fiscal:{...fiscal,status:'uncertain',reference:null}};
  const observation={open:true,items:1,amountMinor:5000,tenderMinor:0,lastDocumentNumber:'0000001'};
  const view=dialog({bill:async()=>({ok:true,data}),payment:async req=>{calls.push(keys(req));return {ok:true,data:{observation}};}});
  await view.review();
  assert.match(JSON.stringify(view.render()),/replaces its last saved response/);
  assert.match(JSON.stringify(view.render()),/does not prove this receipt matches/);
  const checkbox=find(view.render(),'input',n=>n.props.type==='checkbox');assert.ok(checkbox);
  let button=find(view.render(),'button',n=>n.children.includes('Check printer status'));assert.equal(button.props.disabled,true);
  await view.inspectPhysicalCash();assert.equal(calls.length,0);
  checkbox.props.onChange({target:{checked:true}});button=find(view.render(),'button',n=>n.children.includes('Check printer status'));assert.equal(button.props.disabled,false);
  await view.inspectPhysicalCash();
  assert.deepEqual(calls,[{billId:1,method:'cash',account:'A',inspectPhysicalCash:true,checkedNoOtherActivity:true}]);
  const output=JSON.stringify(view.render());
  assert.match(output,/not verified against this bill/);assert.match(output,/Printer reports an open receipt/);
  assert.match(output,/50\.00 den/);assert.match(output,/0\.00 den/);
  assert.equal(view.state.fiscalHold,true);assert.equal(view.state.physicalCheckAcknowledged,false);
  assert.doesNotMatch(output,/Finish recording payment|Register cash sale|Finish simulated recovery|Cancel prepared checkout/);
});

test('legacy, pending, and mismatched-profile checkouts never expose or run a device inquiry',async()=>{
  for (const data of [
    {...base,physicalCashIntent:intent,fiscal:{...fiscal,status:'uncertain'},canInspectPhysicalCash:false},
    {...base,physicalCashIntent:intent,fiscal:{...fiscal,status:'pending'},canInspectPhysicalCash:true},
    {...base,physicalCashIntent:{...intent,profileMatches:false},fiscal:{...fiscal,status:'uncertain'},canInspectPhysicalCash:true},
    {...base,fiscalMode:'simulation',canInspectPhysicalCash:true,fiscal:{...fiscal,mode:'simulation',status:'uncertain'}}
  ]) {
    let writes=0;const view=dialog({bill:async()=>({ok:true,data}),payment:async()=>{writes++;}});
    await view.review();view.setState({physicalCheckAcknowledged:true});await view.inspectPhysicalCash();
    assert.equal(writes,0);assert.equal(find(view.render(),'button',n=>n.children.includes('Check printer status')),null);
  }
});

test('malformed or failed printer checks remain unresolved and require fresh attestation',async()=>{
  for(const response of [{ok:true,data:{observation:{open:true,items:1,amountMinor:5000,tenderMinor:0,lastDocumentNumber:'wrong'}}},{ok:false,fiscalStatus:'uncertain'},new Error('Unavailable')]){
    const data={...base,physicalCashIntent:intent,canInspectPhysicalCash:true,fiscal:{...fiscal,status:'uncertain'}};
    const view=dialog({bill:async()=>({ok:true,data}),payment:async()=>{if(response instanceof Error)throw response;return response;}});
    await view.review();view.setState({physicalCheckAcknowledged:true});await view.inspectPhysicalCash();
    assert.equal(view.state.physicalObservation,null);assert.equal(view.state.physicalCheckAcknowledged,false);assert.equal(view.state.fiscalHold,true);
    assert.match(JSON.stringify(view.render()),/Could not check the printer. The receipt remains unresolved/);
  }
});

test('stale printer observation is discarded after identity changes',async()=>{
  let current=true,release;let begins=0,ends=0;const pending=new Promise(resolve=>{release=resolve;});
  const data={...base,physicalCashIntent:intent,canInspectPhysicalCash:true,fiscal:{...fiscal,status:'uncertain'}};
  const view=dialog({bill:async()=>({ok:true,data}),payment:()=>pending},{isCurrent:()=>current,beginOperation:()=>{begins++;return {};},endOperation:()=>{ends++;}});
  await view.review();view.setState({physicalCheckAcknowledged:true});const work=view.inspectPhysicalCash();current=false;
  release({ok:true,data:{observation:{open:true,items:1,amountMinor:5000,tenderMinor:0,lastDocumentNumber:'0000001'}}});await work;
  assert.equal(view.state.physicalObservation,null);assert.equal(begins,ends);
});
