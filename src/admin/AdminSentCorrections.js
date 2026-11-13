import { configText } from './config-i18n.js';
const h = React.createElement;
export class AdminSentCorrections extends React.Component {
  constructor(props) { super(props); this.state = { items: [], loading: true, error: '', selected: null, quantity: 1, reason: '', busy: false, pending: null, notice: '' }; }
  t(key) { return configText(this.props.language,key); }
  componentDidMount() { this.load(); }
  leaveEditor() { return !this.state.busy && !this.state.pending; }
  async load() {
    try {
      const result = await window.arra.adminSentCorrection({action:'list'});
      if (!result.ok || !Array.isArray(result.data?.items)) throw Error();
      this.setState({items:result.data.items,loading:false,error:''});
    } catch (_) { this.setState({loading:false,error:this.t('Open orders unavailable or access denied.')}); }
  }
  async submit() {
    if (this.state.busy) return;
    const item=this.state.items.find(i=>i.itemId===this.state.selected);
    const req=this.state.pending || (item && {action:'correct',orderId:item.orderId,itemId:item.itemId,quantity:Number(this.state.quantity),reason:this.state.reason.trim(),requestId:crypto.randomUUID()});
    if (!req || !Number.isSafeInteger(req.quantity) || req.quantity<1 || (!this.state.pending && req.quantity>item.remaining) || !req.reason || req.reason.length>500) { this.setState({error:this.t('Enter a valid quantity and reason.')}); return; }
    if (!this.state.pending && !window.confirm(this.t('Correct this sent item? Tell preparation staff in person.'))) return;
    this.setState({busy:true,pending:req,error:'',notice:''});
    try {
      const result=await window.arra.adminSentCorrection(req);
      if (result.ok) { this.setState({busy:false,pending:null,selected:null,quantity:1,reason:'',notice:this.t('Correction saved.')}); await this.load(); }
      else if (result.uncertain) this.setState({busy:false,error:this.t('The result is uncertain. Retry the same correction.')});
      else { this.setState({busy:false,pending:null}); await this.load(); this.setState({error:this.t('Correction was rejected. Refresh and check the order.')}); }
    } catch (_) { this.setState({busy:false,error:this.t('The result is uncertain. Retry the same correction.')}); }
  }
  render() {
    const s=this.state, t=x=>this.t(x), item=s.items.find(i=>i.itemId===s.selected), locked=!!s.pending || s.busy;
    return h('main',{className:'floor-page'},h('button',{onClick:this.props.onBack,disabled:locked},t('← Back to administration')),
      h('h1',null,t('Correct sent items')),h('p',null,t('Combined can correct sent items on unbilled open orders. Tell preparation staff in person.')),
      s.loading && h('p',{role:'status'},t('Loading…')),s.error && h('p',{role:'alert'},s.error),s.notice && h('p',{role:'status'},s.notice),
      !s.loading && !s.error && !s.items.length && h('p',null,t('No sent items available for correction.')),
      h('ul',null,s.items.map(i=>h('li',{key:i.itemId},h('button',{type:'button',disabled:locked,onClick:()=>this.setState({selected:i.itemId,quantity:1,reason:''})},t('Table')+' '+i.tableId+' · '+i.name+' · '+t('Remaining')+' '+i.remaining)))),
      item && h('form',{onSubmit:e=>{e.preventDefault();this.submit();}},h('h2',null,item.name),
        h('label',null,t('Quantity'),h('input',{type:'number',min:1,max:item.remaining,value:s.quantity,disabled:locked,onChange:e=>this.setState({quantity:e.target.value})})),
        h('label',null,t('Reason'),h('textarea',{value:s.reason,maxLength:500,required:true,disabled:locked,onChange:e=>this.setState({reason:e.target.value})})),
        h('button',{type:'submit',disabled:s.busy},s.pending?t('Retry same correction'):t('Save correction'))));
  }
}
