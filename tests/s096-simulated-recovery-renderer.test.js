const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const source = require('./support/renderer-bundle').moduleSource(path.resolve('src/waiter/DesktopBill.js'), 'Feature');

function dialog(api, props = {}) {
  class Component {
    constructor(p) { this.props = p; }
    setState(update) { Object.assign(this.state, update); }
  }
  const React = {Component,createElement:(type,props,...children)=>({type,props:props || {},children})};
  const context = {React,window:{arra:api}};
  vm.runInNewContext(source,context);
  return new context.Feature.DesktopBill({language:'en',orderId:1,...props});
}
function find(node,type,label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type && (label === undefined || node.children.includes(label))) return node;
  for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) {
    const result = find(item,type,label); if (result) return result;
  }
  return null;
}
const line = {itemId:3,name:'Sample',unitPrice:70,quantity:1,modifiers:[],taxRate:10,taxGroup:'В'};
const base = {id:1,lines:[line],total:70,fiscalMode:'simulation',simulationRecoveryControls:true};
const fiscal = {mode:'simulation',status:'uncertain',method:'cash',reference:null,receipt:{lines:[line]}};

test('interruption choice is training-only and sends an explicit simulation request', async () => {
  for (const stage of ['before_open','after_items','after_tender','after_close','after_ack']) {
    const calls = []; let data = base;
    const view = dialog({bill:async()=>({ok:true,data}),payment:async request=>{
      calls.push(request);
      if (request.prepareSimulatedCash) {data={...base,simulatedCashIntent:{id:42,interruption:stage}};return {ok:true,data:{intentId:42}};}
      data={...base,simulatedCashIntent:{id:42,interruption:stage},fiscal}; return {ok:false,fiscalStatus:'uncertain'};
    }});
    await view.review(); view.selectMethod('cash','A');
    const select = find(view.render(),'select'); assert.ok(select);
    select.props.onChange({target:{value:stage}});
    await view.pay(); assert.equal(calls.length,0,'cannot start without durable preparation');
    await view.prepareSimulatedCash(); assert.equal(calls[0].prepareSimulatedCash,stage);
    await view.pay();
    assert.equal(calls.length,2); assert.equal(calls[1].simulateInterrupt,stage); assert.equal(calls[1].intentId,42);
    assert.equal(calls[1].method,'cash'); assert.equal(calls[1].account,'A');
    assert.match(JSON.stringify(view.render()),/Check simulated receipt/);
    view.selectMethod('cash','B'); assert.equal(view.state.account,'A');
  }
  for (const data of [{...base,fiscalMode:'device'}, {...base,simulationRecoveryControls:false}]) {
    const view = dialog({bill:async()=>({ok:true,data})});
    await view.review(); view.selectMethod('cash','A');
    assert.equal(find(view.render(),'select'),null);
  }
});

test('read-only check precedes finishing and rechecks after remount', async () => {
  for (const [stage,message] of [
    ['not_started','has not started'], ['open_unpaid','open and unpaid'],
    ['tendered','paid and still open'], ['closed','is closed']
  ]) {
    const calls = [];
    const api = {bill:async()=>({ok:true,data:{...base,fiscal}}),payment:async request=>{
      calls.push(request);
      if (request.checkSimulated) return {ok:true,data:{stage}};
      if (request.finishSimulated) return {ok:true,data:{id:7,fiscal:{...fiscal,status:'accepted',reference:'SIM-1'}}};
      throw Error('Unexpected payment');
    }};
    const view = dialog(api); await view.review();
    assert.equal(find(view.render(),'button','Finish simulated recovery'),null);
    await view.checkSimulatedCash();
    assert.match(JSON.stringify(view.render()),new RegExp(message));
    assert.equal(calls.length,1); assert.equal(calls[0].checkSimulated,true);
    const reopened = dialog(api); await reopened.review();
    assert.equal(find(reopened.render(),'button','Finish simulated recovery'),null);
    await reopened.checkSimulatedCash(); await reopened.finishSimulatedCash();
    assert.equal(calls.filter(x=>x.finishSimulated).length,1);
    assert.equal(reopened.state.receipt.status,'accepted');
  }
});

