const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const bundle=require('./support/admin-bundle');
test('uncertain correction retains its request and blocks navigation until confirmed',async()=>{
 class Component { constructor(props){this.props=props;} setState(p){Object.assign(this.state,typeof p==='function'?p(this.state):p);} }
 const calls=[];let first=true;const window={confirm:()=>true,arra:{adminSentCorrection:async req=>{if(req.action==='list')return {ok:true,data:{items:[{itemId:2,orderId:3,tableId:4,name:'Sample',remaining:2}]}};calls.push({...req});if(first){first=false;return {ok:false,uncertain:true};}return {ok:true};}}};
 const context={React:{Component,createElement:(type,props,...children)=>({type,props,children})},window,crypto:{randomUUID:()=> 'sample-request-id'},TextEncoder};vm.runInNewContext(bundle(),context);
 const page=new context.ArraComponents.AdminSentCorrections({language:'sq',onBack(){}});await page.load();Object.assign(page.state,{selected:2,quantity:1,reason:'sample reason'});
 await page.submit();assert.equal(page.leaveEditor(),false);assert.ok(page.state.pending);await page.submit();assert.equal(page.leaveEditor(),true);assert.deepEqual(calls[0],calls[1]);
});
