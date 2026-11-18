import { financeText } from './finance-i18n.js';

const h=React.createElement;
// A close can outlive this screen. Track its target and settlement, scoped to its actor.
const uncertain=new Map(), printRequests=new Map();
const identity=data=>String(data.actorId)+':'+String(data.scope);
const time=(value,language)=>new Date(value).toLocaleString(language==='sq'?'sq-AL':undefined);
const money=value=>Number(value).toLocaleString()+' MKD';

function Summary({shift,language}) {
  const t=(key,values)=>financeText(language,key,values);
  return h(React.Fragment,null,
    h('p',{className:'history-muted'},t('Opened {date}',{date:time(shift.openedAt,language)})),
    shift.closedAt!==null && h('p',{className:'history-muted'},t('Closed {date}',{date:time(shift.closedAt,language)})),
    h('div',{className:'finance-metrics'},
      h('div',null,h('span',null,t('Paid bills')),h('strong',null,shift.count)),
      h('div',null,h('span',null,t('Total')),h('strong',null,money(shift.total))),
      h('div',null,h('span',null,t('Cash')),h('strong',null,money(shift.cash))),
      h('div',null,h('span',null,t('Card')),h('strong',null,money(shift.card)))));
}

export class ShiftClose extends React.Component {
  constructor(props) { super(props); this.state={loading:true,busy:false,error:'',data:null,day:null,confirm:false,completed:null,unknownId:null,selectedId:null}; this.sequence=0; this.inFlight=false; }
  componentDidMount() { this.mounted=true; this.load(); }
  componentWillUnmount() { this.mounted=false; this.sequence++; }
  async fetch() {
    const [day,shifts]=await Promise.all([window.arra.businessDays({action:'list'}),window.arra.businessDays({action:'shiftList'})]);
    if(!day.ok || !shifts.ok || !day.data || !shifts.data || !day.data.days.some(d=>d.id===shifts.data.dayId && d.closedAt===null)) throw Error('Unavailable');
    return {day:day.data,data:shifts.data};
  }
  async load() {
    const sequence=++this.sequence;
    this.setState({loading:true,error:'',confirm:false});
    try {
      const {day,data}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      this.setState({day,data,loading:false,unknownId:uncertain.get(identity(day))?.id || null});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({loading:false,day:null,data:null,error:'Could not load this shift. Try again.'}); }
  }
  active(data=this.state.data) { return data?.shifts.find(s=>s.dayId===data.dayId && s.closedAt===null && s.reportable) || null; }
  async review() {
    if(this.inFlight || this.state.unknownId) return;
    const target=this.active(); if(!target) return;
    this.inFlight=true; const sequence=++this.sequence;
    this.setState({busy:true,error:''});
    try {
      const {day,data}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      if(identity(day)!==identity(this.state.day) || this.active(data)?.id!==target.id) return this.setState({busy:false,day,data,confirm:false,error:'This shift changed. Review the current shift again.'});
      this.setState({busy:false,day,data,confirm:true});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,error:'Could not review this shift. Try again.'}); }
    finally { this.inFlight=false; }
  }
  async close() {
    const shift=this.active();
    if(this.inFlight || this.state.unknownId || !this.state.confirm || !shift) return;
    this.inFlight=true; const sequence=++this.sequence, key=identity(this.state.day);
    const request={id:shift.id,pending:true}; uncertain.set(key,request);
    this.setState({busy:true,error:''});
    try {
      const r=await window.arra.businessDays({action:'shiftClose',shiftId:shift.id});
      if(!this.mounted || sequence!==this.sequence) return;
      if(!r.ok || r.data?.shift?.id!==shift.id || r.data.shift.closedAt===null) return this.setState({busy:false,confirm:false,unknownId:shift.id,error:'The close result is unknown. Check this shift before another action.'});
      if(uncertain.get(key)===request) uncertain.delete(key);
      this.setState({busy:false,confirm:false,unknownId:null,completed:r.data.shift});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,confirm:false,unknownId:shift.id,error:'The close result is unknown. Check this shift before another action.'}); }
    finally { request.pending=false; this.inFlight=false; }
  }
  async check() {
    const id=this.state.unknownId; if(!id || this.inFlight) return;
    this.inFlight=true; const sequence=++this.sequence, key=identity(this.state.day), request=uncertain.get(key), wasPending=request?.pending;
    this.setState({busy:true,error:''});
    try {
      const {day,data}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      if(identity(day)!==key) return this.setState({busy:false,error:'Could not check this shift. Try again.'});
      const shift=data.shifts.find(s=>s.id===id);
      if(!shift) return this.setState({busy:false,error:'Could not find this shift. Check again before closing.'});
      if(shift.closedAt!==null) { if(uncertain.get(key)===request) uncertain.delete(key); return this.setState({busy:false,unknownId:null,day,data,completed:shift}); }
      if(this.active(data)?.id===id && wasPending) return this.setState({busy:false,day,data,error:'The close request is still settling. Check this shift again.'});
      if(this.active(data)?.id===id) { if(uncertain.get(key)===request) uncertain.delete(key); return this.setState({busy:false,unknownId:null,day,data,error:'The shift is still open. You can review it again.'}); }
      this.setState({busy:false,error:'Could not find this shift. Check again before closing.'});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,error:'Could not check this shift. Try again.'}); }
    finally { this.inFlight=false; }
  }
  printKey(id) { return identity(this.state.day)+':'+id; }
  async refreshPrint(id) {
    if(this.inFlight || !this.state.day) return;
    this.inFlight=true; const sequence=++this.sequence, key=this.printKey(id), request=printRequests.get(key); let settled=false;
    this.setState({busy:true,error:''});
    try {
      if(request?.pending) return this.setState({busy:false,error:'The report is still being sent. Please wait.'});
      if(request) {
        const r=await window.arra.businessDays({action:'shiftPrintStatus',shiftId:id,requestId:request.id});
        if(!this.mounted || sequence!==this.sequence) return;
        if(!r.ok || typeof r.data?.found!=='boolean' || (r.data.found && !['pending','accepted','failed','uncertain'].includes(r.data.result))) return this.setState({busy:false,error:'Could not check the previous print attempt. Refresh and check the printer before trying again.'});
        if(r.data.found && r.data.result!=='pending') settled=true;
        if(!r.data.found) {
          if(!window.confirm(financeText(this.props.language,'Check the printer and paper before printing. A retry may print a duplicate. Continue?'))) return this.setState({busy:false});
          const replay=await window.arra.businessDays({action:'shiftPrint',shiftId:id,requestId:request.id,checked:true});
          if(!this.mounted || sequence!==this.sequence) return;
          if(!replay.ok) return this.setState({busy:false,error:'Print result unknown. Check the printer and refresh before trying again.'});
          settled=true;
        }
      }
      const {day,data}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      if(identity(day)!==identity(this.state.day)) return this.setState({busy:false,error:'Could not check the previous print attempt. Refresh and check the printer before trying again.'});
      if(settled && printRequests.get(key)===request) printRequests.delete(key);
      this.setState({busy:false,day,data});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,error:'Could not check the previous print attempt. Refresh and check the printer before trying again.'}); }
    finally { this.inFlight=false; }
  }
  async print(id) {
    if(this.inFlight || !this.state.day) return;
    const key=this.printKey(id), previous=printRequests.get(key);
    if(previous) return this.refreshPrint(id);
    const shift=this.state.data?.shifts.find(item=>item.id===id);
    if(shift?.reportSending || shift?.printResult==='pending') return;
    if(!window.confirm(financeText(this.props.language,'Check the printer and paper before printing. A retry may print a duplicate. Continue?'))) return;
    const request={id:crypto.randomUUID(),pending:true}; printRequests.set(key,request);
    this.inFlight=true; const sequence=++this.sequence;
    this.setState({busy:true,error:''});
    try {
      const r=await window.arra.businessDays({action:'shiftPrint',shiftId:id,requestId:request.id,checked:true});
      if(!this.mounted || sequence!==this.sequence) return;
      if(!r.ok) return this.setState({busy:false,error:'Print result unknown. Check the printer and refresh before trying again.'});
      const {day,data}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      if(identity(day)!==identity(this.state.day)) return this.setState({busy:false,error:'Print result unknown. Check the printer and refresh before trying again.'});
      if(printRequests.get(key)===request) printRequests.delete(key);
      this.setState({busy:false,day,data});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,error:'Print result unknown. Check the printer and refresh before trying again.'}); }
    finally { request.pending=false; this.inFlight=false; }
  }
  report(shift,done=false) {
    const t=(key,values)=>financeText(this.props.language,key,values), request=printRequests.get(this.printKey(shift.id));
    const status=request?.pending || shift.reportSending || shift.printResult==='pending' ? 'pending' : request ? 'uncertain' : shift.printResult;
    return h(React.Fragment,null,
      h('p',{className:'history-muted'},t('Business day #{id}',{id:shift.dayId})),
      h('p',null,t('Non-fiscal shift report. Amounts as recorded at close.')),
      h(Summary,{shift,language:this.props.language}),
      status==='pending' ? h('p',{role:'status'},t('Sending the report to the printer…')) : status==='accepted' ? h('p',{role:'status'},t('Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.')) : status==='failed' ? h('p',{role:'alert'},t('Printing failed. Check the printer before retrying.')) : status==='uncertain' ? h('p',{role:'status'},t('Print result is uncertain. Check the printer and paper before retrying.')) : null,
      h('div',{className:'floor-actions'},done && h('button',{className:'floor-primary',disabled:this.state.busy,onClick:this.props.onDone},t('Done')),
        status==='pending' || request ? h('button',{disabled:this.state.busy,onClick:()=>this.refreshPrint(shift.id)},t('Check print status')) : h('button',{disabled:this.state.busy,onClick:()=>this.print(shift.id)},t(status==='failed' || status==='uncertain' ? 'Print again after checking printer' : 'Print shift report'))));
  }
  render() {
    const s=this.state,t=(key,values)=>financeText(this.props.language,key,values),shift=this.active(),saved=s.data?.shifts.filter(item=>item.closedAt!==null) || [],selected=saved.find(item=>item.id===s.selectedId),completed=saved.find(item=>item.id===s.completed?.id) || s.completed;
    return h('section',{className:'history-panel'},
      s.loading ? h('p',{role:'status'},t('Loading shift…')) : null,
      s.error && h('p',{role:'alert'},t(s.error)),
      !s.loading && !s.data && h('button',{onClick:()=>this.load()},t('Try again')),
      !s.loading && s.unknownId && h('div',null,h('p',null,t('Check the result for shift #{id}.',{id:s.unknownId})),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.check()},t('Check shift status'))),
      !s.loading && !s.unknownId && s.completed && h(React.Fragment,null,h('h2',null,t('Shift closed')),this.report(completed,true)),
      !s.loading && !s.unknownId && !s.completed && selected && h(React.Fragment,null,h('h2',null,t('Saved shift report')),this.report(selected),h('button',{disabled:s.busy,onClick:()=>this.setState({selectedId:null})},t('Back to shifts'))),
      !s.loading && !s.unknownId && !s.completed && !selected && s.data && (shift ? h(React.Fragment,null,
        h('h2',null,t(s.confirm?'Confirm shift close':'Current shift')),
        h(Summary,{shift,language:this.props.language}),
        s.day?.issues?.orders?.length>0 && h('p',null,t('Open orders carry over. Payments recorded after closing count in the next shift.')),
        s.confirm ? h(React.Fragment,null,h('p',null,t('Close the shift opened {date}? The next shift starts automatically. The business day stays open.',{date:time(shift.openedAt,this.props.language)})),h('p',null,t('Totals may change before confirmation. The saved totals use the state at closing.')),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close()},t(s.busy?'Closing…':'Confirm close')),h('button',{disabled:s.busy,onClick:()=>this.setState({confirm:false})},t('Cancel'))) : h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.review()},t('Review and close shift')))
        : h('p',null,t(s.data.coverage==='unavailable'?'Shift tracking starts with the next business day. You can continue service and close this day normally.':'A shift becomes available after service activity. There is no shift to close yet.'))),
      !s.loading && !s.unknownId && !s.completed && !selected && s.data && !s.confirm && h('details',{className:'day-details'},h('summary',null,t('Previous shifts ({count})',{count:saved.length})),saved.length ? h('ul',{className:'shift-history'},saved.map(item=>h('li',{key:item.id},h('button',{disabled:s.busy,onClick:()=>this.setState({selectedId:item.id})},t('Day #{id} · {opened} – {closed}',{id:item.dayId,opened:time(item.openedAt,this.props.language),closed:time(item.closedAt,this.props.language)}))))) : h('p',{className:'history-muted'},t('No previous shifts.'))));
  }
}
