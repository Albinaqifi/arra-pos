const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
test('financial screen displays scoped results and clears them on a failed refresh', async () => {
  let fail = false; const requests = [];
  const api = { financialVisibility: async request => {
    requests.push(request); if (fail) return {ok:false};
    if (request.action === 'search') return {ok:true,data:[{id:1,account:'A',amount:100}]};
    if (request.action === 'aggregate') return {ok:true,data:{count:1,total:100}};
    if (request.action === 'unpaid') return {ok:true,data:null};
    return {ok:true,data:{payment:{id:1,account:'A',method:'cash',amount:100},lines:[{name:'Sample A',quantity:1,unitPrice:100}]}};
  }};
  class Component { constructor(props) {this.props=props;} setState(update) {Object.assign(this.state,update);} }
  const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children};}};
  const context={React,ReactDOM:{createRoot(){return {render(){}};}},document:{getElementById(){}},window:{arra:api},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){}};
  vm.runInNewContext(require('./support/admin-bundle')(), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/App.js'),'utf8')+'\nthis.Financial = ArraComponents.FinancialVisibility;', context);
  const screen = new context.Financial({onBack(){}}); await screen.load();
  assert.equal(screen.state.records[0].account,'A'); assert.equal(screen.state.totals.total,100);
  await screen.detail(1); assert.equal(screen.state.detail.lines[0].name,'Sample A');
  assert.deepEqual(requests.map(r=>r.action),['search','aggregate','unpaid','detail']);
  fail=true; await screen.load(); assert.equal(screen.state.records.length,0); assert.equal(screen.state.detail,null); assert.equal(screen.state.totals,null); assert.equal(screen.state.error,'Financial information unavailable.');
});