test('failed and stale checks retain the hold and never enable finish', async () => {
  let release, current = true, leaseBegins=0, leaseEnds=0, writes=0;
  const pending = new Promise(resolve=>{release=resolve;});
  const api={bill:async()=>({ok:true,data:{...base,fiscal}}),payment:async request=>{
    writes++; if (request.checkSimulated) return pending; throw Error('Unexpected payment');
  }};
  const view=dialog(api,{isCurrent:()=>current,beginOperation:()=>{leaseBegins++;return {};},endOperation:()=>{leaseEnds++;}});
  await view.review();
  const work=view.checkSimulatedCash(); current=false; release({ok:true,data:{stage:'closed'}}); await work;
  assert.equal(view.state.simulatedRecoveryStage,null); assert.equal(leaseBegins,leaseEnds);
  assert.equal(writes,1);
  current=true;
  api.payment=async()=>({ok:true,data:{stage:'unrecognized'}});
  await view.checkSimulatedCash();
  assert.equal(view.state.fiscalHold,true);
  assert.equal(find(view.render(),'button','Finish simulated recovery'),null);
  assert.match(JSON.stringify(view.render()),/remains on hold/);
});

test('a lost start response retries only the durable original intent and scenario', async () => {
  const calls = [];
  const original={...base,simulatedCashIntent:{id:42,interruption:'after_items'}};
  let data=original;
  const view=dialog({bill:async()=>({ok:true,data}),payment:async request=>{
    calls.push(request); if (calls.length===1) throw Error('Lost response');
    data={...original,fiscal}; return {ok:false,fiscalStatus:'uncertain'};
  }});
  await view.review(); await view.pay();
  assert.equal(view.state.uncertain,true);
  assert.match(JSON.stringify(view.render()),/Retry same simulated attempt/);
  view.selectMethod('cash','B'); assert.equal(view.state.account,'A');
  await view.pay();
  assert.equal(calls.length,2);
  assert.equal(calls[1].intentId,42); assert.equal(calls[1].simulateInterrupt,'after_items');
  assert.equal(calls[1].method,'cash'); assert.equal(calls[1].account,'A');
  assert.match(JSON.stringify(view.render()),/Check simulated receipt/);
  assert.equal(find(view.render(),'button','Finish simulated recovery'),null);
});

test('a lost preparation response reloads the durable intent and locks the original scenario after remount', async () => {
  let data=base, writes=0;
  const api={bill:async()=>({ok:true,data}),payment:async request=>{
    writes++; assert.equal(request.prepareSimulatedCash,'after_tender');
    data={...base,simulatedCashIntent:{id:50,interruption:'after_tender'}};
    throw Error('Lost preparation response');
  }};
  const first=dialog(api); await first.review(); first.selectMethod('cash','A');
  find(first.render(),'select').props.onChange({target:{value:'after_tender'}});
  await first.prepareSimulatedCash();
  assert.match(JSON.stringify(first.render()),/Start simulated interrupted sale/);
  const reopened=dialog(api); await reopened.review();
  assert.equal(reopened.state.simulationInterrupt,'after_tender');
  reopened.selectMethod('cash','B'); assert.equal(reopened.state.account,'A');
  assert.equal(writes,1);
});

test('a lost finish response is recovered by a read-only check without another finish', async () => {
  let checks=0, finishes=0;
  const view=dialog({bill:async()=>({ok:true,data:{...base,fiscal}}),payment:async request=>{
    if (request.checkSimulated) {
      checks++;
      return checks===1 ? {ok:true,data:{stage:'closed'}} :
        {ok:true,data:{id:7,fiscal:{...fiscal,status:'accepted',reference:'SIM-1'}}};
    }
    if (request.finishSimulated) { finishes++; throw Error('Lost finish response'); }
    throw Error('Unexpected payment');
  }});
  await view.review(); await view.checkSimulatedCash(); await view.finishSimulatedCash();
  assert.match(JSON.stringify(view.render()),/Check it again/);
  await view.checkSimulatedCash();
  assert.equal(view.state.receipt.status,'accepted');
  assert.equal(finishes,1); assert.equal(checks,2);
});
