import { financeText, closeBlockMessage } from './finance-i18n.js';

const h=React.createElement;
// A close can outlive this screen. Track its target and settlement, scoped to its actor.
const uncertain=new Map(), printRequests=new Map(), walletRequests=new Map();
const identity=data=>String(data.actorId)+':'+String(data.scope);
const storageKey=key=>'arra.wallet.pending.'+key;
const time=(value,language)=>new Date(value).toLocaleString(language==='sq'?'sq-AL':undefined);
const money=value=>Number(value).toLocaleString()+' MKD';
const amount=value=>/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

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
function WalletHistory({items,language}) {
  const t=(key,values)=>financeText(language,key,values);
  if(!items?.length) return h('p',null,t('No wallet history.'));
  return items.map(item=>h('div',{className:'finance-day',key:item.shiftId},
    h('strong',null,t('Business day #{id}',{id:item.dayId})),
    h('p',null,t('Opened {date}',{date:time(item.openedAt,language)})),
    h('p',null,t('Baseline'),': ',money(item.baseline),' · ',time(item.baselineAt,language),' · ',t('Actor #{id}',{id:item.baselineActor})),
    item.counted==null ? h('p',null,t('No closing count recorded.')) : h(React.Fragment,null,
      h('p',null,t('Expected in wallet'),': ',money(item.expected)),
      h('p',null,t('Counted cash'),': ',money(item.counted)),
      h('p',null,t(item.variance===0?'Matches':item.variance<0?'Short':'Over'),': ',money(Math.abs(item.variance))),
      item.closing && h('p',null,t('Closed {date}',{date:time(item.closing.recordedAt,language)}),' · ',t('Actor #{id}',{id:item.closing.actorId})),
      item.retained!=null && h('p',null,t('Leave for next shift'),': ',money(item.retained)),
      item.taken!=null && h('p',null,t('Take out'),': ',money(item.taken))),
    item.movements.map((movement,index)=>h('p',{key:index},time(movement.recordedAt,language),' · ',t(movement.direction==='in'?'Cash in':'Cash out'),' · ',money(movement.amount),' · ',movement.reason,' · ',t('Actor #{id}',{id:movement.actorId})))));
}

