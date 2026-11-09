const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
test('sales report controls select a period and clear stale data', async () => {
  let request, response={ok:true,data:{groups:[{account:'A',method:'cash',count:1,total:200}],records:[{id:1,billId:2,dayId:3,paidAt:100,account:'A',method:'cash',amount:200}],corrections:[{id:1,paymentId:1,amount:200,actorId:1,occurredAt:200,reason:'sample'}]}};
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const context={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:{financialVisibility:async r=>{request=r;return response;}}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Report=ArraComponents.SalesReports;', context);
  const screen=new context.Report({}); screen.setState({period:'day',dayId:'3',account:'A',method:'cash'}); await screen.load({preventDefault(){}});
  assert.equal(request.dayId,3); assert.equal(request.from,null); assert.equal(request.account,'A'); assert.equal(request.method,'cash');
  const text=JSON.stringify(screen.render()); for (const value of ['200','Payment #1','Correction #1','B to A','Provisional']) assert.ok(text.includes(value),value);
  response={ok:false}; await screen.load({preventDefault(){}}); assert.equal(screen.state.data,null); assert.ok(screen.state.error);
  screen.setState({period:'date',from:'2026-01-01',to:'2026-01-02'}); response={ok:true,data:{groups:[],records:[],corrections:[]}}; await screen.load({preventDefault(){}});
  assert.equal(request.from,new Date('2026-01-01T00:00:00').getTime()); assert.equal(request.to,new Date('2026-01-03T00:00:00').getTime());
  assert.ok(JSON.stringify(screen.render()).includes('No payments'));
});

test('closing a business day remounts the sales report so it reloads the new period', async () => {
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const context={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{confirm:()=>true,arra:{businessDays:async r=>r.action==='close'?{ok:true}:{ok:true,data:{days:[],issues:{orders:[],printJobs:[]}}}}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Financial=ArraComponents.FinancialVisibility; this.Days=ArraComponents.BusinessDays; this.Sales=ArraComponents.SalesReports;', context);
  const parent=new context.Financial({});
  const find=(node,type)=>!node || typeof node!=='object'?null:node.type===type?node:node.children.flatMap(x=>Array.isArray(x)?x:[x]).map(x=>find(x,type)).find(Boolean);
  assert.equal(find(parent.render(),context.Sales).props.key,0);
  const child=new context.Days(find(parent.render(),context.Days).props); await child.close(1);
  assert.equal(find(parent.render(),context.Sales).props.key,1);
  context.window.arra.businessDays=async()=>({ok:false}); await child.close(2);
  assert.equal(find(parent.render(),context.Sales).props.key,1);
});
