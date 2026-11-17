const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const esbuild = require('esbuild');
const path = require('node:path');
const bundle = esbuild.buildSync({stdin:{contents:"export {WaiterPerformance, OperationalCancellations} from './src/admin/ActivityReports.js'",resolveDir:path.resolve('.'),sourcefile:'entry.js'},bundle:true,write:false,format:'iife',globalName:'Activity'}).outputFiles[0].text;
function setup(api) {
  class Component { constructor(props){this.props=props} setState(change){Object.assign(this.state,change)} }
  const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
  const ctx={React,window:{arra:{activityReport:api}}}; vm.runInNewContext(bundle,ctx); return ctx.Activity;
}
test('waiter report handles selection, invalid dates, denied requests and stale unmounted responses', async () => {
  let resolve, requests=[];
  const api=req=>{requests.push(req); return new Promise(r=>resolve=r)};
  const {WaiterPerformance}=setup(api), view=new WaiterPerformance({language:'en'});
  view.componentDidMount(); assert.equal(view.state.busy,true); resolve({ok:true,data:[{id:2,username:'Sample',active:0}]}); await new Promise(setImmediate);
  assert.match(JSON.stringify(view.render()),/Inactive/);
  await view.load({preventDefault(){}}); assert.match(view.state.error,/valid date range/); assert.equal(requests.length,1);
  Object.assign(view.state,{staffId:'2',from:'2026-01-02',to:'2026-01-01'}); await view.load({preventDefault(){}}); assert.match(view.state.error,/valid date range/);
  Object.assign(view.state,{from:'2026-01-01',to:'2026-01-02'}); let pending=view.load({preventDefault(){}}); assert.equal(view.state.busy,true); resolve({ok:false}); await pending; assert.match(view.state.error,/access/);
  view.props.language='sq'; pending=view.load({preventDefault(){}}); resolve({ok:false,tooLarge:true}); await pending; assert.match(JSON.stringify(view.render()),/Ka shumë regjistrime/);
  pending=view.load({preventDefault(){}}); view.componentWillUnmount(); resolve({ok:true,data:{total:99}}); await pending; assert.equal(view.state.data,null);
});
test('cancellation report displays empty and failure states in Albanian and ignores unmounted result', async () => {
  let resolve; const {OperationalCancellations}=setup(()=>new Promise(r=>resolve=r));
  const view=new OperationalCancellations({language:'sq',from:1,to:2}); view.componentDidMount(); assert.match(JSON.stringify(view.render()),/Duke ngarkuar/);
  resolve({ok:true,data:{cancellations:[]}}); await new Promise(setImmediate);
  const tree=view.render(), table=tree.children.find(c=>c && typeof c.type==='function'); assert.ok(table); assert.match(JSON.stringify(table.type(table.props)),/Nuk ka anulime/);
  const next=new OperationalCancellations({language:'sq',from:1,to:2}); next.componentDidMount(); resolve({ok:false}); await new Promise(setImmediate); assert.match(JSON.stringify(next.render()),/Kontrolloni qasjen/);
  const stale=new OperationalCancellations({language:'en',from:1,to:2}); stale.componentDidMount(); stale.componentWillUnmount(); resolve({ok:true,data:{cancellations:[{id:1}]}}); await new Promise(setImmediate); assert.equal(stale.state.rows.length,0);
});

test('waiter report labels money in MKD without a duplicate sales metric', () => {
  const {WaiterPerformance}=setup(()=>{});
  for (const language of ['en','sq']) {
    const view=new WaiterPerformance({language});
    Object.assign(view.state,{busy:false,data:{total:21150,orders:55,cash:16400,card:4750,quantity:0,value:0,payments:1,cancellations:[{id:1,name:'Sample',quantity:1,orderId:1,tableId:1,actor:'Sample',occurredAt:1,reason:'Sample',unitPrice:125,value:125}]}});
    const tree=view.render(), text=JSON.stringify(tree);
    assert.match(text,/21150 MKD/); assert.match(text,/16400 MKD/); assert.match(text,/4750 MKD/); assert.match(text,/0 MKD/);
    assert.doesNotMatch(text,/"Sales"/); assert.doesNotMatch(text,/minor units/);
    const table=tree.children.find(c=>c && c.type==='fragment').children.find(c=>c && typeof c.type==='function');
    assert.match(JSON.stringify(table.type(table.props)),/125 MKD/);
  }
});

test('operational cancellations remain available when paid report fails and clear when either date changes', async () => {
  class Component { constructor(props){this.props=props} setState(change){Object.assign(this.state,change)} }
  const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
  const source=esbuild.buildSync({stdin:{contents:"export {OperationalReports} from './src/admin/OperationalReports.js'",resolveDir:path.resolve('.'),sourcefile:'entry.js'},bundle:true,write:false,format:'iife',globalName:'Reports'}).outputFiles[0].text;
  const ctx={React,window:{arra:{operationalReports:async()=>({ok:false})}}}; vm.runInNewContext(source,ctx);
  const screen=new ctx.Reports.OperationalReports({language:'en'}); Object.assign(screen.state,{from:'2026-01-01',to:'2026-01-02'});
  await screen.load({preventDefault(){}}); assert.match(screen.state.error,/unavailable/); assert.ok(screen.state.activeRange);
  const firstSequence=screen.state.activeRange.sequence;
  await screen.load({preventDefault(){}}); assert.notEqual(screen.state.activeRange.sequence,firstSequence);
  const findAll=(n,type,out=[])=>{if(!n||typeof n!=='object')return out; if(n.type===type)out.push(n); for(const c of n.children||[]) for(const x of Array.isArray(c)?c:[c])findAll(x,type,out); return out};
  const fields=findAll(screen.render(),'input'); assert.equal(fields.length,2);
  fields[1].props.onChange({target:{value:'2026-01-03'}}); assert.equal(screen.state.activeRange,null);
});
