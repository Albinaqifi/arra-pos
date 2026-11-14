const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('test print list failure stays visible and refresh recovers', async () => {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  let fail = true;
  const context = { React: { Component, createElement: (type, props, ...children) => ({type, props, children}) }, window: { arra: { testPrinting: async () => fail ? {ok:false} : {ok:true, data:{queues:[],jobs:[]}} } } };
  vm.runInNewContext(require('./support/renderer-bundle')() + '\nthis.TestPrintJobs=TestPrintJobs;', context);
  const printing = new context.RendererModules.PrintingSession({ bridge: context.window.arra });
  const jobs = new context.TestPrintJobs({ printing });
  await jobs.load();
  assert.match(jobs.state.error, /status unavailable/i);
  assert.equal(jobs.render().type, 'section');
  fail = false;
  await jobs.load();
  assert.equal(jobs.state.error, '');
  assert.equal(jobs.state.data.jobs.length, 0);
});

test('scoped financial detail retains sample bill printing without exposing correction history', () => {
  class Component { constructor(props) { this.props=props; } setState(update) { Object.assign(this.state,update); } }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const context={React,window:{arra:{testPrinting:async()=>({ok:true,data:{jobs:[]}})}}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);
  const data={bill:{id:42,orderId:3,tableId:4,total:100,openedAt:1,generatedAt:2,actorId:1},payment:{id:7,amount:100,account:'A',method:'cash',paidAt:3,actorId:1},lines:[],corrections:null};
  const all=n=>!n||typeof n!=='object'?[]:[n,...(n.children||[]).flat().flatMap(all)];
  const screen=new context.ArraComponents.FinancialVisibility({});screen.setState({view:'history',detail:data});
  const detail=all(screen.render()).find(n=>typeof n.type==='function' && n.type.name==='FinancialDetail');
  const tree=detail.type(detail.props);
  const print=all(tree).find(n=>typeof n.type==='function' && n.type.name==='TestBillPrint');
  assert.equal(print.props.billId,42);
  const control=new print.type(print.props); assert.match(JSON.stringify(control.render()),/not a fiscal receipt/);
  assert.doesNotMatch(JSON.stringify(tree),/Original account|Account correction history/);
});
