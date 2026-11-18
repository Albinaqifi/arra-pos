const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const source=require('./support/renderer-bundle').moduleSource(path.resolve('src/admin/ShiftClose.js'),'Feature');
function setup(api){class Component{constructor(props){this.props=props}setState(x){Object.assign(this.state,x)}};const context={React:{Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:api,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}}};vm.runInNewContext(source,context);return context.Feature.ShiftClose;}
const tick=()=>new Promise(setImmediate);
function fixture(){
  let actor=1,scope='combined',coverage='available',shifts=[{id:11,dayId:5,openedAt:1000,closedAt:null,reportable:true,count:2,total:150,cash:100,card:50}],result='success';
  const calls=[];
  const api={businessDays:async req=>{calls.push(req);if(req.action==='list')return {ok:true,data:{actorId:actor,scope,days:[{id:5,closedAt:null}],issues:{orders:[{}]}}};if(req.action==='shiftList')return {ok:true,data:{dayId:5,coverage,shifts}};if(req.action==='walletStatus')return {ok:false};if(result==='reject')return {ok:false};if(result==='throw')throw Error('lost');const closed={...shifts.find(s=>s.id===req.shiftId),closedAt:2000,total:160};shifts=[{id:12,dayId:5,openedAt:2000,closedAt:null,reportable:false,count:0,total:0,cash:0,card:0},closed];return {ok:true,data:{shift:closed}};}};
  return {api,calls,setActor:(a,s)=>{actor=a;scope=s},setShifts:s=>shifts=s,setCoverage:c=>coverage=c,setResult:r=>result=r};
}
test('review refreshes the shift, confirms once, and presents the saved close',async()=>{
  const f=fixture(),C=setup(f.api);let done=0;const screen=new C({language:'en',onDone:()=>done++});screen.componentDidMount();await tick();assert.equal(screen.active().id,11);assert.match(JSON.stringify(screen.render()),/Open orders carry over/);
  await screen.review();assert.equal(screen.state.confirm,true);assert.match(JSON.stringify(screen.render()),/business day stays open/);screen.setState({confirm:false});assert.equal(screen.state.confirm,false);await screen.review();await screen.close();assert.equal(screen.state.completed.total,160);assert.equal(screen.state.completed.closedAt,2000);assert.equal(f.calls.filter(x=>x.action==='shiftClose').length,1);assert.match(JSON.stringify(screen.render()),/Shift closed/);screen.componentWillUnmount();
});
test('unknown result stays with its original actor across navigation and resolves by original target',async()=>{
  const f=fixture(),C=setup(f.api);let screen=new C({language:'en'});screen.componentDidMount();await tick();await screen.review();f.setResult('throw');await screen.close();assert.equal(screen.state.unknownId,11);screen.componentWillUnmount();
  f.setActor(2,'A');let other=new C({language:'en'});other.componentDidMount();await tick();assert.equal(other.state.unknownId,null);other.componentWillUnmount();
  f.setActor(1,'combined');screen=new C({language:'en'});screen.componentDidMount();await tick();assert.equal(screen.state.unknownId,11);await screen.check();assert.equal(screen.state.unknownId,null);assert.match(screen.state.error,/still open/);await screen.review();f.setResult('success');await screen.close();assert.equal(screen.state.completed.id,11);screen.componentWillUnmount();
});
test('stale review refuses a changed target; empty and upgrade states have no close action',async()=>{
  const f=fixture(),C=setup(f.api),screen=new C({language:'sq'});screen.componentDidMount();await tick();f.setShifts([{id:12,dayId:5,openedAt:2000,closedAt:null,reportable:true,count:0,total:0,cash:0,card:0}]);await screen.review();assert.equal(screen.state.confirm,false);assert.match(screen.state.error,/changed/);f.setShifts([]);await screen.load();assert.match(JSON.stringify(screen.render()),/Ende nuk ka nderrim/);f.setCoverage('unavailable');await screen.load();assert.match(JSON.stringify(screen.render()),/diten tjeter te punes/);screen.componentWillUnmount();
});
test('a remounted screen cannot clear an open status while the original close is pending',async()=>{
  const f=fixture(),original=f.api.businessDays;let settle;
  const delayed=new Promise(resolve=>settle=resolve);
  f.api.businessDays=async req=>req.action==='shiftClose' ? delayed : original(req);
  const C=setup(f.api),first=new C({language:'en'});first.componentDidMount();await tick();await first.review();const closing=first.close();first.componentWillUnmount();
  const second=new C({language:'en'});second.componentDidMount();await tick();assert.equal(second.state.unknownId,11);await second.check();assert.equal(second.state.unknownId,11);assert.match(second.state.error,/still settling/);
  f.setShifts([{id:12,dayId:5,openedAt:2000,closedAt:null,reportable:false,count:0,total:0,cash:0,card:0},{id:11,dayId:5,openedAt:1000,closedAt:2000,reportable:true,count:2,total:150,cash:100,card:50}]);
  settle({ok:true,data:{shift:{id:11,closedAt:2000}}});await closing;await second.check();assert.equal(second.state.completed.id,11);assert.equal(second.state.unknownId,null);second.componentWillUnmount();
});
