const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
function setup(api) {
 class Component {constructor(props){this.props=props} setState(update){Object.assign(this.state,update)}}
 const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
 const ctx={React,window:{arra:{orderHistory:api}}}; vm.runInNewContext(require('./support/admin-bundle')(),ctx);
 return new ctx.ArraComponents.OrderHistory({language:'en'});
}
function find(n,p) { if(!n || typeof n!=='object') return null; if(p(n)) return n; for(const c of n.children||[]) for(const x of Array.isArray(c)?c:[c]) {const v=find(x,p);if(v)return v;} return null; }
function click(screen,text) { const b=find(screen.render(),x=>x.type==='button' && JSON.stringify(x.children).includes(text)); assert.ok(b,text); b.props.onClick(); }
const stamp=(y,m,d,h=0)=>new Date(y,m-1,d,h).getTime();
test('opening-date selection, current-table grouping and navigation retain context',async()=>{
 const orders=[{id:1,tableId:2,status:'completed',openedAt:stamp(2025,4,1,23)},{id:2,tableId:2,status:'open',openedAt:stamp(2025,4,2,0)},{id:3,tableId:9,status:'completed',openedAt:stamp(2025,4,3)}];
 const screen=setup(async id=>id===null?{ok:true,data:{orders}}:{ok:true,data:{order:orders.find(o=>o.id===id),items:[],events:[]}});
 await screen.load(null); screen.setState({from:'2025-04-01',to:'2025-04-02'});screen.applyDates();let out=JSON.stringify(screen.render());assert.ok(out.includes('Table 2'));assert.ok(!out.includes('Table 9'));
 click(screen,'Table 2');out=JSON.stringify(screen.render());assert.ok(out.includes('Order #1'));assert.ok(out.includes('Order #2'));assert.ok(!out.includes('Order #3'));
 click(screen,'Order #1');await new Promise(setImmediate);click(screen,'Back to table 2');assert.equal(screen.state.tableId,2);assert.equal(screen.state.period.from,'2025-04-01');
 click(screen,'All orders');out=JSON.stringify(screen.render());assert.ok(out.includes('Order #1'));assert.ok(out.includes('Order #2'));assert.ok(!out.includes('Order #3'));
 screen.setState({from:'2025-04-03',to:''});screen.applyDates();out=JSON.stringify(screen.render());assert.ok(out.includes('Order #3'));assert.ok(!out.includes('Order #2'));
 screen.setState({from:'2025-02-30',to:''});screen.applyDates();assert.ok(screen.state.dateError);assert.equal(screen.state.period.from,'2025-04-03');screen.setState({from:'2025-04-03',to:'2025-04-02'});screen.applyDates();assert.ok(screen.state.dateError);
 screen.setState({from:'2025-05-01',to:''});screen.applyDates();assert.ok(JSON.stringify(screen.render()).includes('No orders match'));click(screen,'All dates');assert.equal(screen.state.period,null);
 screen.props.language='sq';out=JSON.stringify(screen.render());assert.ok(out.includes('Data e hapjes'));assert.ok(out.includes('Sipas tavolinës'));
});
test('late detail responses cannot replace returned results or unmounted identity',async()=>{
 let resolve;const screen=setup(id=>id===null?Promise.resolve({ok:true,data:{orders:[{id:1,tableId:1,openedAt:1,status:'open'}]}}):new Promise(r=>resolve=r));await screen.load(null);screen.setState({tableId:1});const pending=screen.load(1);click(screen,'Back to table 1');resolve({ok:true,data:{order:{id:1},items:[],events:[]}});await pending;assert.equal(screen.state.data,null);assert.equal(screen.state.tableId,1);
 const pending2=screen.load(1);screen.componentWillUnmount();resolve({ok:true,data:{order:{id:1},items:[],events:[]}});await pending2;assert.equal(screen.state.data,null);
});
