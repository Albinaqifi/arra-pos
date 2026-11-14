const { arrange, routeOf } = require('./support/renderer-fixture');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('sent item correction requires review and tells preparation in both languages', async () => {
  for (const [language, title, reason, review, confirm, notice, saved] of [
    ['en','Cancel a sent item','Entered by mistake','Review correction','Confirm correction','Tell preparation staff in person; no cancellation notice is printed and earlier output may still arrive.','Correction saved. Tell preparation staff in person.'],
    ['sq','Anulo një artikull të dërguar','U shënua gabimisht','Kontrollo korrigjimin','Konfirmo korrigjimin','Njoftoni personalisht personelin e përgatitjes; nuk printohet njoftim anulimi dhe printimi i mëparshëm mund të mbërrijë ende.','Korrigjimi u ruajt. Njoftoni personelin e përgatitjes personalisht.']
  ]) {
    let confirming = false;
    class Component { setState(update, cb) { Object.assign(this.state, typeof update === 'function' ? update(this.state) : update); if (cb) cb(); } forceUpdate() {} }
    const React = {Component, Fragment:'fragment', createElement:(type,props,...children)=>({type,props:props||{},children}), useState:()=>[confirming, value=>{confirming=value;}], useRef:()=>({current:null}), useEffect:()=>{}};
    const ctx = {React,ReactDOM:{createRoot:()=>({render(){}})},window:{},document:{getElementById(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},renderTables(){},renderBill(){},renderMoveTable(){}};
    vm.runInNewContext(require('./support/renderer-bundle')(),ctx);
    vm.runInNewContext(require('./support/renderer-bundle')(),ctx);
    vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.App=WaiterDemo',ctx);
    vm.runInNewContext(require('./support/renderer-bundle')()+'\nthis.Correction=SentItemCorrection',ctx);
    const app = new ctx.App();
    arrange(app, {language,screen:'order',waiter:{name:'Sample'},tableId:1,orders:{1:{openedAt:Date.now(),log:[]}},items:[{id:1,tableId:1,name:'Dish',qty:2,unit:10,status:'sent',cxQty:0,cx:[],route:'kitchen',round:1,sentAt:Date.now()},{id:2,tableId:1,name:'Other dish',qty:1,unit:20,status:'sent',cxQty:0,cx:[],route:'kitchen',round:1,sentAt:Date.now()}]});
    const visit=(node,out=[])=>{if(Array.isArray(node))node.forEach(x=>visit(x,out));else if(node&&typeof node==='object'){out.push(node);visit(node.children,out)}return out};
    const order=visit(ctx.renderOrder.call(app,app.renderVals(),()=>({})));
    assert.equal(order.filter(x=>x.type==='button' && /^(Cancel|Anulo)$/.test(x.children[0])).length,2);
    assert.ok(!order.some(x=>x.type==='button' && /cancel (whole )?order|anulo porosinë/i.test(String(x.children[0]))));
    order.find(x=>x.type==='button' && /^(Cancel|Anulo)$/.test(x.children[0])).props.onClick();
    let v=app.renderVals(); assert.equal(v.modalTitle,title); assert.equal(v.cxInfo,notice); assert.equal(v.cxDisabled,true);
    let nodes=visit(ctx.Correction({v,modal:app.state.modal}));
    assert.equal(nodes.find(x=>x.props.className==='correction-primary').props.disabled,true);
    nodes.find(x=>x.type==='button' && x.children[0]===reason).props.onClick();
    v=app.renderVals(); nodes=visit(ctx.Correction({v,modal:app.state.modal}));
    const reviewButton=nodes.find(x=>x.props.className==='correction-primary'); assert.equal(reviewButton.children[0],review); reviewButton.props.onClick();
    assert.equal(app.tableOrders.state.items[0].cxQty,0);
    nodes=visit(ctx.Correction({v:app.renderVals(),modal:app.state.modal}));
    const confirmButton=nodes.find(x=>x.props.className==='correction-primary'); assert.equal(confirmButton.children[0],confirm); await confirmButton.props.onClick();
    assert.equal(app.tableOrders.state.items[0].cxQty,1); assert.equal(app.tableOrders.state.items[1].cxQty,0); assert.equal(app.state.toast.msg,saved);
  }
});
