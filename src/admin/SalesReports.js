import { FinancialDetail } from './FinancialDetails.js';
export class SalesReports extends React.Component {
  constructor(props) { super(props); this.state = { days:[], period:'day', dayId:'', from:'', to:'', account:'', method:'', data:null, error:'', busy:false, detailId:null, detail:null, detailError:'', detailLoading:false }; this.detailSequence=0; }
  async componentDidMount() {
    try {
      const r=await window.arra.financialVisibility({action:'reportDays'});
      if (!r.ok) return this.setState({error:'Business days unavailable.'});
      const open=r.data.find(d=>d.closedAt===null);
      this.setState({days:r.data,dayId:open ? String(open.id) : '',error:open ? '' : 'No open system day is available.'});
      if (open) await this.load({preventDefault(){}},open.id);
    } catch (_) { this.setState({data:null,error:'Business days unavailable.'}); }
  }
  componentWillUnmount() { this.detailSequence++; }
  async openDetail(id) {
    const sequence=++this.detailSequence;
    this.setState({detailId:id,detail:null,detailError:'',detailLoading:true});
    try {
      const r=await window.arra.financialVisibility({action:'detail',paymentId:id});
      if(sequence!==this.detailSequence) return;
      this.setState(r.ok ? {detail:r.data,detailLoading:false} : {detailLoading:false,detailError:'Payment detail unavailable or outside your access.'});
    } catch (_) { if(sequence===this.detailSequence) this.setState({detailLoading:false,detailError:'Payment detail unavailable. Try again.'}); }
  }
  closeDetail() { this.detailSequence++; this.setState({detailId:null,detail:null,detailError:'',detailLoading:false}); }
  async load(e, initialDayId) {
    e.preventDefault();
    let from = null, to = null, dayId = null;
    if (this.state.period === 'day') {
      dayId = Number(initialDayId || this.state.dayId);
      if (!Number.isSafeInteger(dayId) || dayId <= 0) return this.setState({data:null,error:'Choose a business day.'});
    } else {
      from = new Date(this.state.from + 'T00:00:00').getTime();
      const end = new Date(this.state.to + 'T00:00:00'); end.setDate(end.getDate() + 1); to = end.getTime();
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to) return this.setState({data:null,error:'Choose a valid date range.'});
    }
    this.closeDetail(); this.setState({busy:true,data:null,error:''});
    try {
      const r=await window.arra.financialVisibility({action:'report',from,to,dayId,account:this.state.account || null,method:this.state.method || null});
      this.setState(r.ok ? {busy:false,data:r.data,error:''} : {busy:false,data:null,error:'Report unavailable or account outside your scope.'});
    } catch (_) { this.setState({busy:false,data:null,error:'Report unavailable. Try again.'}); }
  }
  render() {
    const h=React.createElement, s=this.state, today=this.props.mode !== 'reports';
    const day=s.days.find(d=>String(d.id)===String(s.dayId));
    const select = (name, options) => h('select', {value:s[name],disabled:s.busy,onChange:e=>{this.closeDetail();this.setState({[name]:e.target.value,data:null});}}, options.map(([value,label])=>h('option',{key:value,value},label)));
    const time=value=>new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    const date=value=>new Date(value).toLocaleDateString();
    const multipleDates=s.data && new Set(s.data.records.map(p=>date(p.paidAt))).size>1;
    const amount=value=>value.toLocaleString();
    const total=s.data ? s.data.groups.reduce((sum,g)=>sum+BigInt(g.total),0n) : 0n;
    return h('section',{className:'finance-report'},
      h('div',{className:'finance-report-heading'},h('div',null,h('p',{className:'finance-kicker'},today?'OPEN SYSTEM DAY':'REPORTS'),h('h2',null,today?'Current day':'Review turnover'),h('p',null,today?'Payments recorded since this day opened.':'Choose a business day or a date range.')),day && s.period==='day' && h('span',{className:'finance-report-date'},'Opened '+new Date(day.openedAt).toLocaleString()+(day.closedAt===null?'':' · Closed '+new Date(day.closedAt).toLocaleString()))),
      !today && h('form',{className:'finance-filters',onSubmit:e=>this.load(e)},
        h('label',null,'Period',select('period',[['day','Business day'],['date','Payment date']])),
        s.period==='date' ? h(React.Fragment,null,h('label',null,'From',h('input',{type:'date',value:s.from,disabled:s.busy,onChange:e=>this.setState({from:e.target.value,data:null})})),h('label',null,'Through',h('input',{type:'date',value:s.to,disabled:s.busy,onChange:e=>this.setState({to:e.target.value,data:null})}))) : h('label',null,'Business day',select('dayId',[['','Choose'],...s.days.map(d=>[String(d.id),new Date(d.openedAt).toLocaleString()+(d.closedAt===null?' · open':' · closed '+new Date(d.closedAt).toLocaleString())])])),
        h('label',null,'Account',select('account',[['','Allowed scope'],['A','A'],['B','B']])),h('label',null,'Method',select('method',[['','All methods'],['cash','Cash'],['card','Card']])),h('button',{className:'floor-primary',disabled:s.busy},'Show report')),
      today && h('button',{className:'finance-refresh',disabled:s.busy||!s.dayId,onClick:()=>this.load({preventDefault(){}})},'↻ Refresh'),
      s.busy && h('p',{role:'status'},'Loading turnover…'),s.error && h('p',{role:'alert',className:'finance-error'},s.error),
      s.data && h(React.Fragment,null,
        h('div',{className:'finance-overview'},h('div',{className:'finance-total'},h('span',null,'Total turnover'),h('strong',null,amount(total)),h('small',null,'Amounts in minor units')),h('div',{className:'finance-breakdown'},s.data.groups.length?s.data.groups.map(g=>h('div',{key:g.account+g.method},h('span',null,'Account '+g.account+' · '+g.method),h('strong',null,amount(g.total)),h('small',null,g.count+' '+(g.count===1?'payment':'payments')))):h('p',null,'No payments in this selection.'))),
        h('section',{className:'finance-transactions'},h('div',{className:'finance-section-title'},h('div',null,h('h3',null,'Payments'),h('p',null,'Select the three dots to see the bill and payment details.')),h('span',null,s.data.records.length+' total')),
          s.data.records.length ? h('ul',{className:'finance-payment-list'},s.data.records.map((p,i,records)=>h('li',{key:p.id},multipleDates && (i===0 || date(records[i-1].paidAt)!==date(p.paidAt)) && h('div',{className:'finance-date-divider'},date(p.paidAt)),h('div',{className:'finance-payment-row'},h('div',{className:'finance-payment-main'},h('strong',null,'Table '+p.tableId),h('small',null,(p.waiter || 'Waiter unavailable')+' · '+time(p.paidAt))),h('span',{className:'finance-method'},p.method+' · '+p.account),h('strong',{className:'finance-amount'},amount(p.amount)),h('button',{type:'button',className:'finance-more','aria-label':'Details for table '+p.tableId+' payment on '+date(p.paidAt)+' at '+time(p.paidAt),'aria-expanded':s.detailId===p.id,onClick:()=>s.detailId===p.id?this.closeDetail():this.openDetail(p.id)},'⋯')),
            s.detailId===p.id && h('div',{className:'finance-inline-detail'},s.detailLoading && h('p',{role:'status'},'Loading payment detail…'),s.detailError && h('p',{role:'alert'},s.detailError),s.detail && h(React.Fragment,null,h(FinancialDetail,{data:s.detail}),h('button',{type:'button',onClick:()=>this.closeDetail()},'Close payment detail')))))) : h('p',{className:'finance-empty'},'No payments yet for this selection.')),
        s.data.corrections && s.data.corrections.length>0 && h('section',{className:'finance-corrections'},h('h3',null,'Account corrections'),h('p',null,'Corrections change the account; they do not add turnover.'),h('ul',null,s.data.corrections.map(c=>h('li',{key:c.id},'B → A · '+amount(c.amount)+' · '+new Date(c.occurredAt).toLocaleString()+' · Payment #'+c.paymentId+' · Actor #'+c.actorId+' · '+(c.reason || 'No reason provided')))))),
      h('p',{className:'finance-footnote'},'Provisional, non-fiscal report. Older payments imported before system days were introduced share one period; their original day boundaries are unavailable.'));
  }
}
