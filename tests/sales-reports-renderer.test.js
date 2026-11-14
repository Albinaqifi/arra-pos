const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
test('sales report controls select a period and clear stale data', async () => {
  let request, response={ok:true,data:{groups:[{account:'A',method:'cash',count:1,total:200}],records:[{id:1,billId:2,dayId:3,paidAt:100,account:'A',method:'cash',amount:200}],corrections:[{id:1,paymentId:1,amount:200,actorId:1,occurredAt:200,reason:'sample'}]}};
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const context={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:{financialVisibility:async r=>{request=r;return response;}}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Report=ArraComponents.SalesReports;', context);
  const screen=new context.Report({}); screen.setState({period:'day',dayId:'3',account:'A',method:'cash'}); await screen.load({preventDefault(){}});
  assert.equal(request.dayId,3); assert.equal(request.from,null); assert.equal(request.account,'A'); assert.equal(request.method,'cash');
  const text=JSON.stringify(screen.render()); for (const value of ['200','Account corrections','B → A','Provisional']) assert.ok(text.includes(value),value);
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
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Financial=ArraComponents.FinancialVisibility; this.Days=ArraComponents.BusinessDays; this.Sales=ArraComponents.SalesReports;', context);
  const parent=new context.Financial({});
  const find=(node,type)=>!node || typeof node!=='object'?null:node.type===type?node:node.children.flatMap(x=>Array.isArray(x)?x:[x]).map(x=>find(x,type)).find(Boolean);
  parent.setState({view:'today'}); assert.equal(find(parent.render(),context.Sales).props.key,'today-0'); parent.setState({view:'close'});
  const child=new context.Days(find(parent.render(),context.Days).props); child.setState({confirmId:1}); await child.close(1);
  parent.setState({view:'today'}); assert.equal(find(parent.render(),context.Sales).props.key,'today-1');
  context.window.arra.businessDays=async()=>({ok:false}); child.setState({confirmId:2}); await child.close(2);
  assert.equal(find(parent.render(),context.Sales).props.key,'today-1');
});

test('open day loads automatically and close review fails closed when turnover is unavailable', async () => {
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  let fail=false; const calls=[];
  const context={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:{financialVisibility:async r=>{calls.push(r); return r.action==='reportDays'?{ok:true,data:[{id:4,openedAt:1,closedAt:null}]}:fail?{ok:false}:{ok:true,data:{groups:[{account:'A',method:'cash',count:1,total:100}],records:[],corrections:[]}};},businessDays:async()=>({ok:true,data:{days:[{id:4,openedAt:1,closedAt:null}],issues:{orders:[{id:1,tableId:2}],printJobs:[]}}})}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Report=ArraComponents.SalesReports; this.Days=ArraComponents.BusinessDays;',context);
  const report=new context.Report({}); await report.componentDidMount(); assert.equal(calls[1].dayId,4); assert.equal(report.state.data.groups[0].total,100);
  const days=new context.Days({}); await days.load(); await days.review(4); assert.equal(days.state.confirmId,4); assert.ok(JSON.stringify(days.render()).includes('100')); assert.equal(days.state.data.issues.orders[0].tableId,2);
  fail=true; await days.review(4); assert.equal(days.state.confirmId,null); assert.ok(days.state.error);
});

test('refresh after lost close response reloads the new day in the report', async () => {
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  let closed=false; const requests=[];
  const days=()=>closed?[{id:2,openedAt:10,closedAt:null},{id:1,openedAt:1,closedAt:10,closedBy:1,issues:{orders:[],printJobs:[]}}]:[{id:1,openedAt:1,closedAt:null}];
  const context={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:{businessDays:async r=>{if(r.action==='close'){closed=true;throw Error('lost response');} return {ok:true,data:{days:days(),issues:{orders:[],printJobs:[]}}};},financialVisibility:async r=>{requests.push(r);return r.action==='reportDays'?{ok:true,data:days()}:{ok:true,data:{groups:[],records:[],corrections:[]}};}}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Financial=ArraComponents.FinancialVisibility;this.Days=ArraComponents.BusinessDays;this.Sales=ArraComponents.SalesReports;',context);
  const parent=new context.Financial({});parent.setState({view:'close'});const find=(node,type)=>!node||typeof node!=='object'?null:node.type===type?node:node.children.flatMap(x=>Array.isArray(x)?x:[x]).map(x=>find(x,type)).find(Boolean);
  const child=new context.Days(find(parent.render(),context.Days).props);await child.load();child.setState({confirmId:1});await child.close(1);assert.ok(child.state.error);assert.equal(parent.state.dayRevision,0);
  await child.refresh();assert.equal(parent.state.dayRevision,1);assert.equal(child.state.data.days[0].id,2);
  parent.setState({view:'today'});const report=new context.Sales(find(parent.render(),context.Sales).props);await report.componentDidMount();assert.equal(requests.at(-1).dayId,2);
});

test('payment details expand at the selected report row and can be closed', async () => {
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const data={bill:{id:2},payment:{id:1},lines:[],corrections:null};let request;
  const context={React,ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:{financialVisibility:async r=>{request=r;return {ok:true,data};}}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Report=ArraComponents.SalesReports;this.Detail=ArraComponents.FinancialDetail;',context);
  const report=new context.Report({});report.setState({data:{groups:[],records:[{id:1,billId:2,paidAt:1,account:'A',method:'cash',amount:10}],corrections:null}});
  const all=(n)=>!n||typeof n!=='object'?[]:[n,...n.children.flatMap(x=>Array.isArray(x)?x:[x]).flatMap(all)];
  const button=all(report.render()).find(n=>n.type==='button'&&n.props.className==='finance-more');await button.props.onClick();assert.equal(request.action,'detail');assert.equal(request.paymentId,1);
  const expanded=all(report.render());assert.equal(expanded.find(n=>n.type==='button'&&n.props.className==='finance-more').props['aria-expanded'],true);assert.equal(expanded.find(n=>typeof n.type==='function' && n.type.name==='FinancialDetail').props.data,data);
  expanded.find(n=>n.type==='button'&&n.children[0]==='Close payment detail').props.onClick();assert.equal(report.state.detailId,null);
});


test('financial landing offers focused views and payment rows keep identifiers in details', async () => {
  class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const context={React,window:{arra:{financialVisibility:async()=>({ok:true,data:{}})}}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);
  const screen=new context.ArraComponents.FinancialVisibility({onBack(){}});
  const all=n=>!n||typeof n!=='object'?[]:[n,...(n.children||[]).flat().flatMap(all)];
  const cards=all(screen.render()).filter(n=>n.type==='button'&&n.props.className==='finance-choice');
  assert.equal(cards.length,4); assert.ok(!all(screen.render()).some(n=>n.type===context.ArraComponents.SalesReports));
  cards[0].props.onClick(); assert.equal(screen.state.view,'today'); assert.ok(all(screen.render()).some(n=>n.type===context.ArraComponents.SalesReports));
  const report=new context.ArraComponents.SalesReports({mode:'today'}); report.setState({dayId:'3',days:[{id:3,openedAt:100,closedAt:null}],data:{groups:[{account:'A',method:'cash',count:1,total:500}],records:[{id:9,billId:42,dayId:3,paidAt:100,tableId:7,waiter:'Alex',account:'A',method:'cash',amount:500}],corrections:[]}});
  const view=JSON.stringify(report.render()); for(const x of ['Table 7','Alex','500']) assert.ok(view.includes(x)); for(const x of ['Bill #42','Day #3','Payment #9']) assert.ok(!view.includes(x));
  assert.ok(all(report.render()).some(n=>n.type==='button'&&n.props.className==='finance-more'&&n.props['aria-label'].includes('table 7')));
});

test('payments spanning dates are grouped and correction history identifies the payment and actor',()=>{
 class Component { constructor(props){this.props=props;} setState(x){Object.assign(this.state,x);} }
 const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})}; const ctx={React,window:{arra:{}}};vm.runInNewContext(require('./support/admin-bundle')(),ctx);
 const report=new ctx.ArraComponents.SalesReports({mode:'today'}); const first=new Date(2026,0,1,12).getTime(),second=new Date(2026,0,2,12).getTime();
 report.setState({data:{groups:[],records:[{id:1,paidAt:first,tableId:3,waiter:'A',method:'cash',account:'A',amount:5},{id:2,paidAt:second,tableId:3,waiter:'A',method:'cash',account:'A',amount:5}],corrections:[{id:1,paymentId:2,actorId:9,amount:5,occurredAt:second,reason:'fix'}]}});
 const all=n=>!n||typeof n!=='object'?[]:[n,...(n.children||[]).flat().flatMap(all)], nodes=all(report.render());
 assert.equal(nodes.filter(n=>n.props.className==='finance-date-divider').length,2); const labels=nodes.filter(n=>n.props.className==='finance-more').map(n=>n.props['aria-label']);assert.notEqual(labels[0],labels[1]);
 const text=JSON.stringify(report.render()); assert.ok(text.includes('Payment #2')); assert.ok(text.includes('Actor #9'));
});
