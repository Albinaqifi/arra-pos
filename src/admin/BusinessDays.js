import { financeText } from './finance-i18n.js';
const h=React.createElement;
const date=value=>new Date(value).toLocaleString();
function Issues({issues,language}) {
  const t=(key,values)=>financeText(language,key,values);
  return h('div',{className:'finance-issues'},h('div',null,h('strong',null,t("Open orders (")+issues.orders.length+')'),h('p',null,(issues.orders.length && issues.orders[0].id == null ? t('Details available to Combined.') : issues.orders.map(o=>t('#{id} · table {table}',{id:o.id,table:o.tableId})).join(', ') || t("None")))),h('div',null,h('strong',null,t("Unsuccessful or uncertain print jobs (")+issues.printJobs.length+')'),h('p',null,issues.printJobs.map(j=>j.id == null ? t(j.result || 'Unavailable') : t('#{id} · {status}',{id:j.id,status:t(j.result || "Unavailable")})).join(', ') || t("None"))));
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
    this.setState({busy:true,error:'',success:'',successDay:null});
    try {
      const r=await window.arra.businessDays({action:'close',dayId:id});
      if(!r.ok) { this.setState({busy:false,confirmId:null,error:'Could not close this day. Refresh and check its status before trying again.'}); return; }
      this.setState({busy:false,confirmId:null,success:'Business day #'+id+' closed. A new day is open.',successDay:id});
      await this.load(); if(this.props.onDaysChanged) this.props.onDaysChanged();
    } catch (_) { this.setState({busy:false,confirmId:null,error:'The close result is unavailable. Refresh and check the day before trying again.'}); }
  }
  async retry(id, scope) {
    if (this.state.busy || !window.confirm(financeText(this.props.language, 'Have you checked the printer and paper? Retrying may print a duplicate.'))) return;
    const key=id+':'+(scope || 'own');
    const requestId=this.retryTokens[key] || (this.retryTokens[key]=crypto.randomUUID());
    this.setState({busy:true,error:'',success:'',successDay:null});
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
    this.setState({busy:true,error:'',success:'',successDay:null});
    try {
      const r=await window.arra.businessDays({action:'configure',queue:queue.trim()});
      if (!r.ok) { this.setState({busy:false,error:'Printer queue could not be saved.'}); return; }
      this.setState({busy:false,success:'Printer queue saved.'});
      await this.load();
    } catch (_) { this.setState({busy:false,error:'Printer queue could not be saved.'}); }
  }
  render() {
    const t=(key,values)=>financeText(this.props.language,key,values);
    const s=this.state, open=s.data && s.data.days.find(day=>day.closedAt===null);
    const closed=s.data ? s.data.days.filter(day=>day.closedAt!==null) : [];
    const latest=closed[0], unresolved=closed.filter(day=>day.reportId && ((day.printAttempts && day.printResult!=='accepted') || (day.otherPrints || []).some(x=>x.printResult!=='accepted')));
    const total=report=>report.groups.reduce((sum,g)=>sum+BigInt(g.total),0n).toLocaleString();
    const printMessage=(result,attempts)=>!attempts ? h('p',null,t("No report has been printed for your scope.")) : result==='accepted' ? h('p',null,t("Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.")) : h('p',{className:result==='failed'?'day-print-error':'day-print-warning',role:result==='failed'?'alert':'status'},h('span',{'aria-hidden':'true',className:'day-print-icon'},'⚠'),result==='failed' ? t("Printing failed. Check the printer before retrying.") : t("Print result is uncertain or still in progress. Refresh after the printer finishes and check the paper before retrying."));
    const printStatus=day=>!day.reportId ? h('p',null,t("No report was created for this earlier day.")) : h(React.Fragment,null,
      printMessage(day.printResult,day.printAttempts),
      h('button',{disabled:s.busy,onClick:()=>this.retry(day.id)},day.printAttempts ? t("Retry report after checking printer") : t("Print report after checking printer")),
      (day.otherPrints || []).map(item=>h('div',{key:item.scope},h('strong',null,t('Account {scope} report',{scope:item.scope})),printMessage(item.printResult,item.printAttempts),h('button',{disabled:s.busy,onClick:()=>this.retry(day.id,item.scope)},t('Retry account {scope} report after checking printer',{scope:item.scope})))));
    return h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},t("BUSINESS DAY")),h('h2',null,t("Close current day")),
      s.loading && h('p',{role:'status'},t("Loading business day…")),s.error && h('p',{role:'alert'},t(s.error)),s.success && h('p',{role:'status',className:'floor-success'},s.successDay ? t('Business day #{id} closed. A new day is open.',{id:s.successDay}) : t(s.success)),!s.loading && !s.data && h('button',{onClick:()=>this.refresh()},t("Try again")),s.data && !s.loading && h(React.Fragment,null,
        latest && latest.reportId && h('div',{className:'day-print-notice',role:'status'},h('strong',null,t("Last closed day · report")),printStatus(latest)),
        unresolved.filter(day=>day!==latest).map(day=>h('div',{className:'day-print-notice',role:'status',key:day.id},h('strong',null,t('Day #{id} · report needs attention',{id:day.id})),printStatus(day))),
        open ? h('div',{className:'finance-day day-current'},h('h3',null,t("Current day")),h('p',{className:'history-muted'},t("Opened ")+date(open.openedAt)),h('div',{className:'day-turnover'},h('span',null,t("Current turnover")),h('strong',null,s.turnover ? total(s.turnover) : t("Unavailable")),h('small',null,t("Amounts in minor units · non-fiscal"))),h('h4',null,t("Outstanding now")),h(Issues,{issues:s.data.issues,language:this.props.language}),
          s.confirmId===open.id ? h('div',{className:'finance-confirm',role:'group','aria-label':t("Confirm business day close")},h('strong',null,t("Close this day?")),h('h4',null,t("Turnover at review")),s.preview && s.preview.groups.length ? h('ul',null,s.preview.groups.map(g=>h('li',{key:g.account+g.method},t('{account} · {method} · {count} payments · {total}',{account:g.account,method:t(g.method),count:g.count,total:g.total})))) : h('p',null,t("No payments in this day for your permitted scope.")),h('p',null,t("This closes the shared day for both owners. Turnover and outstanding issues may change before closing. Open orders and print issues remain open. Transfer-manager corrections for this day will no longer be allowed. A new day opens and your permitted non-fiscal report is sent to the configured printer.")),h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close(open.id)},s.busy?t("Closing…"):t("Confirm close")),h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:null})},t("Cancel")))) : h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.review(open.id)},t("Review and close day"))) : h('p',{role:'alert'},t("No open system day is available.")),
        h('button',{disabled:s.busy,onClick:()=>this.refresh()},t("Refresh")),
        h('details',{className:'day-details'},h('summary',null,t('Previous days ({count})',{count:closed.length})),closed.length ? closed.map(day=>h('details',{className:'finance-day',key:day.id},h('summary',null,t('Day #{id} · Closed {date}',{id:day.id,date:date(day.closedAt)})),h('p',{className:'history-muted'},t('Opened {date} · Closed by actor #{actor}',{date:date(day.openedAt),actor:day.closedBy})),h('h4',null,t("Daily turnover report")),printStatus(day),day.reportId && h('p',{className:'history-muted'},t('{count} attempt(s) · status: {status}',{count:day.printAttempts,status:t(day.printResult || "Unavailable")})),h('h4',null,t("Issues recorded at close")),h(Issues,{issues:day.issues,language:this.props.language}))) : h('p',{className:'history-muted'},t("No previous days."))),
        s.data.scope !== 'A' && s.data.scope !== 'B' && h('details',{className:'day-details'},h('summary',null,t("Report printer settings")),h('p',{className:'history-muted'},t("Windows queue used for the non-fiscal daily report.")),h('form',{key:s.data.queue,onSubmit:e=>{e.preventDefault();this.configure(e.currentTarget.elements.queue.value);}},h('label',null,t("Printer queue "),h('input',{name:'queue',defaultValue:s.data.queue,required:true,maxLength:255})),h('button',{disabled:s.busy,type:'submit'},t("Save printer queue"))))));
  }
}
