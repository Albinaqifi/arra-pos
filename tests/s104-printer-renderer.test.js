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
  resolve({ok:true,outcome:'accepted'}); await new Promise(setImmediate); assert.match(render().filter(x=>typeof x==='string').join(' '),/Cash movement request sent/);
  render().find(x=>x?.type==='input'&&x.props.value==='out').props.onChange();
  amount('500,00'); submit(); assert.equal(calls.length,1); submit(); assert.deepEqual(calls[1],{action:'accountAPrinterCashMovement',direction:'out',amount:'500.00'});
  resolve({ok:false,outcome:'declined'}); await new Promise(setImmediate); assert.match(render().filter(x=>typeof x==='string').join(' '),/The printer declined this cash movement/);
});

test('cash outcomes are explained in English and Albanian, including an uncertain bridge failure',async()=>{
  class Component { constructor(props){this.props=props;} setState(value){Object.assign(this.state,value);} }
  const outcomes=[
    [{ok:true,outcome:'accepted'},'Cash movement request sent.','Kerkesa per levizjen e parave u dergua.'],
    [{ok:false,outcome:'declined'},'The printer declined this cash movement.','Printeri e refuzoi këtë lëvizje të parave.'],
    [{ok:false,outcome:'unknown'},'The printer may already have recorded this cash movement. Check before entering it again.','Printeri mund ta ketë regjistruar tashmë këtë lëvizje të parave. Kontrolloni para se ta regjistroni përsëri.'],
    [{ok:false,outcome:'not_sent'},'Cash movement request was not sent.','Kërkesa për lëvizjen e parave nuk u dërgua.'],
    [null,'The printer may already have recorded this cash movement. Check before entering it again.','Printeri mund ta ketë regjistruar tashmë këtë lëvizje të parave. Kontrolloni para se ta regjistroni përsëri.'],
    ['throw','The printer may already have recorded this cash movement. Check before entering it again.','Printeri mund ta ketë regjistruar tashmë këtë lëvizje të parave. Kontrolloni para se ta regjistroni përsëri.']
  ];
  for (const language of ['en','sq']) for (const [response,en,sq] of outcomes) {
    let calls=0;
    const context={React:{Component,createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:{businessDays:async()=>{calls++;if(response==='throw')throw Error('lost response');return response;}}}};
    vm.runInNewContext(moduleSource(path.resolve('src/admin/AccountAPrinter.js'),'Feature'),context);
    const screen=new context.Feature.AccountAPrinter({language}); screen.componentDidMount();
    screen.setState({view:'cash',amount:'1',review:true});
    await screen.confirmCash();
    const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...node.children.flatMap(flatten)]:[node];
    const role=response?.outcome==='accepted'?'status':'alert';
    const result=flatten(screen.render()).find(node=>node?.props?.role===role);
    assert.equal(result.children[0],language==='en'?en:sq);
    assert.equal(screen.state.review,false);
    assert.equal(screen.state.busy,false);
    assert.equal(calls,1);
  }
});
