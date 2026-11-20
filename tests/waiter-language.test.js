const { viewOf, orderProps } = require('./support/renderer-view');
const { arrange, routeOf } = require('./support/renderer-fixture');
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
  arrange(app, {screen:'order', tableId:1, orders:{1:{openedAt:Date.now(),log:[]}}, items:[{id:1,tableId:1,pid:'p',name:'Pite shtëpie',qty:2,unit:100,status:'pending',cxQty:0}],language:'en'});
  let v=viewOf(app); assert.equal(v.pendingCount,'2 items'); assert.equal(v.pending[0].name,'Pite shtëpie'); assert.equal(v.sendLabel,'Send order · 2');
  app.settings.state.language='sq'; v=viewOf(app); assert.equal(v.pendingCount,'2 artikuj'); assert.equal(v.pending[0].name,'Pite shtëpie'); assert.equal(v.sendLabel,'Dergo porosine · 2'); assert.equal(v.pending[0].incAria,'Nje me shume Pite shtëpie');
  assert.equal(app.tableOrders.state.items[0].name,'Pite shtëpie');
});
test('tables, order and typed note controls render in both languages', () => {
  class Component { setState(update) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); } }
  const React={Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})};
  const ctx={React,ReactDOM:{createRoot:()=>({render(){}})},window:{},document:{getElementById(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){}};
  vm.runInNewContext(require('./support/renderer-bundle')(),ctx);
  vm.runInNewContext(require('./support/renderer-bundle')(),ctx);
  vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo',ctx);
  const app=new ctx.App();
  arrange(app, {screen:'order',tableId:1,orders:{1:{openedAt:Date.now(),log:[]}},items:[{id:1,tableId:1,pid:'p',name:'Pite',qty:1,unit:100,status:'pending',cxQty:0,note:''}],modal:{type:'note',itemId:1,text:''}});
  const visit=(node,out=[])=>{if(Array.isArray(node))node.forEach(x=>visit(x,out));else if(node&&typeof node==='object'){out.push(node);visit(node.children,out)}return out};
  for(const [lang,tablesLabel,menuLabel,noteLabel] of [['en','Tables','Menu','Note'],['sq','Tavolinat','Menuja','Shenim']]){
    app.settings.state.language=lang; app.pending.state.dialog.text='';
    const v=viewOf(app); v.isTables=true; v.sections=[{label:'Sample',tables:[{num:'1',free:true,open(){},aria:'table',style:''}]}];
    assert.ok(visit(ctx.renderTables.call(app,v,()=>({}))).some(x=>x.children.includes(tablesLabel)));
    assert.ok(visit(ctx.renderOrder(orderProps(app),()=>({}))).some(x=>x.props['aria-label']===menuLabel));
    const dialog = visit(app.pending.render());
    const input = dialog.find(x => x.type === 'input');
    assert.ok(input); assert.ok(dialog.some(x => x.type === 'label' && x.children.includes(noteLabel)));
    assert.equal(dialog.filter(x => x.type === 'button').length, 3);
    input.props.onChange({target:{value:'Custom note'}});
    assert.equal(app.pending.state.dialog.text,'Custom note');
  }
  app.settings.state.language='en'; app.pending.setNoteText('Custom note');
  app.settings.state.language='sq'; assert.equal(app.pending.view().noteText,'Custom note');
});
