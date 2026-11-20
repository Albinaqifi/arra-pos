import { financeText } from './finance-i18n.js';
import { Pf700Connection } from './Pf700Connection.js';
import { Pf700DailyReport } from './Pf700DailyReport.js';
import { desktopBridge } from '../shared/desktop-bridge.js';
const h=React.createElement;
const loadPf700Profile = () => desktopBridge.businessDays({ action: 'accountAPf700Profile' });
const simulatePf700Status = () => desktopBridge.businessDays({ action: 'accountAPf700Simulate' });
// Keep an unresolved retry identity even if the financial screen is left and reopened.
const retryTokens=new Map();
const date=value=>new Date(value).toLocaleString();
export class AccountAClosing extends React.Component {
  constructor(props) { super(props); this.state={data:null,loading:true,busy:false,error:'',notice:'',confirmId:null,fiscalCheck:null,fiscalActivity:null}; this.sequence=0; this.active=false; this.busy=false; }
  componentDidMount() { this.active=true; this.load(); }
  componentWillUnmount() { this.active=false; this.sequence++; }
  async load(checkFailure = null) {
    const sequence=++this.sequence;
    this.setState({loading:true,error:'',confirmId:null,fiscalCheck:null});
    try {
      const r=await desktopBridge.businessDays({action:'accountAList'});
      if(!this.active || sequence!==this.sequence) return;
      if(!r.ok) return this.setState({data:null,loading:false,error:'Account A closing is unavailable or access is denied.'});
      this.setState({data:r.data,loading:false,fiscalCheck:checkFailure});
    } catch (_) { if(this.active && sequence===this.sequence) this.setState({data:null,loading:false,error:'Could not load Account A closing. Try again.'}); }
  }
  async close(id) {
    if(this.busy || this.state.confirmId!==id || this.state.data?.days.find(day=>day.id===id)?.fiscal) return;
    this.busy=true; this.setState({busy:true,error:'',notice:''});
    try {
      const r=await desktopBridge.businessDays({action:'accountAClose',dayId:id,language:this.props.language==='sq'?'sq':'en'});
      if(!this.active) return;
      this.setState({confirmId:null,notice:r.ok?'Account A close recorded. Check the report print status.':'Close result unavailable. Refresh and check the day before trying again.'});
      await this.load();
    } catch (_) { if(this.active) { this.setState({confirmId:null,notice:'Close result unavailable. Refresh and check the day before trying again.'}); await this.load(); } }
    finally { this.busy=false; if(this.active) this.setState({busy:false}); }
  }
  async requestFiscal(dayId, mode, operation, retryAfter, checkId) {
    const { data, fiscalCheck, loading } = this.state;
    const fiscal = data?.days.find(day => day.id === dayId)?.fiscal;
    if (!this.active || loading || this.busy || !fiscal || fiscal.mode !== mode) return;
    const request = { dayId, mode };
    if (operation === 'reconcile') {
      if (fiscal.status !== 'uncertain' || fiscal.canReconcile !== true) return;
      request.action = 'accountAFiscalReconcile';
    } else {
      if (fiscal.status !== 'ready' || fiscal.retryAfter !== retryAfter) return;
      if (retryAfter !== undefined) request.retryAfter = retryAfter;
      if (operation === 'preview') {
        request.action = 'accountAFiscalCheck';
      } else {
        if (operation !== 'issue' || !checkId || fiscalCheck?.checkId !== checkId ||
            fiscalCheck.dayId !== dayId || fiscalCheck.mode !== mode || fiscalCheck.retryAfter !== retryAfter) return;
        Object.assign(request, { action: 'accountAFiscalClose', confirmed: true, checkId });
        if (fiscalCheck.printerDocument !== undefined) request.warningDocument = fiscalCheck.printerDocument;
      }
    }

    const sequence = this.sequence;
    const resultScope = { dayId, mode, retryAfter };
    this.busy = true;
    this.setState({ busy: true, fiscalCheck: null, fiscalActivity: { dayId, operation }, confirmId: null, error: '', notice: '' });
    try {
      const reply = await desktopBridge.businessDays(request);
      if (!this.active || sequence !== this.sequence) return;
      if (reply?.denied) {
        await this.load();
        return;
      }
      if (operation === 'preview' && reply?.ok && reply.outcome === 'ready' &&
          typeof reply.checkId === 'string' && reply.checkId.length > 0) {
        const { saleDocument, printerDocument } = reply;
        const hasWarning = saleDocument !== undefined || printerDocument !== undefined;
        if (!hasWarning || (/^[0-9]{7}$/.test(saleDocument) && /^[0-9]{7}$/.test(printerDocument))) {
          this.setState({ fiscalCheck: { ...resultScope, checkId: reply.checkId, saleDocument, printerDocument } });
          return;
        }
      }
      if (operation === 'preview' || (operation === 'issue' && reply?.error && reply.error !== 'uncertain')) {
        const failure = { ...resultScope, error: reply?.error || 'unavailable-check', detail: reply?.detail };
        // Re-read local eligibility if it changed between the list and the check.
        if (reply?.error === 'preflight') this.setState({ fiscalCheck: failure });
        else await this.load(failure);
        return;
      }
      if (operation === 'reconcile' && reply?.ok && reply.outcome === 'not-issued') {
        this.setState({ notice: 'The status check confirmed that no report was issued. Review the day again to request a new report.' });
      } else if (!reply?.ok) {
        this.setState({ notice: 'Could not confirm the daily report. Check its saved status before continuing.' });
      }
      await this.load();
    } catch (_) {
      if (!this.active || sequence !== this.sequence) return;
      if (operation === 'preview') {
        this.setState({ fiscalCheck: { ...resultScope, error: 'unavailable-check' } });
      } else {
        this.setState({ notice: 'Could not confirm the daily report. Check its saved status before continuing.' });
        await this.load();
      }
    } finally {
      this.busy = false;
      if (this.active) this.setState({ busy: false, fiscalActivity: null });
    }
  }
  async retry(id) {
    if(this.busy || !window.confirm(financeText(this.props.language,'Have you checked the printer and paper? Retrying may print a duplicate.'))) return;
    this.busy=true;
    const requestId=retryTokens.get(id) || crypto.randomUUID(); retryTokens.set(id,requestId);
    this.setState({busy:true,error:'',notice:''});
    try {
      const r=await desktopBridge.businessDays({action:'accountARetry',dayId:id,requestId,checked:true});
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
      const r=await desktopBridge.businessDays({action:'accountAConfigure',queue:queue.trim()});
      if(!this.active) return;
      this.setState({notice:r.ok?'Printer queue saved.':'Printer queue could not be saved.'});
      if(r.ok) await this.load();
    } catch (_) { if(this.active) this.setState({notice:'Printer queue could not be saved.'}); }
    finally { this.busy=false; if(this.active) this.setState({busy:false}); }
  }
  renderFiscal(day) {
    const s = this.state, { mode, retryAfter } = day.fiscal;
    const check = s.fiscalCheck?.dayId === day.id && s.fiscalCheck.mode === mode &&
      s.fiscalCheck.retryAfter === retryAfter ? s.fiscalCheck : null;
    return h(Pf700DailyReport, {
      day, language: this.props.language, busy: s.busy, check,
      operation: s.fiscalActivity?.dayId === day.id ? s.fiscalActivity.operation : null,
      onPreview: () => this.requestFiscal(day.id, mode, 'preview', retryAfter),
      onCancel: () => this.setState({ fiscalCheck: null }),
      onConfirm: () => this.requestFiscal(day.id, mode, 'issue', retryAfter, check?.checkId),
      onReconcile: () => this.requestFiscal(day.id, mode, 'reconcile')
    });
  }
  render() {
    const s=this.state,t=(key,values)=>financeText(this.props.language,key,values);
    const printStatus=day=>!day.printAttempts?t('No report print attempt recorded.'):day.printResult==='accepted'?t('Sent to the Windows queue. Check the paper; queue acceptance does not confirm printing.'):day.printResult==='failed'?t('Printing failed. Check the printer before retrying.'):t('Print result is uncertain or still in progress. Refresh after the printer finishes and check the paper before retrying.');
    const fiscalDays = s.data?.days.some(day => day.fiscal);
    return h('section',{className:'history-panel'},s.data && h('p',null,t(fiscalDays
      ? 'Closing Account A leaves the current shared business day open.'
      : 'This is a separate, non-fiscal Account A close. The current shared day remains open.')),
      s.loading && h('p',{role:'status'},t('Loading…')),s.error && h('p',{role:'alert'},t(s.error)),s.notice && h('p',{role:'status'},t(s.notice)),
      !s.loading && h('button',{disabled:s.busy,onClick:()=>this.load()},t('Refresh')),
      s.data && !s.loading && h(React.Fragment,null,
        h(Pf700Connection,{language:this.props.language,loadProfile:loadPf700Profile,simulateStatus:simulatePf700Status}),
        !s.data.days.length && h('p',null,t('No eligible closed days yet.')),
        s.data.days.map(day=>h('div',{className:'finance-day',key:day.id},
          h('h3',null,t('Business day #{id}',{id:day.id})),h('p',null,t('Opened {opened} · Closed {closed}',{opened:date(day.openedAt),closed:date(day.closedAt)})),
          h('p',null,day.status==='complete'?t(day.fiscal && day.printAttempts>0?'Internal Account A close complete':'Account A close complete'):t('Account A close pending')),
          h('div',{className:'finance-metrics'},h('div',null,h('span',null,t('Payments')),h('strong',null,day.count)),h('div',null,h('span',null,t('Total')),h('strong',null,day.total)),h('div',null,h('span',null,t('Cash')),h('strong',null,day.cash)),h('div',null,h('span',null,t('Card')),h('strong',null,day.card))),h('p',{className:'history-muted'},t(day.fiscal?'Account A payments recorded in Arra · MKD':'Amounts in minor units · non-fiscal')),
          day.status==='complete' && h('p',null,t('Account A closed {date} by actor #{actor}',{date:date(day.accountClosedAt),actor:day.closedBy})),
          day.fiscal && this.renderFiscal(day),
          day.status==='complete' && day.printAttempts>0 && h('section',null,
            h('h4',null,t('Non-fiscal Account A report')),
            h('p',{role:day.printResult==='failed'?'alert':'status'},printStatus(day)),
            h('p',null,t('{count} attempt(s) · status: {status}',{count:day.printAttempts,status:t(day.printResult || 'Unavailable')})),
            h('button',{disabled:s.busy,onClick:()=>this.retry(day.id)},t(day.fiscal?'Retry non-fiscal report after checking printer':'Retry report after checking printer'))),
          !day.fiscal && day.status!=='complete' && (s.confirmId===day.id ? h('div',{className:'finance-confirm',role:'group','aria-label':t('Confirm Account A close')},h('p',null,t('Close Account A for this day and attempt to print its non-fiscal report?')),h('div',{className:'floor-actions'},h('button',{className:'floor-primary',disabled:s.busy,onClick:()=>this.close(day.id)},s.busy?t('Closing…'):t('Confirm close')),h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:null})},t('Cancel')))) : h('button',{disabled:s.busy,onClick:()=>this.setState({confirmId:day.id,fiscalCheck:null,notice:''})},t('Review and close Account A'))))),
        h('details',{className:'day-details'},h('summary',null,t('Non-fiscal Account A report printer')),h('p',null,t('Choose a local Windows queue. This can be the same printer as Account A bills.')),h('form',{key:s.data.queue,onSubmit:e=>{e.preventDefault();this.configure(e.currentTarget.elements.queue.value);}},h('label',null,t('Printer queue '),h('input',{name:'queue',defaultValue:s.data.queue,required:true,maxLength:255})),h('button',{type:'submit',disabled:s.busy},t('Save printer queue'))))));
  }
}
