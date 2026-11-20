const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const {moduleSource}=require('./support/renderer-bundle');

test('cash review and cancel send nothing; only confirmation sends the reviewed movement once',async()=>{
  class Component { constructor(props){this.props=props;} setState(value){Object.assign(this.state,value);} }
  const calls=[]; let resolve;
  const context={React:{Component,createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:{businessDays:req=>{calls.push({...req});return new Promise(r=>{resolve=r;});}}}};
  vm.runInNewContext(moduleSource(path.resolve('src/admin/AccountAPrinter.js'),'Feature'),context);
  const screen=new context.Feature.AccountAPrinter({language:'en'}); screen.componentDidMount();
  function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return [node];return [node,...node.children.flatMap(nodes)];}
  const render=()=>nodes(screen.render());
  const button=label=>render().find(x=>x?.type==='button'&&x.children[0]===label);
  const submit=()=>render().find(x=>x?.type==='form').props.onSubmit({preventDefault(){}});
  const amount=value=>render().find(x=>x?.type==='input'&&x.props.type==='text').props.onChange({target:{value}});
  button('Cash in / out').props.onClick();
  for(const invalid of ['', '0', '1.234', '-1', '1000000', 'abc']) { amount(invalid); submit(); assert.equal(screen.state.review,false); assert.equal(calls.length,0); }
  amount('2000'); submit(); assert.equal(screen.state.review,true); assert.match(render().filter(x=>typeof x==='string').join(' '),/2000\.00\s+MKD/); assert.equal(calls.length,0);
  button('Cancel').props.onClick(); assert.equal(screen.state.review,false); assert.equal(calls.length,0);
  submit(); submit(); submit(); assert.equal(calls.length,1); assert.deepEqual(calls[0],{action:'accountAPrinterCashMovement',direction:'in',amount:'2000.00'});
  resolve({ok:true}); await new Promise(setImmediate); assert.match(render().filter(x=>typeof x==='string').join(' '),/Cash movement request sent/);
  render().find(x=>x?.type==='input'&&x.props.value==='out').props.onChange();
  amount('500,00'); submit(); assert.equal(calls.length,1); submit(); assert.deepEqual(calls[1],{action:'accountAPrinterCashMovement',direction:'out',amount:'500.00'});
  resolve({ok:false}); await new Promise(setImmediate); assert.match(render().filter(x=>typeof x==='string').join(' '),/Could not confirm/);
});
