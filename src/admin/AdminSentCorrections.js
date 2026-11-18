import { configText } from './config-i18n.js';
const h = React.createElement;
export class AdminSentCorrections extends React.Component {
  constructor(props) { super(props); this.state = { items: [], authorized: false, loading: true, error: '', selected: null, quantity: 1, reason: '', busy: false, pending: null, uncertain: false, notice: '' }; }
  t(key) { return configText(this.props.language,key); }
  componentDidMount() { this.load(); }
  leaveEditor() { return !this.state.busy && !this.state.pending; }
  async load() {
    this.setState({loading:true,error:''});
    try {
      const result = await window.arra.adminSentCorrection({action:'list'});
      if (!result.ok || !Array.isArray(result.data?.items)) throw Error();
      this.setState({items:result.data.items,authorized:true,loading:false,error:''});
    } catch (_) { this.setState({loading:false,error:this.t('Open orders unavailable or access denied.')}); }
  }
  async submit() {
    if (this.state.busy) return;
    const item=this.state.items.find(i=>i.itemId===this.state.selected);
    const req=this.state.pending || (item && {action:'correct',orderId:item.orderId,itemId:item.itemId,quantity:Number(this.state.quantity),reason:this.state.reason.trim(),requestId:crypto.randomUUID()});
    if (!req || !Number.isSafeInteger(req.quantity) || req.quantity<1 || (!this.state.pending && req.quantity>item.remaining)) { this.setState({error:this.t('Enter a whole quantity between 1 and the remaining quantity.')}); return; }
    if (!req.reason || req.reason.length>500) { this.setState({error:this.t('Enter a reason of up to 500 characters.')}); return; }
    if (!this.state.pending && !window.confirm(this.t('Confirm correction:')+' '+this.t('Table')+' '+item.tableId+' · '+item.name+' (#'+item.itemId+') · '+this.t('Quantity')+' '+req.quantity+'\n'+this.t('Tell preparation staff in person.'))) return;
    this.setState({busy:true,pending:req,error:'',notice:''});
    try {
      const result=await window.arra.adminSentCorrection(req);
      if (result.ok) { this.props.onJobsChanged?.(); this.setState({busy:false,pending:null,uncertain:false,selected:null,quantity:1,reason:'',notice:this.t(result.testPrintEnabled ? 'Correction saved. Tell preparation staff in person.' : 'Correction saved. Printing is disabled. Check previous output and tell preparation staff in person.')}); await this.load(); }
      else if (result.uncertain || this.state.uncertain) this.setState({busy:false,uncertain:true,error:this.t('The result is uncertain. Retry the same correction.')});
      else { this.setState({busy:false,pending:null}); await this.load(); this.setState({error:this.t('Correction was rejected. Refresh and check the order.')}); }
    } catch (_) { this.setState({busy:false,uncertain:true,error:this.t('The result is uncertain. Retry the same correction.')}); }
  }
  async setOwnerPin(event) {
    event.preventDefault();
    if (this.state.busy || this.state.pending) return;
    const input = event.currentTarget.elements.pin, pin = input.value;
    input.value = '';
    if (!/^\d{6}$/.test(pin)) { this.setState({ error: this.t('Enter a 6-digit PIN.') }); return; }
    if (!window.confirm(this.t('Set your owner approval PIN? Your session will end.'))) return;
    this.setState({ busy: true, error: '' });
    try {
      const result = await window.arra.employeeConfig({ action: 'ownApprovalPin', pin });
      if (result.uncertain) {
        if (this.props.onAccessChanged && !(await this.props.onAccessChanged())) return;
        this.setState({ busy: false, error: this.t('PIN result unknown. Sign in again and check before retrying.') });
        return;
      }
      if (!result.ok) { this.setState({ busy: false, error: this.t('Could not set owner approval PIN.') }); return; }
      if (this.props.onAccessChanged) await this.props.onAccessChanged();
      else this.setState({ busy: false, notice: this.t('PIN saved. Sign in again.') });
    } catch (_) {
      if (this.props.onAccessChanged && !(await this.props.onAccessChanged())) return;
      this.setState({ busy: false, error: this.t('PIN result unknown. Sign in again and check before retrying.') });
    }
  }
  render() {
    const s=this.state, t=x=>this.t(x), item=s.items.find(i=>i.itemId===s.selected), locked=!!s.pending || s.busy;
    const groups=new Map(); s.items.forEach(i=>{ if (!groups.has(i.tableId)) groups.set(i.tableId,[]); groups.get(i.tableId).push(i); });
    const qty=Number(s.quantity), valid=Number.isSafeInteger(qty) && qty>=1 && item && qty<=item.remaining;
    return h('main',{className:'floor-page correction-page'},h('button',{onClick:this.props.onBack,disabled:locked},t('← Back to administration')),
      h('h1',null,t('Correct sent items')),
      h('p',null,t('Find a table, select a sent item, then enter how many to cancel and why.')),
      h('p',{className:'floor-note'},t('A correction reduces the remaining quantity on an unbilled open order. Tell preparation staff in person; a printed notice does not guarantee they have seen it.')),
      s.authorized && h('details',{className:'floor-list'},h('summary',null,t('Set owner approval PIN')),h('p',null,t('Use this PIN to approve late sent-item cancellations. Saving ends your current session.')),h('form',{onSubmit:e=>this.setOwnerPin(e)},h('label',null,t('New 6-digit PIN'),h('input',{name:'pin',type:'password',inputMode:'numeric',pattern:'[0-9]{6}',minLength:6,maxLength:6,required:true,disabled:locked,autoComplete:'new-password'})),h('button',{type:'submit',disabled:locked},t('Set owner approval PIN')))),
      s.loading && h('p',{role:'status'},t('Loading…')),s.error && h('p',{role:'alert'},s.error),s.notice && h('p',{role:'status'},s.notice),
      !s.loading && !s.pending && s.error && h('button',{type:'button',onClick:()=>this.load()},t('Refresh list')),
      !s.loading && !s.error && !s.items.length && h('p',{className:'floor-empty'},t('No sent items available for correction.')),
      !s.loading && s.items.length>0 && h('div',{className:'correction-layout'},
        h('section',{'aria-label':t('Choose a sent item')},h('h2',null,t('1. Find a table and select an item')),
          Array.from(groups,([table,items])=>h('section',{className:'correction-table',key:table},h('h3',null,t('Table')+' '+table),h('ul',null,items.map(i=>h('li',{key:i.itemId},h('button',{type:'button',className:'correction-item'+(s.selected===i.itemId?' selected':''),'aria-pressed':s.selected===i.itemId,disabled:locked,onClick:()=>this.setState({selected:i.itemId,quantity:1,reason:'',error:'',notice:''})},h('strong',null,i.name),h('span',null,t('Remaining')+' '+i.remaining+' · '+t('Item #')+i.itemId)))))))),
        h('section',{className:'correction-form'},h('h2',null,t('2. Enter the correction')), !item ? h('p',null,t('Select an item to continue.')) :
          h('form',{onSubmit:e=>{e.preventDefault();this.submit();}},h('p',null,h('strong',null,t('Table')+' '+item.tableId+' · '+item.name),h('br'),t('Item #')+item.itemId+' · '+t('Remaining')+' '+item.remaining),
            h('label',null,t('Quantity to cancel'),h('input',{type:'number',min:1,max:item.remaining,step:1,value:s.quantity,disabled:locked,onChange:e=>this.setState({quantity:e.target.value})})),
            h('p',{className:'correction-effect'},valid ? t('Remaining after correction:')+' '+(item.remaining-qty) : t('Choose a whole quantity within the remaining amount.')),
            h('label',null,t('Reason (required)'),h('textarea',{value:s.reason,maxLength:500,disabled:locked,onChange:e=>this.setState({reason:e.target.value})})),
            h('button',{type:'submit',className:'floor-primary',disabled:s.busy},s.pending?t('Retry same correction'):t('Review and save correction'))))));
  }
}
