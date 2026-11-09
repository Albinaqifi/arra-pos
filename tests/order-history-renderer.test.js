const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
test('order history navigation loads list, details and returns to tables', async () => {
 const api={getMenu:async()=>({ok:true,data:{categories:[],products:[]}}),getTables:async()=>({ok:true,data:[]}),orderHistory:async id=>id===null?{ok:true,data:{orders:[{id:1,tableId:1,status:'open',openedAt:1}]}}:{ok:true,data:{order:{id:1,tableId:1,status:'open',openedAt:1},items:[],events:[]}}};
 class Component {constructor(props){this.props=props} setState(update){Object.assign(this.state,update)}}
 const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
 const ctx={React,ReactDOM:{createRoot(){return {render(){}}}},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/admin-bundle')(), ctx);
  vm.runInNewContext(require('./support/waiter-views')() + fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo=WaiterDemo; this.History=ArraComponents.OrderHistory;', ctx);
 const find=(n,p)=>{if(!n||typeof n!=='object')return null;if(p(n))return n;for(const c of n.children||[])for(const x of Array.isArray(c)?c:[c]){const v=find(x,p);if(v)return v}return null};
 const app=new ctx.Demo();app.componentDidMount();app.setState({screen:'tables',adminAccess:true});const b=find(app.render(),x=>x.type==='button'&&x.children.includes('Administration →'));assert.ok(b);b.props.onClick();let shell=app.render();const overview=shell.type(shell.props);find(overview,x=>x.type==='button'&&JSON.stringify(x.children).includes('Order history')).props.onClick();shell=app.render();const element=shell.children[0];assert.equal(element.type,ctx.History);
 const history=new element.type(element.props);history.componentDidMount();await new Promise(setImmediate);find(history.render(),x=>x.type==='button'&&x.children.some(v=>typeof v==='string'&&v.startsWith('Order #1'))).props.onClick();await new Promise(setImmediate);assert.ok(find(history.render(),x=>x.type==='h2'&&x.children.some(v=>typeof v==='string'&&v.startsWith('Order #1'))));element.props.onBack();assert.equal(app.state.screen,'admin');app.render().props.back();assert.equal(app.state.screen,'tables');
});
