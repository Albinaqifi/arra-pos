const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
test('date controls remain disabled until the requested report returns', async () => {
  let resolve;
  const api = { operationalReports: () => new Promise(r => { resolve = r; }) };
  class Component { constructor(props) { this.props=props; } setState(update) { Object.assign(this.state,update); } }
  const React = {Component, Fragment:'fragment', createElement(type,props,...children) { return {type,props:props||{},children}; }};
  const context = {React,ReactDOM:{createRoot(){return {render(){}};}},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Report = ArraComponents.OperationalReports;', context);
  const screen = new context.Report({onBack(){}});
  screen.setState({from:'2026-01-01',to:'2026-01-02'});
  const pending = screen.load({preventDefault(){}});
  function inputs(node) { return !node || typeof node !== 'object' ? [] : [...(node.type === 'input' ? [node] : []), ...node.children.flatMap(inputs)]; }
  assert.equal(screen.state.busy, true);
  const dates = inputs(screen.render());
  assert.equal(dates.length,2); assert.ok(dates.every(input => input.props.disabled));
  resolve({ok:true,data:{products:[],tables:[],waiters:[]}}); await pending;
  assert.equal(screen.state.busy,false); assert.ok(inputs(screen.render()).every(input => !input.props.disabled));
  assert.ok(screen.state.data);
});

test('report displays the selected period results and provisional attribution, then clears on failure', async () => {
  let request;
  let response = {ok:true, data:{products:[{productId:'p',name:'Soup',quantity:2,value:250}],tables:[{tableId:7,count:1}],waiters:[{actor:'sample',count:1}]}};
  class Component { constructor(props) { this.props=props; } setState(update) { Object.assign(this.state,update); } }
  const React = {Component, Fragment:'fragment', createElement(type,props,...children) { return {type,props:props||{},children}; }};
  const context = {React,ReactDOM:{createRoot(){return {render(){}};}},document:{getElementById(){}},window:{arra:{operationalReports: async r => { request=r; return response; }}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Report = ArraComponents.OperationalReports;', context);
  const screen = new context.Report({onBack(){}});
  screen.setState({from:'2026-01-01',to:'2026-01-02'});
  await screen.load({preventDefault(){}});
  assert.equal(request.from, new Date('2026-01-01T00:00:00').getTime());
  assert.equal(request.to, new Date('2026-01-03T00:00:00').getTime());
  const content = JSON.stringify(screen.render());
  for (const part of ['Soup', 'quantity 2', 'value 250', 'Table 7', 'sample', 'Provisional', 'moved tables', 'contributing waiter']) assert.ok(content.includes(part), part);
  response = {ok:false};
  await screen.load({preventDefault(){}});
  assert.equal(screen.state.data, null);
  assert.equal(screen.state.error, 'Report unavailable.');
});
