const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
function screen(shifts, language='en') {
  class Component { constructor(props){this.props=props} setState(p){Object.assign(this.state,p)} }
  const React={Component,Fragment:'fragment',createElement(type,props,...children){return {type,props:props||{},children}}};
  const day={actorId:1,scope:'combined',issues:{orders:[],printJobs:[]},days:[{id:8,openedAt:1,closedAt:null}]};
  const calls=[];
  const api={businessDays:async req=>{calls.push(req.action);return req.action==='shiftList'?shifts():{ok:true,data:day}},financialVisibility:async()=>({ok:true,data:{groups:[]}})};
  const context={React,window:{arra:api},setTimeout,clearTimeout};
  const path=require('node:path');
  vm.runInNewContext(require('./support/renderer-bundle').moduleSource(path.resolve(__dirname,'../src/admin/BusinessDays.js'),'Days'),context);
  return {page:new context.Days.BusinessDays({language}),calls};
}
const shift=(id,dayId,closedAt,reportable)=>({id,dayId,closedAt,reportable});
const result=shifts=>({ok:true,data:{dayId:8,shifts}});
test('day confirmation mentions only an active successor after a handover',async()=>{
  let value=result([shift(2,8,null,true),shift(1,8,4,true)]);
  const {page,calls}=screen(()=>value);
  await page.load(); await page.review(8);
  assert.match(JSON.stringify(page.render()),/Closing the day also finishes the active shift/);
  assert.equal(calls.filter(action=>action==='close').length,0);
  value=result([shift(2,8,null,false),shift(1,8,4,true)]);
  await page.review(8);assert.doesNotMatch(JSON.stringify(page.render()),/Closing the day also finishes the active shift/);
  value=result([shift(1,8,null,true),shift(9,7,4,true)]);
  await page.review(8);assert.doesNotMatch(JSON.stringify(page.render()),/Closing the day also finishes the active shift/);
  value={ok:true,data:{dayId:9,shifts:[shift(2,8,null,true),shift(1,8,4,true)]}};
  await page.review(8);assert.doesNotMatch(JSON.stringify(page.render()),/Closing the day also finishes the active shift/);
  value={ok:false};await page.review(8);assert.equal(page.state.confirmId,8);assert.equal(page.state.finishesShift,null);assert.match(JSON.stringify(page.render()),/Shift status is unavailable/);
  page.componentWillUnmount();
});
test('day confirmation refreshes a changed successor and requires confirmation again',async()=>{
  let value=result([shift(2,8,null,false),shift(1,8,4,true)]);
  const {page,calls}=screen(()=>value);await page.load();await page.review(8);
  value=result([shift(2,8,null,true),shift(1,8,4,true)]);
  await page.close(8);assert.equal(calls.filter(action=>action==='close').length,0);assert.match(JSON.stringify(page.render()),/Closing the day also finishes the active shift/);
  value={ok:false};await page.close(8);assert.equal(calls.filter(action=>action==='close').length,0);assert.match(JSON.stringify(page.render()),/Shift status is unavailable/);
  value=result([shift(2,8,null,true),shift(1,8,4,true)]);await page.close(8);assert.equal(calls.filter(action=>action==='close').length,0);assert.match(JSON.stringify(page.render()),/Closing the day also finishes the active shift/);
  page.componentWillUnmount();
});
test('late shift lookup cannot restore an obsolete day review',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);
  const {page}=screen(()=>pending);await page.load();
  const review=page.review(8);page.componentWillUnmount();
  resolve(result([shift(2,8,null,true),shift(1,8,4,true)]));await review;
  assert.equal(page.state.confirmId,null);assert.equal(page.state.finishesShift,false);
});
