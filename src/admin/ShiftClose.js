import { financeText } from './finance-i18n.js';

const h=React.createElement;
// A close can outlive this screen. Track its target and settlement, scoped to its actor.
const uncertain=new Map();
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
  constructor(props) { super(props); this.state={loading:true,busy:false,error:'',data:null,day:null,confirm:false,completed:null,unknownId:null}; this.sequence=0; this.inFlight=false; }
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
  render() {
    const s=this.state,t=(key,values)=>financeText(this.props.language,key,values),shift=this.active();
    return h('section',{className:'history-panel'},
      s.loading ? h('p',{role:'status'},t('Loading shift…')) : null,
      s.error && h('p',{role:'alert'},t(s.error)),
      !s.loading && !s.data && h('button',{onClick:()=>this.load()},t('Try again')),
      !s.loading && s.unknownId && h('div',null,h('p',null,t('Check the result for shift #{id}.',{id:s.unknownId})),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.check()},t('Check shift status'))),
      !s.loading && !s.unknownId && s.completed && h(React.Fragment,null,h('h2',null,t('Shift closed')),h(Summary,{shift:s.completed,language:this.props.language}),h('button',{className:'floor-primary',onClick:this.props.onDone},t('Done'))),
      !s.loading && !s.unknownId && !s.completed && s.data && (shift ? h(React.Fragment,null,
        h('h2',null,t(s.confirm?'Confirm shift close':'Current shift')),
        h(Summary,{shift,language:this.props.language}),
        s.day?.issues?.orders?.length>0 && h('p',null,t('Open orders carry over. Payments recorded after closing count in the next shift.')),
        s.confirm ? h(React.Fragment,null,h('p',null,t('Close the shift opened {date}? The next shift starts automatically. The business day stays open.',{date:time(shift.openedAt,this.props.language)})),h('p',null,t('Totals may change before confirmation. The saved totals use the state at closing.')),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close()},t(s.busy?'Closing…':'Confirm close')),h('button',{disabled:s.busy,onClick:()=>this.setState({confirm:false})},t('Cancel'))) : h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.review()},t('Review and close shift')))
        : h('p',null,t(s.data.coverage==='unavailable'?'Shift tracking starts with the next business day. You can continue service and close this day normally.':'A shift becomes available after service activity. There is no shift to close yet.'))));
  }
}
