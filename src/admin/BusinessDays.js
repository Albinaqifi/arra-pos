import { financeText } from './finance-i18n.js';
const h=React.createElement;
const date=value=>new Date(value).toLocaleString();
// Unacknowledged operations survive navigation but never cross authenticated actors.
const retryTokens=new Map(), uncertainCloses=new Map();
const identityKey=data=>String(data?.actorId ?? 'unknown')+':'+String(data?.scope ?? 'unknown');
function shiftCloseEffect(response,dayId) {
  if(!response?.ok || response.data?.dayId!==dayId || !Array.isArray(response.data.shifts)) return null;
  const shifts=response.data.shifts.filter(shift=>shift.dayId===dayId);
  return shifts.some(shift=>shift.closedAt!==null) && shifts.some(shift=>shift.closedAt===null && shift.reportable);
}
function issueText(j,t) {
  const label=j.id==null ? t(j.result || 'Unavailable') : (j.kind==='cancellation'?t('Cancellation notice'):j.kind==='preparation'?t('Preparation ticket'):t('Simulated ticket'))+' '+t('#{id} · {status}',{id:j.id,status:t(j.result || 'Unavailable')});
  return label+(j.retryBlocked?' · '+t('Do not retry: ticket contains a cancellation. Tell preparation staff in person.'):(j.kind==='cancellation' || j.cancellationNotice)?' · '+t('Tell preparation staff in person.'):'');
}
function Issues({issues,language}) {
  const t=(key,values)=>financeText(language,key,values);
  if (!issues) return h('p',null,t('Recorded issues are unavailable.'));
  return h('div',{className:'finance-issues'},h('div',null,h('strong',null,t("Open orders (")+issues.orders.length+')'),h('p',null,(issues.orders.length && issues.orders[0].id == null ? t('Details available to Combined.') : issues.orders.map(o=>t('#{id} · table {table}',{id:o.id,table:o.tableId})).join(', ') || t("None")))),h('div',null,h('strong',null,t("Unsuccessful or uncertain print jobs (")+issues.printJobs.length+')'),h('p',null,issues.printJobs.map(j=>issueText(j,t)).join(', ') || t("None"))));
}
function ReviewIssues({issues,language,canReviewOrders,onReviewOrders,canReviewCancellationNotices,onReviewCancellationNotices}) {
  const t=(key,values)=>financeText(language,key,values);
  if (!issues) return h('p',{role:'status'},t('Outstanding work is unavailable. Refresh before reviewing.'));
  const orders=issues.orders || [], jobs=issues.printJobs || [];
  return h('div',{className:'day-review-issues'},
    orders.length ? h('section',{className:'day-issue'},h('h4',null,t('Open orders ({count})',{count:orders.length})),
      h('p',null,orders[0].id==null ? t('Order details are available to Combined.') : orders.map(o=>t('#{id} · table {table}',{id:o.id,table:o.tableId})).join(', ')),
      h('p',null,t('These orders stay open. Payments recorded after closing belong to the new day.')),
      canReviewOrders && onReviewOrders && h('button',{onClick:onReviewOrders},t('Review orders'))) : h('p',null,t('No open orders.')),
    jobs.length ? h('section',{className:'day-issue'},h('h4',null,t('Preparation print problems ({count})',{count:jobs.length})),
      h('p',null,jobs.map(j=>issueText(j,t)).join(', ')),
      h('p',null,t('Ask a waiter to check the preparation printer and print jobs.')),
      canReviewCancellationNotices && jobs.some(j=>j.kind==='cancellation') && onReviewCancellationNotices && h('button',{onClick:onReviewCancellationNotices},t('Review cancellation notices'))) : h('p',null,t('No preparation print problems.')));
}
export class BusinessDays extends React.Component {
  constructor(props) { super(props); this.state={data:null,turnover:null,error:'',loading:true,busy:false,confirmId:null,preview:null,success:''}; this.sequence=0; }
  componentDidMount() { this.mounted=true; this.load().then(()=>this.pollReports()); }
  componentWillUnmount() { this.mounted=false; clearTimeout(this.pollTimer); this.sequence++; this.pollGeneration++; }
  pollReports() {
    clearTimeout(this.pollTimer);
    const generation=this.pollGeneration=(this.pollGeneration || 0)+1;
    const tick=remaining=>{
      if (!this.mounted || generation!==this.pollGeneration || remaining<=0) return;
      this.pollTimer=setTimeout(async()=>{
        if (!this.mounted || generation!==this.pollGeneration) return;
        if (!this.state.busy) {
          const sequence=this.sequence;
          try {
            const r=await window.arra.businessDays({action:'list'});
            if (!this.mounted || generation!==this.pollGeneration) return;
            if (sequence===this.sequence && r.ok && !this.state.busy) {
              const oldOpen=this.state.data?.days.find(day=>day.closedAt===null)?.id;
              const newOpen=r.data.days.find(day=>day.closedAt===null)?.id;
              if (oldOpen!==newOpen) await this.load();
              else this.setState({data:r.data});
            }
          } catch (_) { /* Keep the last known status; manual refresh remains available. */ }
        }
        tick(remaining-1);
      },2000);
    };
    tick(30);
  }
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
      this.setState({data:r.data,turnover,error:'',loading:false,unknownId:uncertainCloses.get(identityKey(r.data)) || null});
      return r.data;
    }
    catch (_) { if(sequence===this.sequence) this.setState({data:null,loading:false,error:'Could not load business days. Try again.'}); }
  }
  async refresh() {
    await this.load();
    if(this.props.onDaysChanged) this.props.onDaysChanged();
  }
  async review(id) {
    if(this.state.busy || this.state.unknownId) return;
    const sequence=++this.sequence;
    this.setState({busy:true,error:'',confirmId:null,preview:null,success:'',finishesShift:false});
    try {
      const [day, report, shifts] = await Promise.all([
        window.arra.businessDays({action:'list'}),
        window.arra.financialVisibility({action:'report',from:null,to:null,dayId:id,account:null,method:null}),
        Promise.resolve().then(()=>window.arra.businessDays({action:'shiftList'})).catch(()=>null)
      ]);
      if(sequence!==this.sequence) return;
      if (!day.ok || !report.ok || !day.data.days.some(d=>d.id===id && d.closedAt===null))
        return this.setState({busy:false,error:'Could not prepare the close. Refresh and try again.'});
      const finishesShift=shiftCloseEffect(shifts,id);
      this.setState({busy:false,data:day.data,turnover:report.data,preview:report.data,confirmId:id,finishesShift});
    } catch (_) { if(sequence===this.sequence) this.setState({busy:false,error:'Could not prepare the close. Refresh and try again.'}); }
  }
  async close(id) {
    if(this.closeInFlight || this.state.busy || this.state.unknownId || this.state.confirmId!==id) return;
    this.closeInFlight=true;
    const sequence=++this.sequence;
    const ownerKey=identityKey(this.state.data);
    this.setState({busy:true,error:'',success:'',successDay:null,lastRetry:null});
    try {
      const shifts=await Promise.resolve().then(()=>window.arra.businessDays({action:'shiftList'})).catch(()=>null);
      if(sequence!==this.sequence) return;
      const finishesShift=shiftCloseEffect(shifts,id);
      if(finishesShift!==this.state.finishesShift) return this.setState({busy:false,finishesShift,error:'Shift status changed. Review this confirmation again.'});
      uncertainCloses.set(ownerKey,id);
      const r=await window.arra.businessDays({action:'close',dayId:id});
      if(sequence!==this.sequence) return;
      if(!r.ok) { this.setState({busy:false,confirmId:null,unknownId:id,error:'The close result is unavailable. Check the day before trying again.'}); return; }
      uncertainCloses.delete(ownerKey);
      this.setState({busy:false,confirmId:null,completedId:id,unknownId:null,success:'',successDay:null});
      const reloadSequence=this.sequence+1;
      await this.load();
      if(reloadSequence!==this.sequence) return;
      this.pollReports(); if(this.props.onDaysChanged) this.props.onDaysChanged();
    } catch (_) { if(sequence===this.sequence) this.setState({busy:false,confirmId:null,unknownId:id,error:'The close result is unavailable. Check the day before trying again.'}); }
    finally { this.closeInFlight=false; }
  }
  async checkClose() {
    const id=this.state.unknownId;
    if(!id || this.state.busy) return;
    const sequence=this.sequence+1;
    const data=await this.load();
    if(sequence!==this.sequence) return;
    if(!data) return;
    const day=data.days.find(item=>item.id===id);
    if(day && day.closedAt!==null) { uncertainCloses.delete(identityKey(data)); this.setState({unknownId:null,completedId:id,error:''}); }
    else if(day) { uncertainCloses.delete(identityKey(data)); this.setState({unknownId:null,error:'The day is still open. You can review it again.'}); }
    else this.setState({error:'Could not find that day. Check again before closing.'});
    this.pollReports();
  }
  async retry(id, scope, checked=false) {
    if (this.state.busy || (!checked && !window.confirm(financeText(this.props.language, 'Have you checked the printer and paper? Retrying may print a duplicate.')))) return;
    const sequence=++this.sequence;
    const key=identityKey(this.state.data)+':'+id+':'+(scope || 'own');
    let requestId=retryTokens.get(key);
    this.setState({busy:true,error:'',success:'',successDay:null});
    try {
      if(requestId) {
        const status=await window.arra.businessDays({action:'retryStatus',dayId:id,requestId,...(scope ? {scope} : {})});
        if(sequence!==this.sequence) return;
        if(!status.ok || typeof status.data?.found!=='boolean' || (status.data.found && !['pending','accepted','failed','uncertain'].includes(status.data.result))) { this.setState({busy:false,error:'Could not check the previous print attempt. Refresh and check the printer before trying again.'}); return; }
        if(status.data.found && status.data.result==='pending') { this.setState({busy:false,error:'The report is still being sent. Please wait.'}); this.pollReports(); return; }
        if(status.data.found) { retryTokens.delete(key); requestId=null; }
      }
      if(!requestId) requestId=crypto.randomUUID();
      retryTokens.set(key,requestId);
      const r=await window.arra.businessDays({action:'retry',dayId:id,requestId,checked:true,...(scope ? {scope} : {})});
      if(sequence!==this.sequence) return;
      if (!r.ok) { this.setState({busy:false,error:'Print retry unavailable. Check the printer and refresh before trying again.'}); return; }
      retryTokens.delete(key);
      this.setState({busy:false,success:r.data?.replayed ? 'The previous print request was already received. Check the paper before printing again.' : '',lastRetry:{id,scope:scope || null}});
      await this.load(); this.pollReports();
    } catch (_) { if(sequence===this.sequence) this.setState({busy:false,error:'Print retry result unknown. Check the printer and refresh before trying again.'}); }
  }
  async configure(queue) {
    if (this.state.busy) return;
    const sequence=++this.sequence;
    this.setState({busy:true,error:'',success:'',successDay:null});
    try {
      const r=await window.arra.businessDays({action:'configure',queue:queue.trim()});
      if(sequence!==this.sequence) return;
      if (!r.ok) { this.setState({busy:false,error:'Printer queue could not be saved.'}); return; }
      this.setState({busy:false,success:'Printer queue saved.'});
      await this.load();
    } catch (_) { if(sequence===this.sequence) this.setState({busy:false,error:'Printer queue could not be saved.'}); }
  }
  render() {
    const t=(key,values)=>financeText(this.props.language,key,values);
    const s=this.state, open=s.data && s.data.days.find(day=>day.closedAt===null);
    const closed=s.data ? s.data.days.filter(day=>day.closedAt!==null) : [];
    const unresolved=closed.filter(day=>day.reportId && ((day.printAttempts && day.printResult!=='accepted') || (day.otherPrints || []).some(x=>x.printResult!=='accepted')));
    const total=report=>report.groups.reduce((sum,g)=>sum+BigInt(g.total),0n).toLocaleString();
    const printMessage=(result,attempts)=>!attempts ? h('p',null,t("No report has been printed for your scope.")) : result==='pending' ? h('p',{role:'status'},t('Sending the report to the printer…')) : result==='accepted' ? h('p',null,t("Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.")) : h('p',{className:result==='failed'?'day-print-error':'day-print-warning',role:result==='failed'?'alert':'status'},h('span',{'aria-hidden':'true',className:'day-print-icon'},'⚠'),result==='failed' ? t("Printing failed. Check the printer before retrying.") : t("Print result is uncertain or still in progress. Refresh after the printer finishes and check the paper before retrying."));
    const daySending=day=>day.reportSending || day.printResult==='pending' || (day.otherPrints || []).some(item=>item.printResult==='pending');
    const printStatus=day=>!day.reportId ? h('p',null,t("No report was created for this earlier day.")) : h(React.Fragment,null,
      h('strong',null,s.data.scope==='combined' ? t('Combined report') : t('Your report')),printMessage(day.printResult,day.printAttempts),
      h('button',{disabled:s.busy || daySending(day),onClick:()=>this.retry(day.id)},day.printAttempts ? t("Retry report after checking printer") : t("Print report after checking printer")),
      (day.otherPrints || []).map(item=>h('div',{key:item.scope},h('strong',null,t('Account {scope} report',{scope:item.scope})),printMessage(item.printResult,item.printAttempts),h('button',{disabled:s.busy || daySending(day),onClick:()=>this.retry(day.id,item.scope)},t('Retry account {scope} report after checking printer',{scope:item.scope})))));
    const pending=unresolved.flatMap(day=>[
      ...(day.printAttempts && day.printResult!=='accepted' ? [{day,scope:null,result:day.printResult}] : []),
      ...(day.otherPrints || []).filter(item=>item.printResult!=='accepted').map(item=>({day,scope:item.scope,result:item.printResult}))
    ]);
    const attentionReport=({day,scope,result})=>h('div',{className:result==='pending'?'day-report-pending':'day-recovery-report',key:day.id+':'+(scope || 'own'),role:result==='pending'?'status':'alert'},
      h('strong',null,result==='pending' ? t('Sending report for day #{id}…',{id:day.id}) : t('Report for day #{id} may not have printed',{id:day.id})),
      h('span',{className:'day-report-scope'},' · ',scope ? t('Account {scope} report',{scope}) : s.data.scope==='combined' ? t('Combined report') : t('Your report')),
      result!=='pending' && (daySending(day) ? h('p',null,t('Another report for this day is being sent. Please wait.')) : h(React.Fragment,null,h('p',null,t('Check the printer and paper. If the report is missing, try again.')),h('button',{disabled:s.busy,onClick:()=>this.retry(day.id,scope,true)},t('Print again after checking printer')))));
    const retriedDay=s.lastRetry && closed.find(day=>day.id===s.lastRetry.id);
    const retriedResult=retriedDay && (s.lastRetry.scope ? (retriedDay.otherPrints || []).find(item=>item.scope===s.lastRetry.scope)?.printResult : retriedDay.printResult);
    const completed=closed.find(day=>day.id===s.completedId);
    const completionReport=completed && (!completed.reportId ? h('p',{role:'alert'},t('The saved restaurant report is unavailable.')) : h('div',{className:'day-completion-report'},
      h('h3',null,t('Restaurant report')),printMessage(completed.printResult,completed.printAttempts),
      completed.printResult==='pending' ? null : h('button',{disabled:s.busy || daySending(completed),onClick:()=>this.retry(completed.id)},t('Print again after checking printer')),
      completed.printResult!=='accepted' && h('p',null,t('A printing problem does not undo the day close.'))));
    return h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},t("BUSINESS DAY")),h('h2',null,t("Close current day")),
      s.loading && h('p',{role:'status'},t("Loading business day…")),s.error && h('p',{role:'alert'},t(s.error)),s.success && h('p',{role:'status',className:'floor-success'},s.successDay ? t('Business day #{id} closed. A new day is open.',{id:s.successDay}) : t(s.success)),!s.loading && !s.data && h('button',{onClick:()=>this.refresh()},t("Try again")),s.data && !s.loading && h(React.Fragment,null,
        retriedResult==='accepted' && !(completed && completed.id===retriedDay.id && !s.lastRetry.scope) && h('div',{className:'day-print-notice',role:'status'},h('strong',null,t('Day #{id} · report sent',{id:retriedDay.id}),' · ',s.lastRetry.scope ? t('Account {scope} report',{scope:s.lastRetry.scope}) : s.data.scope==='combined' ? t('Combined report') : t('Your report')),h('p',null,t('Check the paper. The printer queue cannot confirm it printed.'))),
        pending.filter(item=>!completed || item.day.id!==completed.id || item.scope).map(attentionReport),
        !completed && !(retriedResult==='accepted' && retriedDay.id===closed[0]?.id && !s.lastRetry.scope) && closed[0] && closed[0].reportId && closed[0].printAttempts && closed[0].printResult==='accepted' ? h('div',{className:'day-print-notice',role:'status'},h('strong',null,t('Day #{id} · report sent',{id:closed[0].id})),h('p',null,t('Check the paper. The printer queue cannot confirm it printed.'))) : null,
        s.unknownId ? h('div',{className:'finance-day',role:'alert'},h('h3',null,t('Check day #{id}',{id:s.unknownId})),h('p',null,t('The close result is unknown. Check this day before closing another.')),h('button',{disabled:s.busy,onClick:()=>this.checkClose()},t('Check day status'))) :
        completed ? h('div',{className:'finance-day day-completion'},h('h3',null,t('Day #{id} is closed',{id:completed.id})),h('p',null,t('Closed {date}',{date:date(completed.closedAt)})),h('p',null,t('A new business day is open.')),completionReport,h('button',{onClick:()=>this.setState({completedId:null,success:'',lastRetry:null})},t('Go to current day'))) :
        open && s.confirmId===open.id ? h('div',{className:'finance-day finance-confirm',role:'group','aria-label':t('Confirm business day close')},h('h3',null,t('Close day #{id}?',{id:open.id})),
          h('p',null,t('This closes the shared day for both owners. A new day opens. Transfer-manager corrections for this day stop.')),
          s.finishesShift && h('p',null,t('Closing the day also finishes the active shift.')),
          s.finishesShift===null && h('p',null,t('Shift status is unavailable. Closing the day will finish any active shift.')),
          s.data.issues?.orders?.length>0 && h('p',null,t('Open orders ({count})',{count:s.data.issues.orders.length})+' · '+t('Open orders stay open. Payments recorded after closing belong to the new day.')),
          h('p',null,t('The permitted non-fiscal restaurant report will be sent to the configured printer.')),
          h('p',null,t('Turnover and outstanding work shown during review may change. The final report uses the state when you confirm.')),
          s.preview && s.preview.groups.length ? h('ul',null,s.preview.groups.map(g=>h('li',{key:g.account+g.method},t('{account} · {method} · {count} payments · {total}',{account:g.account,method:t(g.method),count:g.count,total:g.total})))) : h('p',null,t('No payments in this day for your permitted scope.')),
          h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close(open.id)},s.busy?t('Closing…'):t('Confirm close')),h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:null})},t('Back')))) :
        open ? h('div',{className:'finance-day day-current'},h('h3',null,t('Current day #{id}',{id:open.id})),h('p',{className:'history-muted'},t("Opened ")+date(open.openedAt)),h('div',{className:'day-turnover'},h('span',null,t("Current turnover")),h('strong',null,s.turnover ? total(s.turnover)+' MKD' : t("Unavailable")),h('small',null,t('Recorded payments · non-fiscal · review amount'))),h('h4',null,t("Outstanding now")),h(ReviewIssues,{issues:s.data.issues,language:this.props.language,canReviewOrders:s.data.canReviewOrders,onReviewOrders:this.props.onReviewOrders,canReviewCancellationNotices:s.data.canReviewCancellationNotices,onReviewCancellationNotices:this.props.onReviewCancellationNotices}),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.review(open.id)},t("Review and close day"))) : h('p',{role:'alert'},t("No open system day is available.")),
        h('details',{className:'day-details'},h('summary',null,t('More options')),h('button',{disabled:s.busy,onClick:()=>this.refresh()},t("Refresh")),
        h('details',{className:'day-details'},h('summary',null,t('Previous days ({count})',{count:closed.length})),closed.length ? closed.map(day=>h('details',{className:'finance-day',key:day.id},h('summary',null,t('Day #{id} · Closed {date}',{id:day.id,date:date(day.closedAt)})),h('p',{className:'history-muted'},t('Opened {date} · Closed by actor #{actor}',{date:date(day.openedAt),actor:day.closedBy})),h('h4',null,t("Daily turnover report")),printStatus(day),day.reportId && h('p',{className:'history-muted'},t('{count} attempt(s) · status: {status}',{count:day.printAttempts,status:t(day.printResult || "Unavailable")})),h('h4',null,t("Issues recorded at close")),h(Issues,{issues:day.issues,language:this.props.language}))) : h('p',{className:'history-muted'},t("No previous days."))),
        s.data.scope !== 'A' && s.data.scope !== 'B' && h('details',{className:'day-details'},h('summary',null,t("Report printer settings")),h('p',{className:'history-muted'},t("Windows queue used for the non-fiscal daily report.")),h('form',{key:s.data.queue,onSubmit:e=>{e.preventDefault();this.configure(e.currentTarget.elements.queue.value);}},h('label',null,t("Printer queue "),h('input',{name:'queue',defaultValue:s.data.queue,required:true,maxLength:255})),h('button',{disabled:s.busy,type:'submit'},t("Save printer queue")))))));
  }
}
