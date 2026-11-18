const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
function harness(scope='combined') {
  class Component { constructor(props){this.props=props} setState(p){Object.assign(this.state,p)} }
  const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
  const state={actorId:987,scope,issues:{orders:[],printJobs:[]},days:[{id:8,openedAt:1,closedAt:null}]};
  const calls=[];let wallet={dayId:8,shiftId:3,expected:100,revision:'revision',baseline:20};let closing=async()=>({ok:true});
  const api={businessDays:async req=>{calls.push(req);if(req.action==='walletStatus')return {ok:true,data:wallet};if(req.action==='walletDayClose')return closing(req);if(req.action==='shiftList')return {ok:true,data:{dayId:8,shifts:[]}};if(req.action==='close')return {ok:true};return {ok:true,data:state}},financialVisibility:async()=>({ok:true,data:{groups:[]}})};
  const context={React,window:{arra:api},crypto:{randomUUID:()=> 'unique'},setTimeout,clearTimeout};
  vm.runInNewContext(require('./support/renderer-bundle').moduleSource(path.resolve(__dirname,'../src/admin/BusinessDays.js'),'Days'),context);
  return {page:()=>new context.Days.BusinessDays({language:'en'}),state,calls,setWallet:x=>wallet=x,setClose:x=>closing=x};
}
const render=p=>JSON.stringify(p.render());
test('tracked Combined count shows variance and submits explicit zero with revision',async()=>{
 const h=harness(),p=h.page();await p.load();await p.review(8);assert.match(render(p),/Final wallet count/);p.setState({walletCount:'0'});assert.match(render(p),/Short/);await p.close(8,true);let r=h.calls.find(x=>x.action==='walletDayClose');assert.equal(r.counted,0);assert.equal(r.revision,'revision');assert.equal(r.dayId,8);assert.equal(r.shiftId,3);p.componentWillUnmount();
});
test('skip and scoped day-only flows use ordinary close without wallet information',async()=>{
 const h=harness(),p=h.page();await p.load();await p.review(8);await p.close(8);assert.equal(h.calls.filter(x=>x.action==='close').length,1);assert.equal(h.calls.filter(x=>x.action==='walletDayClose').length,0);p.componentWillUnmount();
 const restricted=harness('A'),q=restricted.page();await q.load();await q.review(8);assert.doesNotMatch(render(q),/Final wallet count/);assert.equal(restricted.calls.filter(x=>x.action==='walletStatus').length,0);q.componentWillUnmount();
 const untracked=harness(),u=untracked.page();untracked.setWallet({dayId:8,shiftId:3,expected:null});await u.load();await u.review(8);assert.doesNotMatch(render(u),/Final wallet count/);u.componentWillUnmount();
});
test('stale count is discarded and requires a fresh review and count',async()=>{
 const h=harness(),p=h.page();h.setClose(async()=>({ok:false,error:'stale'}));await p.load();await p.review(8);p.setState({walletCount:'50'});await p.close(8,true);assert.equal(p.state.confirmId,null);assert.equal(p.state.walletCount,'');assert.match(p.state.error,/count again/);await p.review(8);assert.equal(p.state.walletCount,'');p.componentWillUnmount();
});
test('unavailable wallet status makes skipping explicit and offers a fresh review',async()=>{
 const h=harness(),p=h.page();h.setWallet(null);await p.load();await p.review(8);assert.equal(p.state.walletUnavailable,true);assert.match(render(p),/Wallet status is unavailable/);assert.match(render(p),/Close without counting/);assert.doesNotMatch(render(p),/Confirm count and close/);await p.close(8);assert.equal(h.calls.filter(x=>x.action==='close').length,1);p.componentWillUnmount();
});
test('pending counted close survives remount until original request settles',async()=>{
 const h=harness();let resolve;h.setClose(()=>new Promise(r=>resolve=r));let p=h.page();await p.load();await p.review(8);p.setState({walletCount:'100'});const pending=p.close(8,true);await new Promise(r=>setImmediate(r));p.componentWillUnmount();let q=h.page();await q.load();assert.equal(q.state.unknownId,8);await q.checkClose();assert.match(q.state.error,/still settling/);assert.equal(q.state.unknownId,8);h.state.days[0].closedAt=100;resolve({ok:true});await pending;await q.checkClose();assert.equal(q.state.completedId,8);assert.equal(h.calls.filter(x=>x.action==='walletDayClose').length,1);q.componentWillUnmount();
});
