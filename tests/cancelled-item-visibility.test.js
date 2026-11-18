const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{randomInt}=require('node:crypto');
const {moduleSource}=require('./support/renderer-bundle'),{arrange}=require('./support/renderer-fixture');

test('active order hides fully cancelled sent items while preserving partial, pending and history data',()=>{
 const ctx={};vm.runInNewContext(moduleSource('src/orders/order-view.js','View'),ctx);
 const items=[{id:1,tableId:1,status:'sent',name:'Fully cancelled',qty:2,cxQty:2,unit:100,cx:[{qty:2,reason:'Mistake',who:'Sample',t:1}],round:1,sentAt:1,sentBy:'Sample'},{id:2,tableId:1,status:'sent',name:'Partially cancelled',qty:3,cxQty:1,unit:50,cx:[{qty:1,reason:'Mistake',who:'Sample',t:2}],round:2,sentAt:2,sentBy:'Sample'},{id:3,tableId:1,status:'pending',name:'Pending',qty:1,cxQty:0,unit:20,cx:[]}];
 const data={screen:'order',tableId:1,tab:'order',orders:{1:{openedAt:1,log:[{t:2,who:'Sample',text:'Cancellation recorded'}]}},items};const before=JSON.stringify(data);
 for(const desktop of [false,true]) {const view=ctx.View.orderView(data,{language:'en',desktop,onCorrect(){},selectTab(){},showTables(){},showHistory(){}});assert.equal(view.rounds.length,1);assert.equal(view.rounds[0].items[0].name,'Partially cancelled');assert.equal(view.rounds[0].items[0].qtyLabel,'2×');assert.equal(view.rounds[0].items[0].hasCx,true);assert.equal(view.isEmpty,false);assert.equal(view.total,'120 den');assert.equal(view.activity[0].text,'Cancellation recorded');}
 assert.equal(JSON.stringify(data),before);
 const empty=ctx.View.orderView({...data,items:[items[0]]},{language:'en',desktop:true,onCorrect(){},selectTab(){},showTables(){},showHistory(){}});assert.equal(empty.isEmpty,true);assert.equal(empty.rounds.length,0);assert.equal(empty.total,'0 den');assert.equal(empty.activity[0].text,'Cancellation recorded');
});

test('a fully corrected item stays hidden after reopening the free desktop table',async()=>{
 let corrected=false;const row=()=>({id:1,productId:'p',name:'Sample dish',unitPrice:100,quantity:1,status:'sent',round:1,sentAt:Date.now(),sentBy:'Sample',route:'kitchen',correctedQuantity:corrected?1:0,corrections:corrected?[{quantity:1,reason:'Sample',actor:'Sample',occurredAt:Date.now()}]:[]});
 const api={getEntryTables:async()=>({ok:true,data:[{id:1,area:'Inside',occupied:!corrected}]}),identifyStaff:async()=>({ok:true,data:{id:1,name:'Sample',isTransfer:false}}),clearWaiter:async()=>({ok:true}),getMenu:async()=>({ok:true,data:{categories:[],products:[]}}),getTables:async()=>({ok:true,data:[{id:1,area:'Inside',orderId:5,openedAt:1,untouched:corrected}]}),openOrder:async()=>({ok:true,data:{id:5,openedAt:1,untouched:corrected}}),orderItems:async action=>{if(action==='correct')corrected=true;return {ok:true,data:{items:[row()]}}}};
 class Component {setState(u){Object.assign(this.state,typeof u==='function'?u(this.state):u)}}
 const ctx={React:{Component,createElement(){}},ReactDOM:{createRoot:()=>({render(){}})},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'sample-request'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo;',ctx);const app=new ctx.App();app.componentDidMount();arrange(app,{screen:'tables',waiter:{id:1,name:'Sample'},sections:[{label:'Inside',ids:[1]}],orders:{1:{id:5,openedAt:1,untouched:false,log:[]}}});
 await app.tableOrders.openTable(1);assert.equal(app.tableOrders.orderView({language:'en'}).rounds.length,1);app.correction.open(1);app.correction.chooseReason('Entered by mistake');await app.correction.confirm();assert.equal(app.tableOrders.orderView({language:'en'}).isEmpty,true);assert.equal(app.tableOrders.state.items[0].cxQty,1);
 await app.tableOrders.showTables();assert.equal(app.tableOrders.tableView({language:'en'}).sections[0].tables[0].free,true);app.session.requestTable(1);await app.session.setPin(String(randomInt(10000)).padStart(4,'0'));assert.equal(app.tableOrders.orderView({language:'en'}).isEmpty,true);assert.equal(app.tableOrders.orderView({language:'en'}).rounds.length,0);assert.equal(app.tableOrders.state.items[0].cx.length,1);
});
