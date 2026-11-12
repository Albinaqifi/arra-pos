const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
const make=(api)=>{class Component{constructor(props){this.props=props}setState(x){Object.assign(this.state,x)}} const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};const ctx={React,window:{arra:api}};vm.runInNewContext(require('./support/admin-bundle')(),ctx);return ctx.ArraComponents};
const expand=n=>{if(!n||typeof n!=='object')return n;if(typeof n.type==='function' && !n.type.prototype?.render)return expand(n.type(n.props));return {...n,children:(n.children||[]).flat().map(expand)}};
test('payment detail explains corrected account without counting another payment',async()=>{const c=make({financialVisibility:async()=>({ok:true,data:{bill:{id:1,orderId:2,tableId:3,openedAt:1,generatedAt:2,actorId:4,total:100},payment:{id:5,amount:100,method:'cash',originalAccount:'B',account:'A',actorId:4,paidAt:3},lines:[],corrections:[{id:6,fromAccount:'B',toAccount:'A',actorId:4,occurredAt:4,reason:'sample'}]}})});const screen=new c.FinancialVisibility({});screen.setState({view:'history'});await screen.detail(5);const text=JSON.stringify(expand(screen.render()));for(const x of ['Original account','Effective account','not another payment','B → A','sample'])assert.ok(text.includes(x),x)});
test('business day requires confirmation and describes cutoff; failure invites status refresh',async()=>{let calls=[];const c=make({businessDays:async r=>{calls.push(r.action);return r.action==='list'?{ok:true,data:{issues:{orders:[{id:1,tableId:2}],printJobs:[]},days:[{id:3,openedAt:1,closedAt:null}]}}:{ok:false}}});const d=new c.BusinessDays({});await d.load();await d.close(3);assert.deepEqual(calls,['list']);d.setState({confirmId:3});let text=JSON.stringify(expand(d.render()));assert.match(text,/Transfer-manager corrections/);assert.match(text,/Open orders \(1\)/);await d.close(3);assert.deepEqual(calls,['list','close']);assert.match(d.state.error,/Refresh and check/)});
test('late financial responses cannot replace a newer selection',async()=>{let resolves=[];const c=make({financialVisibility:()=>new Promise(r=>resolves.push(r))});const s=new c.FinancialVisibility({});const first=s.detail(1),second=s.detail(2);resolves[1]({ok:true,data:{id:2}});await second;resolves[0]({ok:true,data:{id:1}});await first;assert.equal(s.state.detail.id,2)});
test('day close puts current turnover first and keeps history and settings collapsed',async()=>{
 const data={queue:'Sample',issues:{orders:[{id:1,tableId:2}],printJobs:[]},days:[{id:3,openedAt:3,closedAt:null},{id:2,openedAt:2,closedAt:3,closedBy:1,issues:{orders:[],printJobs:[]},reportId:2,printResult:'accepted',printAttempts:1},{id:1,openedAt:1,closedAt:2,closedBy:1,issues:{orders:[],printJobs:[]},reportId:1,printResult:'uncertain',printAttempts:1}]};
 let report={ok:true,data:{groups:[{account:'A',method:'cash',count:1,total:150}]}};
 const c=make({businessDays:async()=>({ok:true,data}),financialVisibility:async()=>report}); const d=new c.BusinessDays({}); await d.load();
 const tree=expand(d.render()), text=JSON.stringify(tree); assert.match(text,/Current turnover/); assert.match(text,/150/); assert.match(text,/Print result is uncertain/); assert.match(text,/check the paper before retrying/); assert.match(text,/Day #1 · report needs attention/);
 const all=(n,type)=>!n||typeof n!=='object'?[]:[...(n.type===type?[n]:[]),...(n.children||[]).flat().flatMap(x=>all(x,type))];
 const sections=all(tree,'details'); assert.ok(sections.length>=2); assert.ok(sections.every(x=>!x.props.open));
 report={ok:false}; await d.load(); assert.match(JSON.stringify(expand(d.render())),/Unavailable/);
});
test('owner close confirmation explains the shared cutoff and uses only supplied scoped turnover',async()=>{
 const day={id:1,openedAt:1,closedAt:null},issues={orders:[],printJobs:[]};let calls=[];
 const c=make({businessDays:async r=>{calls.push(r);return {ok:true,data:{scope:'A',days:[day],issues,queue:'sample'}}},financialVisibility:async()=>({ok:true,data:{groups:[{account:'A',method:'cash',count:1,total:123}]}})});
 const d=new c.BusinessDays({});await d.load();await d.review(1);const text=JSON.stringify(expand(d.render()));assert.match(text,/closes the shared day for both owners/);assert.match(text,/Transfer-manager corrections/);assert.match(text,/new day opens/);assert.match(text,/A · cash/);assert.doesNotMatch(text,/Report printer settings/);assert.equal(calls.filter(x=>x.action==='close').length,0);
});
test('combined sees older owner report failures outside collapsed history',async()=>{
 const issues={orders:[],printJobs:[]}, data={scope:'combined',queue:'sample',issues,days:[{id:3,openedAt:3,closedAt:null},{id:2,openedAt:2,closedAt:3,closedBy:1,issues,reportId:2,printAttempts:1,printResult:'accepted',otherPrints:[]},{id:1,openedAt:1,closedAt:2,closedBy:2,issues,reportId:1,printAttempts:0,printResult:null,otherPrints:[{scope:'A',printAttempts:1,printResult:'uncertain'}]}]};
 const c=make({businessDays:async()=>({ok:true,data}),financialVisibility:async()=>({ok:true,data:{groups:[]}})}),d=new c.BusinessDays({});await d.load();const text=JSON.stringify(expand(d.render()));assert.match(text,/Day #1 · report needs attention/);assert.match(text,/Account A report/);assert.match(text,/Retry account A report after checking printer/);assert.match(text,/Print result is uncertain/);
});
test('empty owner close preview describes permitted scope without asserting the whole day is empty',async()=>{
 const data={scope:'A',queue:'sample',issues:{orders:[],printJobs:[]},days:[{id:1,openedAt:1,closedAt:null}]};
 const c=make({businessDays:async()=>({ok:true,data}),financialVisibility:async()=>({ok:true,data:{groups:[]}})}),d=new c.BusinessDays({});await d.load();await d.review(1);const text=JSON.stringify(expand(d.render()));assert.match(text,/No payments in this day for your permitted scope/);assert.doesNotMatch(text,/No payments in this day\./);
});
test('failed and uncertain report outcomes are visibly distinct and preserve retry guidance',async()=>{
 const issues={orders:[],printJobs:[]}, data={scope:'combined',queue:'sample',issues,days:[{id:2,openedAt:2,closedAt:null},{id:1,openedAt:1,closedAt:2,closedBy:1,issues,reportId:1,printAttempts:1,printResult:'failed',otherPrints:[{scope:'A',printAttempts:1,printResult:'uncertain'}]}]};
 const c=make({businessDays:async()=>({ok:true,data}),financialVisibility:async()=>({ok:true,data:{groups:[]}})}),d=new c.BusinessDays({});await d.load();const tree=expand(d.render());
 const all=n=>!n||typeof n!=='object'?[]:[n,...(n.children||[]).flat().flatMap(all)];const nodes=all(tree);
 assert.ok(nodes.some(n=>n.props?.className==='day-print-error' && n.props.role==='alert' && JSON.stringify(n).includes('Printing failed')));
 assert.ok(nodes.some(n=>n.props?.className==='day-print-warning' && n.props.role==='status' && JSON.stringify(n).includes('check the paper before retrying')));
 assert.ok(nodes.some(n=>n.props?.className==='day-print-icon' && n.props['aria-hidden']==='true'));
});
