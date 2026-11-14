const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('waiter view follows selected language without changing restaurant data', () => {
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const context = {React:{Component,createElement:()=>({})}, ReactDOM:{createRoot:()=>({render(){}})}, window:{}, document:{getElementById(){}}, setTimeout(){},clearTimeout(){}, setInterval(){},clearInterval(){}};
  vm.runInNewContext(require('./support/renderer-bundle')(), context);
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo',context);
  const app = new context.App();
  Object.assign(app.state,{screen:'order', tableId:1, orders:{1:{openedAt:Date.now(),log:[]}}, items:[{id:1,tableId:1,pid:'p',name:'Pite shtëpie',qty:2,unit:100,status:'pending',cxQty:0}],language:'en'});
  let v=app.renderVals(); assert.equal(v.pendingCount,'2 items'); assert.equal(v.pending[0].name,'Pite shtëpie'); assert.equal(v.sendLabel,'Send order · 2');
  app.state.language='sq'; v=app.renderVals(); assert.equal(v.pendingCount,'2 artikuj'); assert.equal(v.pending[0].name,'Pite shtëpie'); assert.equal(v.sendLabel,'Dërgo porosinë · 2'); assert.equal(v.pending[0].incAria,'Një më shumë Pite shtëpie');
  assert.equal(app.state.items[0].name,'Pite shtëpie');
});
test('tables and order screens render translated labels and note chips toggle in both languages', () => {
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const ctx={React,ReactDOM:{createRoot:()=>({render(){}})},window:{},document:{getElementById(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};
  vm.runInNewContext(require('./support/renderer-bundle')(),ctx);
  vm.runInNewContext(require('./support/renderer-bundle')(),ctx);
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo',ctx);
  const app=new ctx.App();
  Object.assign(app.state,{screen:'order',tableId:1,orders:{1:{openedAt:Date.now(),log:[]}},items:[{id:1,tableId:1,pid:'p',name:'Pite',qty:1,unit:100,status:'pending',cxQty:0,note:''}],modal:{type:'note',itemId:1,text:''}});
  const visit=(node,out=[])=>{if(Array.isArray(node))node.forEach(x=>visit(x,out));else if(node&&typeof node==='object'){out.push(node);visit(node.children,out)}return out};
  for(const [lang,tablesLabel,menuLabel,note] of [['en','Tables','Menu','No onions'],['sq','Tavolinat','Menuja','Pa qepë']]){
    app.state.language=lang; app.state.modal.text='';
    const v=app.renderVals(); v.isTables=true; v.sections=[{label:'Sample',tables:[{num:'1',free:true,open(){},aria:'table',style:''}]}];
    assert.ok(visit(ctx.renderTables.call(app,v,()=>({}))).some(x=>x.children.includes(tablesLabel)));
    assert.ok(visit(ctx.renderOrder.call(app,v,()=>({}))).some(x=>x.props['aria-label']===menuLabel));
    v.noteChips[0].toggle(); assert.equal(app.state.modal.text,note);
    app.renderVals().noteChips[0].toggle(); assert.equal(app.state.modal.text,'');
  }
  app.state.language='en'; app.state.modal.text=''; app.renderVals().noteChips[0].toggle();
  app.state.language='sq'; assert.equal(app.renderVals().noteChips[0].pressed,'true');
  app.renderVals().noteChips[0].toggle(); assert.equal(app.state.modal.text,'');
});
