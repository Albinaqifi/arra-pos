import { financeText } from './finance-i18n.js';
const h=React.createElement;
function receiptStatusText(row, language) {
  const labels = {
    queued: ['Fiscal receipt queued', 'Kuponi fiskal në pritje'],
    unconfirmed: ['Fiscal receipt unconfirmed', 'Kuponi fiskal i pakonfirmuar'],
    acknowledged: ['Fiscal receipt acknowledged', 'Kuponi fiskal i konfirmuar'],
  };
  if (!Object.hasOwn(labels, row.receiptStatus)) return '';
  const label = labels[row.receiptStatus][language === 'sq' ? 1 : 0];
  return row.receiptStatus === 'acknowledged' && typeof row.documentNumber === 'string' && /^[0-9]{7}$/.test(row.documentNumber)
    ? label + ' · ' + row.documentNumber : label;
}
export class AccountABills extends React.Component {
  constructor(props) { super(props); this.state={data:null,preview:null,dayId:'',busy:false,notice:'',error:''}; this.active=false; this.sequence=0; this.busy=false; }
  componentDidMount(){this.active=true;this.load();}
  componentWillUnmount(){this.active=false;this.sequence++;}
  async load(){
    const seq=++this.sequence;
    try { const r=await window.arra.businessDays({action:'accountABillsList'}); if(!this.active||seq!==this.sequence)return;
      if(!r.ok)return this.setState({error:'Account A bills unavailable.'});
      const dayId=this.state.dayId || String(r.data.days[0]?.id || ''); this.setState({data:r.data,dayId,error:''}); if(dayId)this.preview(dayId);
    } catch(_){if(this.active&&seq===this.sequence)this.setState({error:'Account A bills unavailable.'});}
  }
  async preview(dayId){
    const seq=++this.sequence; this.setState({dayId,preview:null,error:'',notice:''});
    try {const r=await window.arra.businessDays({action:'accountABillsPreview',dayId:Number(dayId)}); if(!this.active||seq!==this.sequence)return; this.setState(r.ok?{preview:r.data}:{error:'Account A bills unavailable.'});}
    catch(_){if(this.active&&seq===this.sequence)this.setState({error:'Account A bills unavailable.'});}
  }
  async configure(queue){
    if(this.busy)return; this.busy=true;this.setState({busy:true,notice:''});
    try {const r=await window.arra.businessDays({action:'accountABillsConfigure',queue:queue.trim()}); if(this.active){this.setState({notice:r.ok?'Printer queue saved.':'Printer queue could not be saved.'});if(r.ok)await this.load();}}
    catch(_){if(this.active)this.setState({notice:'Printer queue could not be saved.'});}
    finally{this.busy=false;if(this.active)this.setState({busy:false});}
  }
  async print(){
    const p=this.state.preview; if(this.busy||!p||!window.confirm(financeText(this.props.language,'Check the printer and paper before printing. A retry may print a duplicate. Continue?')))return;
    this.busy=true;this.setState({busy:true,notice:''});
    try {const r=await window.arra.businessDays({action:'accountABillsPrint',dayId:p.id,digest:p.digest,language:this.props.language==='sq'?'sq':'en',checked:true});
      if(this.active)this.setState({notice:r.ok?'Sent to the printer queue. Check the paper; queue acceptance does not confirm printing.':r.stale?'Payments changed. Refresh the preview before printing.':r.failed?'Printing failed. Check the printer before retrying.':'Print result may be unknown. Check the printer and paper before trying again.'});
    }catch(_){if(this.active)this.setState({notice:'Print result may be unknown. Check the printer and paper before trying again.'});}
    finally{this.busy=false;if(this.active)this.setState({busy:false});}
  }
  render(){const s=this.state,t=(k,v)=>financeText(this.props.language,k,v),p=s.preview;
    return h('section',{className:'history-panel account-a-bills'},h('p',{className:'history-muted'},t('Non-fiscal Account A paid bills. Printing does not close a day.')),
      s.error&&h('p',{role:'alert'},t(s.error)),s.notice&&h('p',{role:'status'},t(s.notice)),!s.data&&!s.error&&h('p',{role:'status'},t('Loading…')),
      s.data&&h(React.Fragment,null,h('div',{className:'report-form'},h('label',null,t('Business day'),h('select',{value:s.dayId,disabled:s.busy,onChange:e=>this.preview(e.target.value)},s.data.days.map(d=>h('option',{key:d.id,value:d.id},t('Business day #{id}',{id:d.id})+' · '+new Date(d.openedAt).toLocaleString()+(d.closedAt===null?' · '+t('Open'):'')))))),
        !p&&!s.error&&s.dayId&&h('p',{role:'status'},t('Loading…')),
        p&&h('div',{className:'finance-day'},h('h3',null,t('Business day #{id}',{id:p.id})),
          h('p',{className:'history-muted'},t('Amount (minor units)')),
          p.records.length?h('ul',{className:'history-items account-a-bill-list'},p.records.map(r=>h('li',{key:r.billId},h('span',null,h('strong',null,t('Bill #{id}',{id:r.billId})),r.receiptStatus&&h('small',null,receiptStatusText(r,this.props.language))),h('strong',null,r.amount.toLocaleString())))):h('p',{className:'floor-empty'},t('No paid Account A bills for this day.')),
          h('div',{className:'finance-metrics'},[['Total',p.total],['Cash',p.cash],['Card',p.card]].map(([label,value])=>h('div',{key:label},h('span',null,t(label)),h('strong',null,value.toLocaleString())))),
          h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.print()},t('Print Account A bills')),h('button',{disabled:s.busy,onClick:()=>this.preview(s.dayId)},t('Refresh preview')))),
        s.data.canConfigure&&h('details',{className:'day-details'},h('summary',null,t('Account A bills printer settings')),h('form',{className:'report-form account-a-printer-form',key:s.data.queue,onSubmit:e=>{e.preventDefault();this.configure(e.currentTarget.elements.queue.value);}},h('label',null,t('Printer queue '),h('input',{name:'queue',required:true,maxLength:255,defaultValue:s.data.queue})),h('button',{type:'submit',disabled:s.busy},t('Save printer queue'))))));
  }
}
