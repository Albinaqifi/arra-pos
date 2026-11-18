const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path');
const source=require('./support/renderer-bundle').moduleSource(path.resolve('src/admin/ShiftClose.js'),'Feature');
const tick=()=>new Promise(setImmediate);
function setup(){
  let actor=1,scope='A',status=null,attempts=0,lost=false,release,requests=[];
  const shifts=[{id:20,dayId:4,openedAt:1000,closedAt:3000,reportable:true,count:1,total:120,cash:120,card:0},{id:21,dayId:5,openedAt:4000,closedAt:6000,reportable:true,count:2,total:200,cash:150,card:50}];
  const api={businessDays:async r=>{requests.push(r);if(r.action==='list')return {ok:true,data:{actorId:actor,scope,days:[{id:6,closedAt:null}],issues:{orders:[]}}};if(r.action==='shiftList')return {ok:true,data:{dayId:6,coverage:'available',shifts:shifts.map(s=>({...s,printAttempts:s.id===20?attempts:0,printResult:s.id===20?status:null}))}};if(r.action==='shiftPrint'){attempts++;status='accepted';if(lost)throw Error('lost');return {ok:true,data:{replayed:false}};}if(r.action==='shiftPrintStatus')return {ok:true,data:{found:!!attempts,result:status}};}};
  class Component{constructor(props){this.props=props}setState(x){Object.assign(this.state,x)}}
  const context={React:{Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:api,confirm:()=>true},crypto:{randomUUID:()=>`token-${requests.length}`}};vm.runInNewContext(source,context);
  return {C:context.Feature.ShiftClose,requests,setActor:(a,s)=>{actor=a;scope=s},setLost:x=>lost=x};
}
test('history displays one saved scoped report and prints only on request',async()=>{
  const f=setup(),screen=new f.C({language:'en'});screen.componentDidMount();await tick();
  let rendered=JSON.stringify(screen.render());assert.match(rendered,/Previous shifts/);assert.match(rendered,/Day #4/);assert.match(rendered,/Day #5/);assert.equal(f.requests.filter(r=>r.action==='shiftPrint').length,0);
  screen.setState({selectedId:20});rendered=JSON.stringify(screen.render());assert.match(rendered,/Business day #4/);assert.match(rendered,/Non-fiscal shift report/);assert.doesNotMatch(rendered,/Day #5/);await screen.print(20);assert.equal(f.requests.filter(r=>r.action==='shiftPrint').length,1);assert.match(JSON.stringify(screen.render()),/Check the paper/);screen.componentWillUnmount();
});
test('lost print response is reconciled for the original identity before a new attempt',async()=>{
  const f=setup(),screen=new f.C({language:'en'});screen.componentDidMount();await tick();screen.setState({selectedId:20});f.setLost(true);await screen.print(20);assert.match(screen.state.error,/unknown/);screen.componentWillUnmount();
  f.setActor(2,'B');const other=new f.C({language:'en'});other.componentDidMount();await tick();other.setState({selectedId:20});assert.doesNotMatch(JSON.stringify(other.render()),/Check print status/);other.componentWillUnmount();
  f.setActor(1,'A');const back=new f.C({language:'en'});back.componentDidMount();await tick();back.setState({selectedId:20});assert.match(JSON.stringify(back.render()),/Check print status/);await back.refreshPrint(20);assert.equal(f.requests.filter(r=>r.action==='shiftPrint').length,1);assert.equal(f.requests.filter(r=>r.action==='shiftPrintStatus').length,1);assert.match(JSON.stringify(back.render()),/Check the paper/);back.componentWillUnmount();
});
