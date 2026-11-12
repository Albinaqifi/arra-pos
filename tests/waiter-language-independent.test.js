const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(api) {
  class Component { constructor(props) { this.props=props; } setState(u, cb) { Object.assign(this.state, typeof u === 'function' ? u(this.state) : u); if(cb) cb(); } forceUpdate() {} }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const ctx={React,ReactDOM:{createRoot:()=>({render(){}})},window:{arra:api},document:{getElementById(){}},crypto:{randomUUID:()=> 'sample-token'},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},renderTables(){},renderOrder(){},renderBill(){},renderMoveTable(){}};
  vm.runInNewContext(fs.readFileSync('dist/admin-shell.js','utf8'),ctx);
  vm.runInNewContext(fs.readFileSync('src/waiter/DesktopBill.js','utf8')+'\n'+fs.readFileSync('src/App.js','utf8')+'\nthis.App=WaiterDemo; this.Bill=DesktopBill;',ctx);
  const app=new ctx.App(); app._mounted=true; Object.assign(app.state,{screen:'order',waiter:{id:1,name:'Sample'},tableId:1,orders:{1:{id:5,log:[]}},items:[]});
  return {ctx,app};
}
const nodes=(n,out=[])=>{if(Array.isArray(n)) n.forEach(x=>nodes(x,out)); else if(n&&typeof n==='object'){out.push(n);nodes(n.children,out)}return out};
const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&n.children.includes(label));

test('switching language during send and uncertain payment does not repeat either operation', async()=>{
  let sends=0,payments=0,releaseSend;
  const api={language:async r=>({ok:true,language:r.language}),orderItems:()=>{sends++;return new Promise(resolve=>{releaseSend=resolve;});},payment:async()=>{payments++;return {ok:false,uncertain:true};}};
  const {app,ctx}=setup(api);
  const pending=app.send(); await app.changeLanguage('sq'); app.renderVals(); assert.equal(sends,1);
  releaseSend({ok:false}); await pending; assert.equal(sends,1);
  const bill=new ctx.Bill({language:'sq',onPaid(){},onClose(){}}); Object.assign(bill.state,{data:{id:7,total:100,lines:[]},method:'card',account:'A'});
  await bill.pay(); assert.equal(payments,1); assert.equal(bill.state.uncertain,true);
  await app.changeLanguage('en'); bill.props.language=app.state.language; bill.render(); assert.equal(payments,1);
  assert.equal(button(bill.render(),'Cash').props.disabled,true);
});

test('Albanian sign-in failure and bill review and uncertain payment show translated states', async()=>{
  const api={signIn:async()=>({ok:false}),payment:async()=>({ok:false,uncertain:true}),bill:async r=>({ok:true,data:r.action==='review'?{total:100,lines:[],fingerprint:'x'}:{id:7,total:100,lines:[]}})};
  const {app,ctx}=setup(api); Object.assign(app.state,{language:'sq',user:'sample',pass:'sample'}); await app.login(); assert.equal(app.state.toast.msg,'Hyrja dështoi.');
  const bill=new ctx.Bill({language:'sq',orderId:5,onPaid(){},onClose(){}}); await bill.review();
  assert.ok(button(bill.render(),'Krijo faturën')); await bill.generate(); assert.ok(button(bill.render(),'Kartë (Llogaria A)'));
  button(bill.render(),'Kartë (Llogaria A)').props.onClick(); await bill.pay();
  assert.ok(JSON.stringify(bill.render()).includes('Rezultati i pagesës në POS është i pasigurt.')); assert.equal(button(bill.render(),'Kartë (Llogaria A)').props.disabled,true);
});

test('Albanian failed-print banner offers a translated backup action',()=>{
  const {app}=setup(undefined);
  Object.assign(app.state,{language:'sq',screen:'tables',waiter:{name:'Sample'},jobs:[{id:1,status:'failed',printer:'kitchen',tableId:1,round:1,count:1,attempts:1}]});
  const rendered=JSON.stringify(app.render());
  assert.ok(rendered.includes('Printo në printerin rezervë')); assert.ok(!rendered.includes('Print on backup printer'));
});

