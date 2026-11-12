const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
function page(language) {
  class Component { constructor(props){this.props=props} setState(update){Object.assign(this.state,update)} }
  const React={Component,createElement(type,props,...children){return {type,props:props||{},children}}};
  const context={React,window:{arra:{transferCorrection:async()=>({ok:false})}}};
  vm.runInNewContext(require('./support/admin-bundle')(),context);
  return new context.ArraComponents.TransferCorrection({language,onBack(){}});
}
test('transfer confirmation translates direction, amounts, accessible name and errors without altering data',async()=>{
  const p=page('sq'); p.setState({loading:false,records:[{id:7,tableId:2,amount:125,paidAt:1}],table:2,selected:7,reason:'sample'});
  let result=JSON.stringify(p.render());
  assert.match(result,/Konfirmo nga B në A/); assert.match(result,/llogaria B në llogarinë A/); assert.match(result,/125 njësi/); assert.match(result,/Konfirmo korrigjimin e pagesës/);
  await p.correct(7); result=JSON.stringify(p.render()); assert.match(result,/Korrigjimi nuk u konfirmua/); assert.equal(p.state.records,null);
  p.props.language='en'; assert.match(JSON.stringify(p.render()),/Correction was not confirmed/);
});
test('transfer table names are preserved and language changes rerender the labels',()=>{
  const p=page('sq'); p.setState({loading:false,records:[],tables:[{id:2,area:'Garden',active:false}]});
  assert.match(JSON.stringify(p.render()),/Garden/); assert.match(JSON.stringify(p.render()),/Joaktive/);
  p.props.language='en'; assert.match(JSON.stringify(p.render()),/Inactive/);
});
