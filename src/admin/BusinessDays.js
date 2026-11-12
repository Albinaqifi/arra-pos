const h=React.createElement;
const date=value=>new Date(value).toLocaleString();
function Issues({issues}) {
  return h('div',{className:'finance-issues'},h('div',null,h('strong',null,'Open orders ('+issues.orders.length+')'),h('p',null,issues.orders.map(o=>'#'+o.id+' · table '+o.tableId).join(', ') || 'None')),h('div',null,h('strong',null,'Unsuccessful or uncertain print jobs ('+issues.printJobs.length+')'),h('p',null,issues.printJobs.map(j=>'#'+j.id+' · '+j.result).join(', ') || 'None')));
}
export class BusinessDays extends React.Component {
  constructor(props) { super(props); this.state={data:null,error:'',loading:true,busy:false,confirmId:null,preview:null,success:''}; this.sequence=0; }
  componentDidMount() { this.load(); }
  componentWillUnmount() { this.sequence++; }
  async load() {
    const sequence=++this.sequence; this.setState({loading:true,error:'',confirmId:null});
    try { const r=await window.arra.businessDays({action:'list'}); if(sequence!==this.sequence) return; this.setState(r.ok?{data:r.data,error:'',loading:false}:{data:null,loading:false,error:'Business days are unavailable. Closing requires a combined account with permission, signed in under its own name.'}); }
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
      this.setState({busy:false,data:day.data,preview:report.data,confirmId:id});
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
  render() {
    const s=this.state;
    return h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},'BUSINESS DAY'),h('h2',null,'Business day close'),h('p',{className:'history-muted'},'Manual sample periods; day boundaries are provisional. Closing records outstanding issues and opens a new day.'),s.loading && h('p',{role:'status'},'Loading business days…'),s.error && h('p',{role:'alert'},s.error),s.success && h('p',{role:'status',className:'floor-success'},s.success),!s.loading && !s.data && h('button',{onClick:()=>this.refresh()},'Retry business days'),s.data && !s.loading && h(React.Fragment,null,
      h('h3',null,'Outstanding now'),h('p',{className:'history-muted'},'These issues remain open after closing. Refresh to see the latest state; the close records the issues present at that moment.'),h(Issues,{issues:s.data.issues}),
      s.data.days.map(day=>h('div',{className:'finance-day',key:day.id},h('div',{className:'history-section-head'},h('h3',null,'Period #'+day.id),h('span',{className:'history-badge'},day.closedAt===null?'Open':'Closed')),h('p',{className:'history-muted'},'Opened '+date(day.openedAt)+(day.closedAt===null?'':' · Closed '+date(day.closedAt)+' · Actor #'+day.closedBy)),day.closedAt===null ? (s.confirmId===day.id ? h('div',{className:'finance-confirm',role:'group','aria-label':'Confirm business day close'},h('strong',null,'Close period #'+day.id+'?'),h('h4',null,'Turnover at review'),s.preview && s.preview.groups.length ? h('ul',null,s.preview.groups.map(g=>h('li',{key:g.account+g.method},g.account+' · '+g.method+' · '+g.count+' payments · '+g.total))) : h('p',null,'No payments in this day.'),h('p',null,'Turnover and outstanding issues may change before closing. Outstanding orders and print issues remain open. Transfer-manager corrections for payments in this day will no longer be allowed. A new day opens.'),h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close(day.id)},s.busy?'Closing…':'Confirm close'),h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:null})},'Cancel'))) : h('button',{disabled:s.busy,onClick:()=>this.review(day.id)},'Review close')) : h(React.Fragment,null,h('h4',null,'Issues recorded at close'),h(Issues,{issues:day.issues})))),h('button',{disabled:s.busy,onClick:()=>this.refresh()},'Refresh business days')));
  }
}
