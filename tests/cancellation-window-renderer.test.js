const {orderProps}=require('./support/renderer-view'), {arrange}=require('./support/renderer-fixture');
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
test('deadline keeps cancellation available and requests owner approval in both languages', async()=>{
 for(const language of ['en','sq']) {
  let now=1000000; class FakeDate extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} }
  class Component {setState(update){Object.assign(this.state,update)} forceUpdate(){}}
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useRef:()=>({current:null}),useEffect:fn=>fn()};
  const ctx={Date:FakeDate,React,ReactDOM:{createRoot:()=>({render(){}})},window:{},document:{getElementById(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo; this.Correction=SentItemCorrection; this.Pin=OwnerApprovalPin',ctx);
  const app=new ctx.App(); arrange(app,{language,screen:'order',waiter:{name:'Sample'},tableId:1,orders:{1:{openedAt:now,log:[]}},items:[{id:1,tableId:1,name:'Dish',qty:1,unit:10,status:'sent',cxQty:0,cx:[],route:'kitchen',round:1,sentAt:now}]});
  const walk=(n,a=[])=>{if(Array.isArray(n))n.forEach(x=>walk(x,a));else if(n&&typeof n==='object'){a.push(n);walk(n.children,a)}return a};
  const sentControl=()=>{const order=walk(ctx.renderOrder(orderProps(app),()=>({})));const component=order.find(n=>typeof n.type==='function'&&n.type.name==='SentCancel');return walk(component.type(component.props));};
  assert.equal(sentControl().find(n=>n.type==='button').props.disabled,false);
  now=1119999;
  assert.equal(app.correction.open(1),true);app.correction.chooseReason('Entered by mistake');app.correction.review();
  now=1120000; const nodes=sentControl();assert.equal(nodes.find(n=>n.type==='button').props.disabled,false);assert.equal(nodes.some(n=>n.type==='span'),false);
  // Effects that install DOM focus are not needed for this state-level check.
  React.useEffect=()=>{}; await app.correction.confirm();assert.equal(app.tableOrders.state.items[0].cxQty,0);assert.equal(app.correction.state.dialog.phase,'pin');assert.doesNotMatch(JSON.stringify(app.correction.render()), /Message unavailable|Mesazhi nuk eshte i disponueshem/);
  const pinView=walk(ctx.Pin({t:app.correction.view().t,dialog:app.correction.state.dialog,onChange(){},onKey(){},onVerify(){},onCancel(){}}));assert.ok(pinView.some(n=>n.type==='input'&&n.props.type==='password'&&n.props['aria-label']));assert.equal(pinView.filter(n=>n.type==='button').length,14);assert.equal(pinView.some(n=>n.type==='input'&&n.props.type==='text'),false);assert.equal(pinView.filter(n=>n.props.className==='owner-pin-dot').length,6);assert.equal(pinView.find(n=>n.props.className==='owner-pin-dots').props['aria-hidden'],true);
  app.correction.pinKey(String(require('node:crypto').randomInt(10)));app.correction.pinKey(String(require('node:crypto').randomInt(10)));const filled=walk(ctx.Pin({t:app.correction.view().t,dialog:app.correction.state.dialog,onChange(){},onKey(){},onVerify(){},onCancel(){}}));assert.equal(filled.filter(n=>n.props.className==='owner-pin-dot filled').length,2);app.correction.pinKey('Delete');app.correction.pinKey('Clear');assert.equal(app.correction.state.dialog.pin,'');
  app.correction.dismiss();assert.equal(app.correction.open(1),true);assert.equal(app.correction.state.dialog.phase,'pin');
 }
});
