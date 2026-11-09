const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
function screen(api) {
  class Component { constructor(props) { this.props=props; } setState(update) { Object.assign(this.state,update); } }
  const React={Component,createElement(type,props,...children){return {type,props:props||{},children};}};
  const context={React,window:{arra:api}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);
  return new context.ArraComponents.TransferCorrection({onBack(){}});
}
test('transfer confirmation submits once and refreshes after success', async () => {
  let resolve, calls=[];
  const page=screen({transferCorrection: req => {
    calls.push(req);
    if(req.action==='correct') return new Promise(r=>resolve=r);
    return Promise.resolve({ok:true,data:{payments:[],tables:[]}});
  }});
  page.setState({records:[{id:7,tableId:1,amount:100,paidAt:1}],table:1,selected:7,reason:'sample'});
  const pending=page.correct(7);
  await page.correct(7);
  assert.equal(calls.length,1);
  assert.equal(calls[0].reason,'sample');
  resolve({ok:true}); await pending;
  assert.equal(calls.length,2);
  assert.equal(calls[1].action,'list');
  assert.match(page.state.success,/Payment #7 corrected/);
  assert.equal(page.state.reason,'');
});
test('uncertain correction removes the stale list until refresh', async () => {
  const page=screen({transferCorrection: async req => {
    if(req.action==='correct') throw Error('unavailable');
    return {ok:true,data:{payments:[],tables:[]}};
  }});
  page.setState({records:[{id:7,tableId:1}],table:1,selected:7});
  await page.correct(7);
  assert.equal(page.state.records,null);
  assert.equal(page.state.selected,null);
  assert.match(page.state.error,/Refresh/);
  await page.load();
  assert.equal(page.state.records.length,0);
});
