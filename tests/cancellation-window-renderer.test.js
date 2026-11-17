const {orderProps}=require('./support/renderer-view'), {arrange}=require('./support/renderer-fixture');
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
test('deadline disables sent cancellation and an open confirmation in both languages', async()=>{
 for(const language of ['en','sq']) {
  let now=1000000, refreshes=0, nextTimer=0; const timers=new Map(); class FakeDate extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  class Component {setState(update){Object.assign(this.state,update)} forceUpdate(){}}
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useState:()=>[0,()=>{refreshes++}],useRef:()=>({current:null}),useEffect:fn=>fn()};
  const ctx={Date:FakeDate,React,ReactDOM:{createRoot:()=>({render(){}})},window:{},document:{getElementById(){}},setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id),setInterval(){},clearInterval(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo; this.Correction=SentItemCorrection',ctx);
  const app=new ctx.App(); arrange(app,{language,screen:'order',waiter:{name:'Sample'},tableId:1,orders:{1:{openedAt:now,log:[]}},items:[{id:1,tableId:1,name:'Dish',qty:1,unit:10,status:'sent',cxQty:0,cx:[],route:'kitchen',round:1,sentAt:now}]});
  const walk=(n,a=[])=>{if(Array.isArray(n))n.forEach(x=>walk(x,a));else if(n&&typeof n==='object'){a.push(n);walk(n.children,a)}return a};
  const sentControl=()=>{const order=walk(ctx.renderOrder(orderProps(app),()=>({})));const component=order.find(n=>typeof n.type==='function'&&n.type.name==='SentCancel');return walk(component.type(component.props));};
  const fireTimer=expectedDelay=>{assert.equal(timers.size,1);const [id,timer]=timers.entries().next().value;assert.equal(timer.delay,expectedDelay);timers.delete(id);timer.fn();};
  assert.equal(sentControl().find(n=>n.type==='button').props.disabled,false);
  now=1001000; fireTimer(1000);
  now=1000500; fireTimer(1000); // Clock moved back, but remains after the send time.
  now=1119999; fireTimer(1000);
  assert.equal(app.correction.open(1),true);app.correction.chooseReason('Entered by mistake');app.correction.review();
  now=1120000; fireTimer(1); assert.equal(refreshes,4); assert.equal(timers.size,0); const nodes=sentControl();assert.equal(nodes.find(n=>n.type==='button').props.disabled,true);assert.ok(nodes.some(n=>n.type==='span' && /administrator|administrator/i.test(n.children[0])));
  // Effects that install DOM focus are not needed for this state-level check.
  React.useEffect=()=>{}; const dialog=walk(ctx.Correction({v:app.correction.view(),modal:app.correction.state.dialog}));assert.equal(dialog.find(n=>n.props.className==='correction-primary').props.disabled,true);
  await app.correction.confirm();assert.equal(app.tableOrders.state.items[0].cxQty,0);assert.ok(app.correction.state.dialog.error);
 }
});
