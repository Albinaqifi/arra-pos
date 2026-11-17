const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const bundle=require('./support/admin-bundle');
test('uncertain correction retains its request and blocks navigation until confirmed',async()=>{
 class Component { constructor(props){this.props=props;} setState(p){Object.assign(this.state,typeof p==='function'?p(this.state):p);} }
 const calls=[];let first=true;const window={confirm:()=>true,arra:{adminSentCorrection:async req=>{if(req.action==='list')return {ok:true,data:{items:[{itemId:2,orderId:3,tableId:4,name:'Sample',remaining:2}]}};calls.push({...req});if(first){first=false;return {ok:false,uncertain:true};}return {ok:true};}}};
 const context={React:{Component,createElement:(type,props,...children)=>({type,props,children})},window,crypto:{randomUUID:()=> 'sample-request-id'},TextEncoder};vm.runInNewContext(bundle(),context);
 const page=new context.ArraComponents.AdminSentCorrections({language:'sq',onBack(){}});await page.load();Object.assign(page.state,{selected:2,quantity:1,reason:'sample reason'});
 await page.submit();assert.equal(page.leaveEditor(),false);assert.ok(page.state.pending);await page.submit();assert.equal(page.leaveEditor(),true);assert.deepEqual(calls[0],calls[1]);
});
test('validates drafts, confirms details, and keeps the original request after an uncertain result and rejection',async()=>{
 class Component { constructor(props){this.props=props;} setState(p){Object.assign(this.state,typeof p==='function'?p(this.state):p);} }
 const calls=[], confirmations=[]; let attempt=0;
 const window={confirm:message=>{confirmations.push(message);return true;},arra:{adminSentCorrection:async req=>{if(req.action==='list')return {ok:true,data:{items:[{itemId:2,orderId:3,tableId:4,name:'Soup',remaining:3},{itemId:5,orderId:3,tableId:4,name:'Soup',remaining:1},{itemId:6,orderId:7,tableId:8,name:'Tea',remaining:2}]}}; calls.push({...req}); attempt++; return attempt===1?{ok:false,uncertain:true}:attempt===2?{ok:false}:{ok:true,testPrintEnabled:true};}}};
 const context={React:{Component,createElement:(type,props,...children)=>({type,props,children})},window,crypto:{randomUUID:()=> 'stable-id'},TextEncoder};vm.runInNewContext(bundle(),context);
 const page=new context.ArraComponents.AdminSentCorrections({language:'en',onBack(){}});await page.load();Object.assign(page.state,{selected:2,quantity:4,reason:'mistake'});await page.submit();assert.equal(calls.length,0);assert.match(page.state.error,/quantity/);
 Object.assign(page.state,{quantity:2,reason:'  '});await page.submit();assert.equal(calls.length,0);assert.match(page.state.error,/reason/);
 Object.assign(page.state,{reason:' mistake '});await page.submit();assert.match(confirmations[0],/Table 4.*Soup.*Quantity 2/);assert.equal(page.leaveEditor(),false);
 await page.submit();assert.equal(page.leaveEditor(),false);assert.equal(page.state.uncertain,true);await page.submit();assert.equal(page.leaveEditor(),true);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],calls[2]);assert.equal(calls[0].reason,'mistake');assert.match(page.state.notice,/in person/);
});

test('groups repeated names by table and shows the selected quantity effect',async()=>{
 class Component { constructor(props){this.props=props;} setState(p){Object.assign(this.state,typeof p==='function'?p(this.state):p);} }
 const window={arra:{adminSentCorrection:async()=>({ok:true,data:{items:[{itemId:2,orderId:3,tableId:4,name:'Soup',remaining:3},{itemId:5,orderId:3,tableId:4,name:'Soup',remaining:1},{itemId:6,orderId:7,tableId:8,name:'Tea',remaining:2}]}})}};
 const context={React:{Component,createElement:(type,props,...children)=>({type,props:props||{},children})},window,crypto:{randomUUID:()=> 'id'},TextEncoder};vm.runInNewContext(bundle(),context);
 const page=new context.ArraComponents.AdminSentCorrections({language:'en',onBack(){}});await page.load();Object.assign(page.state,{selected:2,quantity:2});
 const nodes=[];const walk=x=>{if(Array.isArray(x))x.forEach(walk);else if(x&&typeof x==='object'){nodes.push(x);walk(x.children);}};walk(page.render());
 assert.equal(nodes.filter(n=>n.props.className==='correction-table').length,2);assert.equal(nodes.filter(n=>n.props['aria-pressed']===true).length,1);
 const text=JSON.stringify(page.render());assert.match(text,/Item #2/);assert.match(text,/Item #5/);assert.match(text,/Remaining after correction: 1/);
});
