const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('cancellation history renders actor, explanation and affected items in both languages', async () => {
  class Component { constructor(props) { this.props = props; } setState(update) { Object.assign(this.state, update); } }
  const React = { Component, Fragment:'fragment', createElement:(type, props, ...children) => ({type, props:props || {}, children}) };
  const ctx = { React, window:{ arra:{ orderHistory:async () => ({ok:true, data:{
    order:{id:2,tableId:3,status:'cancelled',openedAt:1},
    items:[{id:4,name:'Sample dish',status:'sent',quantity:2}],
    events:[{id:1,action:'cancel_order',reason:'Sample explanation',items:[{id:4,name:'Sample dish',status:'sent',quantity:2}],actor:'Sample waiter',orderId:2,occurredAt:2}]
  }}) } } };
  vm.runInNewContext(require('./support/admin-bundle')(),ctx);
  const history = new ctx.ArraComponents.OrderHistory({language:'en'});
  await history.load(2);
  let out = JSON.stringify(history.render());
  for (const text of ['Cancelled order. Reason: Sample explanation','2 × Sample dish','Sample waiter','0 remaining']) assert.ok(out.includes(text), text);
  history.props.language = 'sq';
  out = JSON.stringify(history.render());
  for (const text of ['Porosia u anulua. Arsyeja: Sample explanation','2 × Sample dish','Sample waiter','0 të mbetura','anuluar']) assert.ok(out.includes(text), text);
});