export class ShiftClose extends React.Component {
  constructor(props) { super(props); this.state={loading:true,busy:false,error:'',data:null,day:null,wallet:null,confirm:false,completed:null,unknownId:null,selectedId:null,opening:'',counted:'',retained:'',movementAmount:'',movementReason:'',direction:'in'}; this.sequence=0; this.inFlight=false; }
  componentDidMount() { this.mounted=true; this.load(); }
  componentWillUnmount() { this.mounted=false; this.sequence++; }
  async fetch() {
    const [day,shifts]=await Promise.all([window.arra.businessDays({action:'list'}),window.arra.businessDays({action:'shiftList'})]);
    if(!day.ok || !shifts.ok || !day.data || !shifts.data || !day.data.days.some(d=>d.id===shifts.data.dayId && d.closedAt===null)) throw Error('Unavailable');
    let wallet=null,walletUnavailable=false;
    if(day.data.scope==='combined') { try { const result=await window.arra.businessDays({action:'walletStatus'}); if(result?.ok && result.data?.dayId===shifts.data.dayId) wallet=result.data; else walletUnavailable=true; } catch (_) { walletUnavailable=true; } }
    return {day:day.data,data:shifts.data,wallet,walletUnavailable};
  }
  async load() {
    const sequence=++this.sequence;
    this.setState({loading:true,error:'',confirm:false});
    try {
      const {day,data,wallet,walletUnavailable}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      const key=identity(day); let stored=null,walletStorageUnavailable=false;
      if(day.scope==='combined') { try { stored=window.localStorage.getItem(storageKey(key)); } catch (_) { walletStorageUnavailable=true; } }
      if(stored && !walletRequests.has(key)) walletRequests.set(key,{id:stored,pending:false});
      this.setState({day,data,wallet,walletUnavailable,walletStorageUnavailable,loading:false,unknownId:uncertain.get(key)?.id || null,walletUnknown:!!walletRequests.get(key)});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({loading:false,day:null,data:null,error:'Could not load this shift. Try again.'}); }
  }
  active(data=this.state.data) { return data?.shifts.find(s=>s.dayId===data.dayId && s.closedAt===null && s.reportable) || null; }
  async review() {
    if(this.inFlight || this.state.unknownId) return;
    const target=this.active(); if(!target) return;
    this.inFlight=true; const sequence=++this.sequence;
    this.setState({busy:true,error:''});
    try {
      const {day,data,wallet,walletUnavailable}=await this.fetch();
      if(!this.mounted || sequence!==this.sequence) return;
      if(identity(day)!==identity(this.state.day) || this.active(data)?.id!==target.id) return this.setState({busy:false,day,data,confirm:false,error:'This shift changed. Review the current shift again.'});
      this.setState({busy:false,day,data,wallet,walletUnavailable,confirm:true,counted:'',retained:wallet?.openingFloat==null?'':String(wallet.openingFloat)});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,error:'Could not review this shift. Try again.'}); }
    finally { this.inFlight=false; }
  }
  async walletAction(payload) {
    if(this.inFlight || !this.state.day) return;
    const key=identity(this.state.day), existing=walletRequests.get(key);
    if(existing?.pending) return;
    const request=existing || {id:crypto.randomUUID(),pending:false};
    if(!existing) {
      try { window.localStorage.setItem(storageKey(key),request.id); }
      catch (_) { return this.setState({walletStorageUnavailable:true,error:'Wallet recovery is unavailable. Try again before making a cash change.'}); }
      walletRequests.set(key,request);
    }
    request.pending=true;
    this.inFlight=true; const sequence=++this.sequence;
    this.setState({busy:true,error:'',walletUnknown:false});
    try {
      if(!existing) {
        const prepared=await window.arra.businessDays({action:'walletPrepare',operation:{...payload,requestId:request.id}});
        if(!prepared?.ok) throw Error('Preparation unknown');
      }
      let status=await window.arra.businessDays({action:'walletRequestStatus',requestId:request.id});
      if(!this.mounted || sequence!==this.sequence) return;
      if(!status?.ok || !['absent','prepared','completed','cancelled'].includes(status.data?.status)) throw Error('Status unknown');
      let result=status.data.result;
      if(status.data.status==='prepared') {
        const execution=await window.arra.businessDays({action:'walletExecute',requestId:request.id});
        if(!this.mounted || sequence!==this.sequence) return;
        if(!execution?.ok) {
          status=await window.arra.businessDays({action:'walletRequestStatus',requestId:request.id});
          if(!this.mounted || sequence!==this.sequence) return;
          if(!status?.ok || !['prepared','completed'].includes(status.data?.status)) throw Error('Status unknown');
          if(status.data.status==='completed') result=status.data.result;
          else if(execution?.error==='stale') {
            window.localStorage.removeItem(storageKey(key));
            if(walletRequests.get(key)===request) walletRequests.delete(key);
            const refreshed=await this.fetch();
            if(!this.mounted || sequence!==this.sequence || identity(refreshed.day)!==key) return;
            return this.setState({busy:false,...refreshed,confirm:false,walletUnknown:false,error:'Cash changed while counting. Count the wallet again.'});
          } else if(execution?.error==='checkout-unresolved') {
            // The prepared count remains recoverable by its original request ID.
            return this.setState({busy:false,walletUnknown:true,error:closeBlockMessage(execution.error)});
          } else throw Error('Execution unknown');
        } else result=execution.data;
      }
      const refreshed=await this.fetch();
      if(!this.mounted || sequence!==this.sequence || identity(refreshed.day)!==key) return;
      window.localStorage.removeItem(storageKey(key));
      if(walletRequests.get(key)===request) walletRequests.delete(key);
      const completed=result?.shift || null;
      this.setState({busy:false,...refreshed,confirm:false,walletUnknown:false,completed,opening:'',movementAmount:'',movementReason:'',counted:'',retained:'',error:status.data.status==='absent'?'The previous wallet action was not received. Review and try again.':status.data.status==='cancelled'?'The wallet action was cancelled.':''});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,walletUnknown:true,error:'The wallet action result is unknown. Check it before another action.'}); }
    finally { request.pending=false; this.inFlight=false; }
  }
  async cancelWalletAction() {
    if(this.inFlight || !this.state.day) return;
    const key=identity(this.state.day),request=walletRequests.get(key);
    if(!request || request.pending) return;
    this.inFlight=true; request.pending=true; const sequence=++this.sequence;
    this.setState({busy:true,error:''});
    try {
      const outcome=await window.arra.businessDays({action:'walletCancel',requestId:request.id});
      if(!this.mounted || sequence!==this.sequence) return;
      if(!outcome?.ok || !['absent','cancelled','completed'].includes(outcome.data?.status)) throw Error('Cancellation unknown');
      const refreshed=await this.fetch();
      if(!this.mounted || sequence!==this.sequence || identity(refreshed.day)!==key) return;
      window.localStorage.removeItem(storageKey(key));
      if(walletRequests.get(key)===request) walletRequests.delete(key);
      this.setState({busy:false,...refreshed,walletUnknown:false,confirm:false,completed:outcome.data.result?.shift || null,error:outcome.data.status==='completed'?'The wallet action was already saved.':'The wallet action was cancelled.'});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,walletUnknown:true,error:'The wallet action result is unknown. Check it before another action.'}); }
    finally { request.pending=false; this.inFlight=false; }
  }
  startWallet() {
    const value=amount(this.state.opening);
    if(value===null) return this.setState({error:'Enter a valid cash amount.'});
    return this.walletAction({action:'walletStart',amount:value,revision:this.state.wallet?.revision});
  }
  moveWallet() {
    const value=amount(this.state.movementAmount),reason=this.state.movementReason.trim(),shiftId=this.state.wallet?.shiftId;
    if(value===null || value===0 || !reason || !shiftId) return this.setState({error:'Enter a positive amount and a reason.'});
    return this.walletAction({action:'walletMovement',shiftId,direction:this.state.direction,amount:value,reason});
  }
  closeWallet() {
    const counted=amount(this.state.counted),retained=amount(this.state.retained),wallet=this.state.wallet,shift=this.active();
    if(counted===null || retained===null || retained>counted || !shift || wallet?.shiftId!==shift.id || wallet.expected==null) return this.setState({error:'Enter a count and an amount to leave between zero and the count.'});
    return this.walletAction({action:'walletShiftClose',shiftId:shift.id,counted,retained,revision:wallet.revision});
  }
  async loadWalletHistory() {
    if(this.inFlight || this.state.day?.scope!=='combined') return;
    this.inFlight=true; const sequence=++this.sequence, key=identity(this.state.day);
    this.setState({busy:true,error:''});
    try {
      const result=await window.arra.businessDays({action:'walletHistory'});
      const day=await window.arra.businessDays({action:'list'});
      if(!this.mounted || sequence!==this.sequence) return;
      if(!result?.ok || !Array.isArray(result.data?.wallets) || !day?.ok || identity(day.data)!==key) return this.setState({busy:false,error:'Could not load wallet history. Try again.'});
      this.setState({busy:false,walletHistory:result.data.wallets});
    } catch (_) { if(this.mounted && sequence===this.sequence) this.setState({busy:false,error:'Could not load wallet history. Try again.'}); }
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
      const blocked = !r.ok && closeBlockMessage(r.error);
      if(blocked) {
        if(uncertain.get(key)===request) uncertain.delete(key);
        return this.setState({busy:false,confirm:false,unknownId:null,error:blocked});
      }
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
      shift.wallet && h('div',{className:'finance-day'},h('h3',null,t('Wallet handover')),shift.wallet.counted==null ? h('p',null,t('Closed without a wallet count.')) : h(React.Fragment,null,h('p',null,t('Expected in wallet'),': ',money(shift.wallet.expected)),h('p',null,t('Counted cash'),': ',money(shift.wallet.counted)),h('p',null,t(shift.wallet.variance===0?'Matches':shift.wallet.variance<0?'Short':'Over'),': ',money(Math.abs(shift.wallet.variance))),shift.wallet.retained!==null && h('p',null,t('Leave for next shift'),': ',money(shift.wallet.retained)),shift.wallet.taken!==null && h('p',null,t('Take out'),': ',money(shift.wallet.taken)))),
      status==='pending' ? h('p',{role:'status'},t('Sending the report to the printer…')) : status==='accepted' ? h('p',{role:'status'},t('Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.')) : status==='failed' ? h('p',{role:'alert'},t('Printing failed. Check the printer before retrying.')) : status==='uncertain' ? h('p',{role:'status'},t('Print result is uncertain. Check the printer and paper before retrying.')) : null,
      h('div',{className:'floor-actions'},done && h('button',{className:'floor-primary',disabled:this.state.busy,onClick:this.props.onDone},t('Done')),
        status==='pending' || request ? h('button',{disabled:this.state.busy,onClick:()=>this.refreshPrint(shift.id)},t('Check print status')) : h('button',{disabled:this.state.busy,onClick:()=>this.print(shift.id)},t(status==='failed' || status==='uncertain' ? 'Print again after checking printer' : 'Print shift report'))));
  }
  render() {
    const s=this.state,t=(key,values)=>financeText(this.props.language,key,values),shift=this.active(),saved=s.data?.shifts.filter(item=>item.closedAt!==null) || [],selected=saved.find(item=>item.id===s.selectedId),completed=saved.find(item=>item.id===s.completed?.id) || s.completed;
    const wallet=s.wallet, counted=amount(s.counted), retained=amount(s.retained), difference=counted===null || wallet?.expected==null ? null : counted-wallet.expected;
    const input=(label,value,onChange,options={})=>h('label',null,t(label),h('input',{type:'number',inputMode:'numeric',min:0,step:1,value,disabled:s.busy,onChange:e=>onChange(e.target.value),...options}));
    const walletControls=s.day?.scope==='combined' && wallet?.available!==false && wallet && !s.confirm && !s.walletUnknown && h('div',{className:'finance-day wallet-form'},
      h('h3',null,t('Shared cash wallet')),
      wallet.baseline==null ? h(React.Fragment,null,h('p',null,t('Count the cash before service, or record a baseline now.')),input('Cash in wallet (MKD)',s.opening,value=>this.setState({opening:value})),h('button',{disabled:s.busy,onClick:()=>this.startWallet()},t(wallet.shiftId && wallet.reportable?'Count wallet now':'Start shift'))) : h(React.Fragment,null,
        h('p',null,t('Expected in wallet'),': ',money(wallet.expected)),
        h('details',null,h('summary',null,t('Cash in or out')),h('label',null,t('Direction'),h('select',{value:s.direction,disabled:s.busy,onChange:e=>this.setState({direction:e.target.value})},h('option',{value:'in'},t('Cash in')),h('option',{value:'out'},t('Cash out')))),input('Amount (MKD)',s.movementAmount,value=>this.setState({movementAmount:value})),h('label',null,t('Reason'),h('input',{value:s.movementReason,maxLength:200,disabled:s.busy,onChange:e=>this.setState({movementReason:e.target.value})})),h('button',{disabled:s.busy,onClick:()=>this.moveWallet()},t('Save cash movement')))));
    return h('section',{className:'history-panel'},
      s.loading ? h('p',{role:'status'},t('Loading shift…')) : null,
      s.error && h('p',{role:'alert'},t(s.error)),
      s.walletStorageUnavailable && h('p',{role:'alert'},t('Wallet recovery is unavailable. Try again before making a cash change.')),
      !s.loading && s.walletUnavailable && h('p',{role:'alert'},t('Wallet status is unavailable. You can close without counting or try again.')),
      !s.loading && !s.data && h('button',{onClick:()=>this.load()},t('Try again')),
      !s.loading && s.unknownId && h('div',null,h('p',null,t('Check the result for shift #{id}.',{id:s.unknownId})),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.check()},t('Check shift status'))),
      !s.loading && s.walletUnknown && h('div',{role:'alert'},h('p',null,t('The wallet action result is unknown. Check it before another action.')),h('p',null,t('Checking may finish the previously requested cash action. If it was already saved, cancelling will not undo it.')),h('button',{disabled:s.busy,onClick:()=>this.walletAction(null)},t('Check wallet action')),h('button',{disabled:s.busy,onClick:()=>this.cancelWalletAction()},t('Cancel wallet action'))),
      !s.loading && !s.unknownId && !s.walletUnknown && s.completed && h(React.Fragment,null,h('h2',null,t('Shift closed')),this.report(completed,true)),
      !s.loading && !s.unknownId && !s.completed && selected && h(React.Fragment,null,h('h2',null,t('Saved shift report')),this.report(selected),h('button',{disabled:s.busy,onClick:()=>this.setState({selectedId:null})},t('Back to shifts'))),
      !s.loading && !s.unknownId && !s.walletUnknown && !s.completed && !selected && s.data && (shift ? h(React.Fragment,null,
        h('h2',null,t(s.confirm?'Confirm shift close':'Current shift')),
        h(Summary,{shift,language:this.props.language}),
        s.day?.issues?.orders?.length>0 && h('p',null,t('Open orders carry over. Payments recorded after closing count in the next shift.')),
        s.confirm ? h(React.Fragment,null,h('p',null,t('Close the shift opened {date}? The next shift starts automatically. The business day stays open.',{date:time(shift.openedAt,this.props.language)})),h('p',null,t('Totals may change before confirmation. The saved totals use the state at closing.')),
          wallet?.shiftId===shift.id && wallet.expected!=null && h('div',{className:'finance-day wallet-form'},h('h3',null,t('Count the wallet before removing cash')),h('p',null,t('Expected in wallet'),': ',money(wallet.expected)),input('Counted cash',s.counted,value=>this.setState({counted:value})),difference!==null && h('p',{role:'status'},t(difference===0?'Matches':difference<0?'Short':'Over'),': ',money(Math.abs(difference))),input('Leave for next shift',s.retained,value=>this.setState({retained:value})),counted!==null && retained!==null && retained<=counted && h('p',null,t('Take out'),': ',money(counted-retained)),h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.closeWallet()},t('Confirm handover'))),
          h('button',{className:wallet?.expected==null?'floor-primary':undefined,disabled:s.busy,onClick:()=>this.close()},t(wallet?.expected==null && !s.walletUnavailable?(s.busy?'Closing…':'Confirm close'):'Close without counting')),h('button',{disabled:s.busy,onClick:()=>this.setState({confirm:false})},t('Cancel'))) : h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.review()},t('Review and close shift')))
        : h('p',null,t(s.data.coverage==='unavailable'?'Shift tracking starts with the next business day. You can continue service and close this day normally.':'A shift becomes available after service activity. There is no shift to close yet.'))),
      !s.loading && !s.unknownId && !s.completed && !selected && s.data && walletControls,
      !s.loading && !s.unknownId && !s.walletUnknown && !s.completed && !selected && s.day?.scope==='combined' && h('details',{className:'day-details',onToggle:e=>{if(e.currentTarget.open) this.loadWalletHistory();}},h('summary',null,t('Wallet history')),h(WalletHistory,{items:s.walletHistory,language:this.props.language})),
      !s.loading && !s.unknownId && !s.completed && !selected && s.data && !s.confirm && h('details',{className:'day-details'},h('summary',null,t('Previous shifts ({count})',{count:saved.length})),saved.length ? h('ul',{className:'shift-history'},saved.map(item=>h('li',{key:item.id},h('button',{disabled:s.busy,onClick:()=>this.setState({selectedId:item.id})},t('Day #{id} · {opened} – {closed}',{id:item.dayId,opened:time(item.openedAt,this.props.language),closed:time(item.closedAt,this.props.language)}))))) : h('p',{className:'history-muted'},t('No previous shifts.'))));
  }
}
