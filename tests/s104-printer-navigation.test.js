const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const {moduleSource}=require('./support/renderer-bundle');

test('cash result survives leaving financial information, but an identity change clears it and ignores late replies',async()=>{
  class Component { constructor(props){this.props=props;} setState(value){Object.assign(this.state,value);} }
  const pending=[];
  const context={React:{Component,Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children})},window:{arra:{businessDays:req=>new Promise(resolve=>pending.push({req,resolve}))}}};
  vm.runInNewContext(moduleSource(path.resolve('src/admin/AdminWorkspace.js'),'Admin'),context);
  const workspace=new context.Admin.AdminWorkspace({signOut(){},refreshAccess(){}});
  const identity={generation:1,name:'Owner'}; workspace.setIdentity(identity);
  function printer() {
    workspace.navigate('financialVisibility');
    const shell=workspace.render({identity,language:'en'});
    const pageElement=shell.children[0], page=new pageElement.type(pageElement.props);
    page.setState({view:'accountAPrinter'});
    const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...node.children.flatMap(walk)]:[];
    const printerElement=walk(page.render()).find(node=>typeof node.type==='function' && node.type.name==='AccountAPrinter');
    const screen=new printerElement.type(printerElement.props); screen.componentDidMount();
    return {screen,page};
  }
  let current=printer();
  current.screen.setState({view:'cash',amount:'5',review:true});
  const first=current.screen.confirmCash();
  assert.equal(pending.length,1);
  current.screen.componentWillUnmount(); current.page.componentWillUnmount(); workspace.returnToOverview();
  current=printer();
  assert.equal(current.screen.state.cashBusy,true);
  assert.match(JSON.stringify(current.screen.render()),/Cash movement request in progress/);
  pending[0].resolve({ok:false,outcome:'unknown'}); await first;
  assert.equal(current.screen.state.cashResult,'unknown');
  assert.match(JSON.stringify(current.screen.render()),/The printer may already have recorded this cash movement/);
  assert.equal(current.screen.state.cashBusy,false);
  assert.equal(pending.length,1);
  current.screen.setState({view:'cash',amount:'6',review:true});
  const second=current.screen.confirmCash(); assert.equal(pending.length,2);
  workspace.setIdentity({generation:2,name:'Other'});
  assert.equal(current.screen.state.cashResult,'');
  assert.equal(current.screen.state.cashBusy,false);
  pending[1].resolve({ok:false,outcome:'declined'}); await second;
  assert.equal(current.screen.state.cashResult,'');
  current.screen.componentWillUnmount();
});
