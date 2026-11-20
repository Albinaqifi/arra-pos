const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const {moduleSource}=require('./support/renderer-bundle');
test('daily control screen sends one request per click, blocks overlap, and reports failures',async()=>{
  class Component { constructor(props){this.props=props;} setState(value){Object.assign(this.state,value);} }
  const calls=[]; let resolve;
  const context={React:{Component,createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:{businessDays:req=>{calls.push({...req});return new Promise(r=>{resolve=r;});}}}};
  vm.runInNewContext(moduleSource(path.resolve('src/admin/AccountAPrinter.js'),'Feature'),context);
  const screen=new context.Feature.AccountAPrinter({language:'en'}); screen.componentDidMount();
  function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return [node];return [node,...node.children.flatMap(nodes)];}
  const render=()=>nodes(screen.render());
  assert.match(render().filter(x=>typeof x==='string').join(' '),/See printed report/);
  let button=render().find(x=>x?.type==='button'&&x.children[0]==='Print daily fiscal control');
  const pending=button.props.onClick(); button.props.onClick();
  assert.equal(calls.length,1); assert.equal(calls[0].action,'accountAPrinterDailyControl'); assert.deepEqual(Object.keys(calls[0]),['action']);
  assert.equal(render().find(x=>x?.type==='button'&&x.children[0]==='Print daily fiscal control').props.disabled,true);
  resolve({ok:false}); await pending;
  assert.match(render().filter(x=>typeof x==='string').join(' '),/Could not confirm/);
  button=render().find(x=>x?.type==='button'&&x.children[0]==='Print daily fiscal control');
  const again=button.props.onClick(); resolve({ok:true}); await again;
  assert.equal(calls.length,2); assert.match(render().filter(x=>typeof x==='string').join(' '),/request sent/);
});
