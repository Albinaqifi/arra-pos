const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const {moduleSource}=require('./support/renderer-bundle');
test('periodic tab defaults, selections and one request per submit',async()=>{
  class Component { constructor(props){this.props=props;} setState(value){Object.assign(this.state,value);} }
  const calls=[]; let resolve;
  const context={React:{Component,createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:{businessDays:req=>{calls.push({...req}); return new Promise(r=>{resolve=r;});}}}};
  vm.runInNewContext(moduleSource(path.resolve('src/admin/AccountAPrinter.js'),'Feature'),context);
  const screen=new context.Feature.AccountAPrinter({language:'en'}); screen.componentDidMount();
  function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return [node];return [node,...node.children.flatMap(nodes)];}
  const render=()=>nodes(screen.render());
  const text=()=>render().filter(x=>typeof x==='string').join(' ');
  render().find(x=>x?.type==='button'&&x.children[0]==='Periodic report').props.onClick();
  assert.match(text(),/Date range.*Short totals/);
  let form=render().find(x=>x?.type==='form');
  const dateInputs=render().filter(x=>x?.type==='input'&&x.props.type==='date');
  dateInputs[0].props.onChange({target:{value:'2014-11-29'}}); dateInputs[1].props.onChange({target:{value:'2014-11-30'}});
  render().find(x=>x?.type==='input'&&x.props.name==='fiscal-format'&&x.props.value==='detailed').props.onChange();
  assert.match(text(),/2014-11-29.*2014-11-30.*Detailed by closure/);
  const pending=form.props.onSubmit({preventDefault(){}}); form.props.onSubmit({preventDefault(){}});
  assert.equal(calls.length,1); assert.deepEqual(calls[0],{action:'accountAPrinterPeriodicReport',range:'date',format:'detailed',start:'2014-11-29',end:'2014-11-30'});
  resolve({ok:true}); await pending; await new Promise(setImmediate); assert.match(text(),/Periodic report request sent/);
  render().find(x=>x?.type==='input'&&x.props.name==='fiscal-range'&&x.props.value==='record').props.onChange();
  assert.match(text(),/First closure record.*Last closure record/);
  const records=render().filter(x=>x?.type==='input'&&x.props.inputMode==='numeric');
  records[0].props.onChange({target:{value:'1'}}); records[1].props.onChange({target:{value:'2'}});
  assert.match(text(),/Fiscal record numbers.*1.*2.*Detailed by closure/);
  form=render().find(x=>x?.type==='form'); form.props.onSubmit({preventDefault(){}});
  assert.deepEqual(calls[1],{action:'accountAPrinterPeriodicReport',range:'record',format:'detailed',start:'1',end:'2'}); resolve({ok:false}); await new Promise(setImmediate);
  assert.match(text(),/Could not confirm/);
  screen.props.language='sq'; assert.match(text(),/Raport periodik/); assert.match(text(),/Regjistri i parë/);
});
