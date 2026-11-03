const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
test('item move confirms occupied destination and locks choices until an uncertain response is resolved',async()=>{
 const calls=[]; let result={ok:false}; const api={moveItems:async(...args)=>{calls.push(args);return result;},getTables:async()=>({ok:true,data:[]}),getMenu:async()=>({ok:true,data:{categories:[],products:[]}})};
 class Component{setState(update){Object.assign(this.state,typeof update==='function'?update(this.state):update);}}
 const context={React:{Component,createElement(){}},ReactDOM:{createRoot(){return{render(){}}}},document:{getElementById(){}},window:{arra:api},crypto:{randomUUID:()=> 'token'},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Demo = WaiterDemo;',context);
 const app=new context.Demo(); app.componentDidMount(); Object.assign(app.state,{screen:'order',tableId:1,sections:[{label:'Inside',ids:[1,2,3]}],orders:{1:{id:10,openedAt:1,log:[]},3:{id:11,openedAt:2,log:[]}},items:[{id:8,tableId:1,status:'pending',qty:2,unit:100,cxQty:0,name:'Dish'}],modal:{type:'moveItems',sel:{},dest:null}});
 let v=app.renderVals(); v.miItems[0].toggle(); v.miTables.find(x=>x.num==='3').pick(); assert.match(app.renderVals().miLabel,/Move 2 items to Table 3/);
 await app.confirmMoveItems(); assert.equal(app.state.modal.unresolved,true); v=app.renderVals(); v.miItems[0].toggle(); v.miTables.find(x=>x.num==='2').pick(); v.closeModal(); app.goTables(); assert.equal(app.state.modal.dest,3); assert.equal(app.state.modal.sel[8],true); assert.equal(app.state.screen,'order');
 result={ok:true}; await app.confirmMoveItems(); assert.deepEqual(calls[0],calls[1]); assert.equal(calls[0][3],11); assert.equal(app.state.screen,'tables'); assert.equal(app.state.modal,null);
});
