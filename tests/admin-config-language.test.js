const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const bundle = require('./support/admin-bundle');
class Component { constructor(props) { this.props = props; } setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); } }
const React = { Component, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return (node.children || []).flat(Infinity).map(text).join(' '); }
function setup(arra = {}) { const context = { React, window: { arra, confirm: () => true }, TextEncoder }; vm.runInNewContext(bundle(), context); return context.ArraComponents; }
test('configuration screens use selected language and preserve restaurant names', () => {
 const { TableConfig, MenuConfig, EmployeeConfig } = setup();
 const floor = new TableConfig({language:'sq'}); Object.assign(floor.state,{access:true,areas:[{id:1,name:'Patio',active:true}],tables:[{id:23,areaId:1,capacity:4,active:true}]});
 assert.match(text(floor.render()), /Zonat dhe tavolinat/); assert.match(text(floor.render()), /Patio/); assert.match(text(floor.render()), /Tavolina 23/);
 floor.props.language='en'; assert.match(text(floor.render()), /Areas and tables/);
 const menu = new MenuConfig({language:'sq'}); Object.assign(menu.state,{access:true,categories:[{id:1,name:'Specials',active:true,sortOrder:0}]}); assert.match(text(menu.render()), /Menaxhimi i menysë/); assert.match(text(menu.render()), /Specials/);
 const staff = new EmployeeConfig({language:'sq'}); Object.assign(staff.state,{access:true,actorScope:'combined',users:[{id:2,username:'Sample',scope:'waiter',active:true}],selected:2,permissions:['tables.view']}); const content=text(staff.render()); assert.match(content,/Punonjësit dhe lejet/); assert.match(content,/Sample/); assert.match(content,/Shiko zonat dhe tavolinat/);
});
test('denied access is translated and does not expose editors', async () => {
 const {TableConfig}=setup({tableConfig:async () => ({ok:false,error:'Access denied'})}); const floor=new TableConfig({language:'sq'}); await floor.load(); const output=text(floor.render()); assert.match(output,/Qasja u refuzua/); assert.match(output,/Kthehu te administrimi/); assert.doesNotMatch(output,/Shto tavolinë/);
});
test('language leaves configuration requests unchanged', async () => {
 const requests=[]; const {TableConfig}=setup({tableConfig:async r => {requests.push(r); return r.action==='list'?{ok:true,data:{areas:[],tables:[]}}:{ok:true};}}); const floor=new TableConfig({language:'sq'}); floor.editArea(null); floor.state.editor.name='Patio'; await floor.save(); assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {action:'area',id:null,name:'Patio',active:true});
});

test('financial report and correction details translate while retaining records', () => {
 const { SalesReports } = setup();
 const screen=new SalesReports({language:'sq',mode:'reports'}); Object.assign(screen.state,{dayId:'1',days:[{id:1,openedAt:0,closedAt:null}],data:{groups:[{account:'A',method:'cash',total:100,count:1}],records:[{id:3,tableId:4,waiter:'Sample',paidAt:0,method:'cash',account:'A',amount:100}],corrections:[{id:8,paymentId:3,actorId:2,amount:100,occurredAt:0,reason:'sample reason'}]}});
 const report=text(screen.render()); assert.match(report,/Qarkullimi total/); assert.match(report,/para në dorë/); assert.match(report,/Sample/); assert.match(report,/sample reason/); assert.match(report,/nuk shtojnë qarkullim/);
 screen.state.detailId=3; screen.state.detail={bill:{id:2,total:100,orderId:1,tableId:4,openedAt:0,actorId:2,generatedAt:0},payment:{id:3,amount:100,account:'A',method:'cash',paidAt:0,actorId:2},lines:[{name:'Coffee',quantity:1,unitPrice:100}],corrections:[]}; const all=[]; const walk=n=>{if(n && typeof n==='object'){all.push(n);(n.children||[]).flat(Infinity).forEach(walk);}}; walk(screen.render()); const component=all.find(n=>typeof n.type==='function' && n.type.name==='FinancialDetail'); const detail=component.type({language:'sq',data:{bill:{id:2,total:100,orderId:1,tableId:4,openedAt:0,actorId:2,generatedAt:0},payment:{id:3,amount:100,account:'A',method:'cash',paidAt:0,actorId:2},lines:[{name:'Coffee',quantity:1,unitPrice:100}],corrections:[]}}); const output=text(detail); assert.match(output,/Llogaria aktuale/); assert.match(output,/Coffee/); assert.match(output,/nuk është pagesë tjetër/);
});
test('Albanian report filters keep native options and submit selected account and method', async () => {
 const requests=[]; const {SalesReports}=setup({financialVisibility:async r=>{requests.push(r);return {ok:true,data:{groups:[],records:[]}};}});
 const screen=new SalesReports({language:'sq',mode:'reports'}); Object.assign(screen.state,{dayId:'1',days:[{id:1,openedAt:0,closedAt:null}]});
 const nodes=[]; const walk=n=>{if(n && typeof n==='object'){nodes.push(n);(n.children||[]).flat(Infinity).forEach(walk);}}; walk(screen.render());
 const selects=nodes.filter(n=>n.type==='select'); assert.equal(selects.length,4);
 for(const select of selects) assert.ok(select.children.flat(Infinity).every(n=>n.type==='option'));
 const account=selects[2],method=selects[3]; assert.match(text(method),/Para në dorë|para në dorë/);
 account.props.onChange({target:{value:'A'}}); method.props.onChange({target:{value:'cash'}});
 await screen.load({preventDefault(){}}); assert.deepEqual(JSON.parse(JSON.stringify(requests[0])),{action:'report',from:null,to:null,dayId:1,account:'A',method:'cash'});
});
test('known configuration service errors are translated', async () => {
 const {TableConfig,MenuConfig,EmployeeConfig}=setup({tableConfig:async()=>({ok:false,error:'Table has an open order'}),menuConfig:async()=>({ok:false,error:'Invalid parent category'}),employeeConfig:async()=>({ok:false,error:'Access denied. Sign in as the administrator and select the same name.'})});
 const floor=new TableConfig({language:'sq'}); floor.editTable({id:1,areaId:1,capacity:4,active:true}); await floor.save(); assert.equal(floor.state.error,'Tavolina ka një porosi të hapur');
 const menu=new MenuConfig({language:'sq'}); menu.edit('category',null); menu.state.editor.name='Sample'; await menu.save(); assert.equal(menu.state.error,'Kategori prind e pavlefshme');
 const employee=new EmployeeConfig({language:'sq'}); await employee.load(); assert.match(text(employee.render()),/Hyni si administrator/);
});
