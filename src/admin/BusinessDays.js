const h=React.createElement;
const date=value=>new Date(value).toLocaleString();
function Issues({issues}) {
  return h('div',{className:'finance-issues'},h('div',null,h('strong',null,'Open orders ('+issues.orders.length+')'),h('p',null,issues.orders.map(o=>'#'+o.id+' · table '+o.tableId).join(', ') || 'None')),h('div',null,h('strong',null,'Unsuccessful or uncertain print jobs ('+issues.printJobs.length+')'),h('p',null,issues.printJobs.map(j=>'#'+j.id+' · '+j.result).join(', ') || 'None')));
}
export class BusinessDays extends React.Component {
  constructor(props) { super(props); this.state={data:null,turnover:null,error:'',loading:true,busy:false,confirmId:null,preview:null,success:''}; this.sequence=0; this.retryTokens={}; }
  componentDidMount() { this.load(); }
  componentWillUnmount() { this.sequence++; }
  async load() {
    const sequence=++this.sequence; this.setState({loading:true,error:'',confirmId:null});
    try {
      const r=await window.arra.businessDays({action:'list'}); if(sequence!==this.sequence) return;
      if(!r.ok) return this.setState({data:null,turnover:null,loading:false,error:'Business days are unavailable. Closing requires an authorized owner signed in under its own name.'});
      const open=r.data.days.find(d=>d.closedAt===null);
      let turnover=null;
      if(open) {
        try { const report=await window.arra.financialVisibility({action:'report',from:null,to:null,dayId:open.id,account:null,method:null}); if(report.ok) turnover=report.data; } catch (_) { /* Show unavailable, never a misleading zero. */ }
      }
      if(sequence!==this.sequence) return;
      this.setState({data:r.data,turnover,error:'',loading:false});
    }
    catch (_) { if(sequence===this.sequence) this.setState({data:null,loading:false,error:'Could not load business days. Try again.'}); }
  }
  async refresh() {
    await this.load();
    if(this.props.onDaysChanged) this.props.onDaysChanged();
  }
  async review(id) {
    this.setState({busy:true,error:'',confirmId:null,preview:null,success:''});
    try {
      const [day, report] = await Promise.all([
        window.arra.businessDays({action:'list'}),
        window.arra.financialVisibility({action:'report',from:null,to:null,dayId:id,account:null,method:null})
      ]);
      if (!day.ok || !report.ok || !day.data.days.some(d=>d.id===id && d.closedAt===null))
        return this.setState({busy:false,error:'Could not prepare the close. Refresh and try again.'});
      this.setState({busy:false,data:day.data,turnover:report.data,preview:report.data,confirmId:id});
    } catch (_) { this.setState({busy:false,error:'Could not prepare the close. Refresh and try again.'}); }
  }
  async close(id) {
    if(this.state.busy || this.state.confirmId!==id) return;
    this.setState({busy:true,error:'',success:''});
    try {
      const r=await window.arra.businessDays({action:'close',dayId:id});
      if(!r.ok) { this.setState({busy:false,confirmId:null,error:'Could not close this day. Refresh and check its status before trying again.'}); return; }
      this.setState({busy:false,confirmId:null,success:'Business day #'+id+' closed. A new day is open.'});
      await this.load(); if(this.props.onDaysChanged) this.props.onDaysChanged();
    } catch (_) { this.setState({busy:false,confirmId:null,error:'The close result is unavailable. Refresh and check the day before trying again.'}); }
  }
  async retry(id, scope) {
    if (this.state.busy || !window.confirm('Have you checked the printer and paper? Retrying may print a duplicate.')) return;
    const key=id+':'+(scope || 'own');
    const requestId=this.retryTokens[key] || (this.retryTokens[key]=crypto.randomUUID());
    this.setState({busy:true,error:'',success:''});
    try {
      const r=await window.arra.businessDays({action:'retry',dayId:id,requestId,checked:true,...(scope ? {scope} : {})});
      if (!r.ok) { this.setState({busy:false,error:'Print retry unavailable. Check the printer and refresh before trying again.'}); return; }
      delete this.retryTokens[key];
      this.setState({busy:false,success:'Report print attempt started. Refresh for its status.'});
      await this.load();
    } catch (_) { this.setState({busy:false,error:'Print retry result unknown. Check the printer and refresh before trying again.'}); }
  }
  async configure(queue) {
    if (this.state.busy) return;
    this.setState({busy:true,error:'',success:''});
    try {
      const r=await window.arra.businessDays({action:'configure',queue:queue.trim()});
      if (!r.ok) { this.setState({busy:false,error:'Printer queue could not be saved.'}); return; }
      this.setState({busy:false,success:'Printer queue saved.'});
      await this.load();
    } catch (_) { this.setState({busy:false,error:'Printer queue could not be saved.'}); }
  }
  render() {
    const s=this.state, open=s.data && s.data.days.find(day=>day.closedAt===null);
    const closed=s.data ? s.data.days.filter(day=>day.closedAt!==null) : [];
    const latest=closed[0], unresolved=closed.filter(day=>day.reportId && ((day.printAttempts && day.printResult!=='accepted') || (day.otherPrints || []).some(x=>x.printResult!=='accepted')));
    const total=report=>report.groups.reduce((sum,g)=>sum+BigInt(g.total),0n).toLocaleString();
    const printMessage=(result,attempts)=>!attempts ? h('p',null,'No report has been printed for your scope.') : result==='accepted' ? h('p',null,'Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.') : h('p',{className:result==='failed'?'day-print-error':'day-print-warning',role:result==='failed'?'alert':'status'},h('span',{'aria-hidden':'true',className:'day-print-icon'},'⚠'),result==='failed' ? 'Printing failed. Check the printer before retrying.' : 'Print result is uncertain or still in progress. Refresh after the printer finishes and check the paper before retrying.');
    const printStatus=day=>!day.reportId ? h('p',null,'No report was created for this earlier day.') : h(React.Fragment,null,
      printMessage(day.printResult,day.printAttempts),
      h('button',{disabled:s.busy,onClick:()=>this.retry(day.id)},day.printAttempts ? 'Retry report after checking printer' : 'Print report after checking printer'),
      (day.otherPrints || []).map(item=>h('div',{key:item.scope},h('strong',null,'Account '+item.scope+' report'),printMessage(item.printResult,item.printAttempts),h('button',{disabled:s.busy,onClick:()=>this.retry(day.id,item.scope)},'Retry account '+item.scope+' report after checking printer'))));
    return h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},'BUSINESS DAY'),h('h2',null,'Close current day'),
      s.loading && h('p',{role:'status'},'Loading business day…'),s.error && h('p',{role:'alert'},s.error),s.success && h('p',{role:'status',className:'floor-success'},s.success),!s.loading && !s.data && h('button',{onClick:()=>this.refresh()},'Try again'),s.data && !s.loading && h(React.Fragment,null,
        latest && latest.reportId && h('div',{className:'day-print-notice',role:'status'},h('strong',null,'Last closed day · report'),printStatus(latest)),
        unresolved.filter(day=>day!==latest).map(day=>h('div',{className:'day-print-notice',role:'status',key:day.id},h('strong',null,'Day #'+day.id+' · report needs attention'),printStatus(day))),
        open ? h('div',{className:'finance-day day-current'},h('h3',null,'Current day'),h('p',{className:'history-muted'},'Opened '+date(open.openedAt)),h('div',{className:'day-turnover'},h('span',null,'Current turnover'),h('strong',null,s.turnover ? total(s.turnover) : 'Unavailable'),h('small',null,'Amounts in minor units · non-fiscal')),h('h4',null,'Outstanding now'),h(Issues,{issues:s.data.issues}),
          s.confirmId===open.id ? h('div',{className:'finance-confirm',role:'group','aria-label':'Confirm business day close'},h('strong',null,'Close this day?'),h('h4',null,'Turnover at review'),s.preview && s.preview.groups.length ? h('ul',null,s.preview.groups.map(g=>h('li',{key:g.account+g.method},g.account+' · '+g.method+' · '+g.count+' payments · '+g.total))) : h('p',null,'No payments in this day for your permitted scope.'),h('p',null,'This closes the shared day for both owners. Turnover and outstanding issues may change before closing. Open orders and print issues remain open. Transfer-manager corrections for this day will no longer be allowed. A new day opens and your permitted non-fiscal report is sent to the configured printer.'),h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close(open.id)},s.busy?'Closing…':'Confirm close'),h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:null})},'Cancel'))) : h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.review(open.id)},'Review and close day')) : h('p',{role:'alert'},'No open system day is available.'),
        h('button',{disabled:s.busy,onClick:()=>this.refresh()},'Refresh'),
        h('details',{className:'day-details'},h('summary',null,'Previous days ('+closed.length+')'),closed.length ? closed.map(day=>h('details',{className:'finance-day',key:day.id},h('summary',null,'Day #'+day.id+' · Closed '+date(day.closedAt)),h('p',{className:'history-muted'},'Opened '+date(day.openedAt)+' · Closed by actor #'+day.closedBy),h('h4',null,'Daily turnover report'),printStatus(day),day.reportId && h('p',{className:'history-muted'},day.printAttempts+' attempt(s) · status: '+day.printResult),h('h4',null,'Issues recorded at close'),h(Issues,{issues:day.issues}))) : h('p',{className:'history-muted'},'No previous days.')),
        s.data.scope !== 'A' && s.data.scope !== 'B' && h('details',{className:'day-details'},h('summary',null,'Report printer settings'),h('p',{className:'history-muted'},'Windows queue used for the non-fiscal daily report.'),h('form',{key:s.data.queue,onSubmit:e=>{e.preventDefault();this.configure(e.currentTarget.elements.queue.value);}},h('label',null,'Printer queue ',h('input',{name:'queue',defaultValue:s.data.queue,required:true,maxLength:255})),h('button',{disabled:s.busy,type:'submit'},'Save printer queue')))));
  }
}
