const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function harness(api) {
  class Component { constructor(props) { this.props = props; } setState(patch) { Object.assign(this.state, patch); } }
  const React = { Component, Fragment:'fragment', createElement(type, props, ...children) { return { type, props:props || {}, children }; } };
  const context = {React, window:{arra:api,confirm:()=>true}, crypto:{randomUUID:()=> 'test-token'}, setTimeout, clearTimeout};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  return context.ArraComponents.BusinessDays;
}
function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function' && !node.type.prototype?.render) return expand(node.type(node.props));
  return {...node,children:(node.children || []).flat().map(expand)};
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node && typeof node === 'object' ? (node.children || []).flat().map(text).join(' ') : '';
}

test('Albanian review, confirmation, close and print recovery use translated text', async () => {
  const issues = {orders:[],printJobs:[]};
  const data = {actorId:61,scope:'combined',queue:'sample',issues,canReviewOrders:true,days:[{id:7,openedAt:100,closedAt:null}]};
  const Day = harness({
    businessDays: async request => {
      if (request.action === 'close') {
        data.days[0] = {...data.days[0],closedAt:200,reportId:7,printAttempts:1,printResult:'uncertain',issues};
        data.days.unshift({id:8,openedAt:200,closedAt:null});
      }
      return {ok:true,data};
    },
    financialVisibility: async () => ({ok:true,data:{groups:[]}})
  });
  const page = new Day({language:'sq'});
  await page.load();
  let output = text(expand(page.render()));
  assert.match(output,/Dita aktuale #7/);
  assert.match(output,/Nuk ka porosi te hapura/);
  assert.match(output,/Nuk ka probleme me printimin per pergatitje/);
  await page.review(7);
  output = text(expand(page.render()));
  assert.match(output,/Te mbyllet dita #7/);
  assert.match(output,/per te dy pronaret/);
  await page.close(7);
  output = text(expand(page.render()));
  assert.match(output,/Dita #7 eshte mbyllur/);
  assert.match(output,/Raporti i restorantit/);
  assert.match(output,/Printo perseri pasi te kontrollosh printerin/);
  assert.match(output,/Nje problem printimi nuk e zhben mbylljen e dites/);
  assert.doesNotMatch(output,/successfully printed/i);
  page.componentWillUnmount();
});

