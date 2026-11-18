import { financeText } from './finance-i18n.js';
const h=React.createElement;
// Keep an unresolved retry identity even if the financial screen is left and reopened.
const retryTokens=new Map();
const date=value=>new Date(value).toLocaleString();
export class AccountAClosing extends React.Component {
  constructor(props) { super(props); this.state={data:null,loading:true,busy:false,error:'',notice:'',confirmId:null}; this.sequence=0; this.active=false; this.busy=false; }
  componentDidMount() { this.active=true; this.load(); }
  componentWillUnmount() { this.active=false; this.sequence++; }
  async load() {
    const sequence=++this.sequence;
    this.setState({loading:true,error:''});
    try {
      const r=await window.arra.businessDays({action:'accountAList'});
      if(!this.active || sequence!==this.sequence) return;
      if(!r.ok) return this.setState({data:null,loading:false,error:'Account A closing is unavailable or access is denied.'});
      this.setState({data:r.data,loading:false});
    } catch (_) { if(this.active && sequence===this.sequence) this.setState({data:null,loading:false,error:'Could not load Account A closing. Try again.'}); }
  }
  async close(id) {
    if(this.busy || this.state.confirmId!==id) return;
    this.busy=true; this.setState({busy:true,error:'',notice:''});
    try {
      const r=await window.arra.businessDays({action:'accountAClose',dayId:id,language:this.props.language==='sq'?'sq':'en'});
      if(!this.active) return;
      this.setState({confirmId:null,notice:r.ok?'Account A close recorded. Check the report print status.':'Close result unavailable. Refresh and check the day before trying again.'});
      await this.load();
    } catch (_) { if(this.active) { this.setState({confirmId:null,notice:'Close result unavailable. Refresh and check the day before trying again.'}); await this.load(); } }
    finally { this.busy=false; if(this.active) this.setState({busy:false}); }
  }
  async retry(id) {
    if(this.busy || !window.confirm(financeText(this.props.language,'Have you checked the printer and paper? Retrying may print a duplicate.'))) return;
    this.busy=true;
    const requestId=retryTokens.get(id) || crypto.randomUUID(); retryTokens.set(id,requestId);
    this.setState({busy:true,error:'',notice:''});
    try {
      const r=await window.arra.businessDays({action:'accountARetry',dayId:id,requestId,checked:true});
      if(r.ok) retryTokens.delete(id);
      if(!this.active) return;
      this.setState({notice:r.ok?'Report print attempt started. Refresh for its status.':'Print retry result unknown. Check the printer and refresh before trying again.'});
      await this.load();
    } catch (_) { if(this.active) { this.setState({notice:'Print retry result unknown. Check the printer and refresh before trying again.'}); await this.load(); } }
    finally { this.busy=false; if(this.active) this.setState({busy:false}); }
  }
  async configure(queue) {
    if(this.busy) return;
    this.busy=true; this.setState({busy:true,error:'',notice:''});
    try {
      const r=await window.arra.businessDays({action:'accountAConfigure',queue:queue.trim()});
      if(!this.active) return;
      this.setState({notice:r.ok?'Printer queue saved.':'Printer queue could not be saved.'});
      if(r.ok) await this.load();
    } catch (_) { if(this.active) this.setState({notice:'Printer queue could not be saved.'}); }
    finally { this.busy=false; if(this.active) this.setState({busy:false}); }
  }
  render() {
    const s=this.state,t=(key,values)=>financeText(this.props.language,key,values);
    const printStatus=day=>!day.printAttempts?t('No report print attempt recorded.'):day.printResult==='accepted'?t('Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.'):day.printResult==='failed'?t('Printing failed. Check the printer before retrying.'):t('Print result is uncertain or still in progress. Refresh after the printer finishes and check the paper before retrying.');
    return h('section',{className:'history-panel'},h('p',null,t('This is a separate, non-fiscal Account A close. The current shared day remains open.')),
      s.loading && h('p',{role:'status'},t('Loading…')),s.error && h('p',{role:'alert'},t(s.error)),s.notice && h('p',{role:'status'},t(s.notice)),
      !s.loading && h('button',{disabled:s.busy,onClick:()=>this.load()},t('Refresh')),
      s.data && !s.loading && h(React.Fragment,null,
        !s.data.days.length && h('p',null,t('No eligible closed days yet.')),
        s.data.days.map(day=>h('div',{className:'finance-day',key:day.id},
          h('h3',null,t('Business day #{id}',{id:day.id})),h('p',null,t('Opened {opened} · Closed {closed}',{opened:date(day.openedAt),closed:date(day.closedAt)})),
          h('p',null,day.status==='complete'?t('Account A close complete'):t('Account A close pending')),
          h('div',{className:'finance-metrics'},h('div',null,h('span',null,t('Payments')),h('strong',null,day.count)),h('div',null,h('span',null,t('Total')),h('strong',null,day.total)),h('div',null,h('span',null,t('Cash')),h('strong',null,day.cash)),h('div',null,h('span',null,t('Card')),h('strong',null,day.card))),h('p',{className:'history-muted'},t('Amounts in minor units · non-fiscal')),
          day.status==='complete' ? h(React.Fragment,null,h('p',null,t('Account A closed {date} by actor #{actor}',{date:date(day.accountClosedAt),actor:day.closedBy})),h('p',{role:day.printResult==='failed'?'alert':'status'},printStatus(day)),h('p',null,t('{count} attempt(s) · status: {status}',{count:day.printAttempts,status:t(day.printResult || 'Unavailable')})),h('button',{disabled:s.busy,onClick:()=>this.retry(day.id)},t('Retry report after checking printer'))) :
          s.confirmId===day.id ? h('div',{className:'finance-confirm',role:'group','aria-label':t('Confirm Account A close')},h('p',null,t('Close Account A for this day and attempt to print its non-fiscal report?')),h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close(day.id)},s.busy?t('Closing…'):t('Confirm close')),h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:null})},t('Cancel')))) : h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:day.id,notice:''})},t('Review and close Account A')))),
        h('details',{className:'day-details'},h('summary',null,t('Account A closing printer settings')),h('p',null,t('Choose a local Windows queue. This can be the same printer as Account A bills.')),h('form',{key:s.data.queue,onSubmit:e=>{e.preventDefault();this.configure(e.currentTarget.elements.queue.value);}},h('label',null,t('Printer queue '),h('input',{name:'queue',defaultValue:s.data.queue,required:true,maxLength:255})),h('button',{type:'submit',disabled:s.busy},t('Save printer queue'))))));
  }
}
