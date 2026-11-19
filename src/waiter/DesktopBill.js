import { desktopBridge } from '../shared/desktop-bridge.js';
import { waiterTranslate } from '../shared/waiter-ui.js';

const fiscalMessages = {
  pending: 'The PF700 checkout is in progress. Check its status.',
  uncertain: 'The receipt outcome is unknown. Ask for help; do not take another payment or run printer checks.',
  failed: 'The receipt did not start. You can retry the same payment method.',
  unmapped: 'A bill item has no saved VAT group. Check its menu and order details.',
  origin: 'A bill item has no saved Macedonian-product mark. Ask Combined to classify it in Menu management.',
  unavailable: 'The PF700 cannot register the items or amounts on this bill.',
  blocked: 'Another PF700 receipt needs attention before this checkout.',
  scope: 'This supervised trial permits one cash receipt for one unit of one item.',
  cardDisabled: 'Card checkout on the physical fiscal printer is not available.',
  approvalRequired: 'Confirm the simulated terminal approval first.',
  profile: 'Reopen checkout with the original printer and payment method.',
  submitted: 'The receipt was acknowledged. Confirm the original payment to finish checkout.',
  selection: 'This bill already has a fiscal checkout. Check its original payment method.'
};

const simulatedInterruptions = Object.freeze([
  ['', 'No simulated interruption'],
  ['before_open', 'Before opening the simulated receipt'],
  ['after_items', 'After registering simulated items'],
  ['after_tender', 'After simulated cash payment'],
  ['after_close', 'After closing the simulated receipt'],
  ['after_ack', 'After acknowledgement, before saving payment']
]);
const simulatedStages = Object.freeze({
  not_started: 'The simulated receipt has not started. Finish the original sale.',
  open_unpaid: 'The simulated receipt is open and unpaid. Finish with the original cash payment.',
  tendered: 'The simulated receipt is paid and still open. Close it without another payment.',
  closed: 'The simulated receipt is closed. Finish recording the original payment.'
});

export class DesktopBill extends React.Component {
  constructor(props) { super(props); this.state = { data: null, error: '', busy: false, loading: true, uncertain: false, method: '', account: '', simulationInterrupt: '', simulatedRecoveryStage: null }; this.disposed = false; this.generation = 0; this.operation = null; this.confirmed = false; this.paymentSelection = null; }
  componentDidMount() {
    this.previousFocus = document.activeElement;
    this.keepFocus = event => { if (this.dialog && !this.dialog.contains(event.target)) this.dialog.focus(); };
    document.addEventListener?.('focusin', this.keepFocus);
    this.dialog?.focus();
    this.review();
  }
  componentDidUpdate() {
    if (this.dialog && (!this.dialog.contains(document.activeElement) || document.activeElement?.disabled)) this.dialog.focus();
  }
  componentWillUnmount() {
    this.disposed = true; this.generation++;
    if (this.operation) this.end(this.operation);
    document.removeEventListener?.('focusin', this.keepFocus);
    this.previousFocus?.focus?.();
  }
  onKeyDown(event) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(this.dialog.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    if (!controls.length) { event.preventDefault(); this.dialog.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  current(operation) { return !this.disposed && operation.generation === this.generation && (!this.props.isCurrent || this.props.isCurrent()); }
  begin(kind) {
    if (this.disposed || this.operation || this.confirmed) return null;
    const operation = { generation: this.generation, lease: null, ended: false };
    this.operation = operation;
    if (this.props.beginOperation) {
      operation.lease = this.props.beginOperation(kind);
      if (!operation.lease) { this.operation = null; return null; }
    }
    this.setState({ busy: true });
    return operation;
  }
  end(operation) {
    if (operation.ended) return;
    operation.ended = true;
    if (this.operation === operation) this.operation = null;
    if (operation.lease) this.props.endOperation(operation.lease);
    if (this.current(operation) && !this.confirmed) this.setState({ busy: false });
  }
  close() {
    if (this.disposed || this.operation || this.confirmed || this.paymentSelection || this.state.uncertain) return;
    this.props.onClose?.();
  }
  selectMethod(method, account = 'A') {
    if (this.disposed || this.operation || this.confirmed || this.paymentSelection || this.state.uncertain || this.state.fiscalHold || this.state.fiscalTenderFixed) return;
    if (this.state.data?.fiscalMode === 'device' && method === 'card') return;
    if (method === 'card') this.setState({ method, account: 'A', simulationInterrupt: '' });
    else if (method === 'cash' && (account === 'A' || account === 'B')) this.setState({ method, account, simulationInterrupt: '' });
  }
  presentBill(data, rejection) {
    const fiscal = data.fiscal;
    if (fiscal?.status === 'accepted') {
      this.showReceipt(fiscal, data);
      return;
    }
    const wrongProfile = fiscal?.status === 'failed' && (fiscal.mode !== data.fiscalMode ||
      (fiscal.mode === 'device' && fiscal.receipt.domesticProduct !== data.fiscalDomesticProduct &&
        !(data.fiscalRequiresOrigins && fiscal.receipt.lines.length === 1 && fiscal.receipt.lines[0].quantity === 1 &&
          !Object.hasOwn(fiscal.receipt.lines[0], 'domesticProduct'))));
    const cashIntent = data.simulatedCashIntent;
    const validCashIntent = Number.isSafeInteger(cashIntent?.id) && cashIntent.id > 0 &&
      simulatedInterruptions.some(([stage]) => stage && stage === cashIntent.interruption);
    const cashProfile = !!cashIntent && (!validCashIntent || data.fiscalMode !== 'simulation' || data.simulationRecoveryControls !== true);
    const status = wrongProfile || cashProfile || ((data.simulatedCardApproval || data.simulatedCardIntent) && data.fiscalMode !== 'simulation') ? 'profile' : rejection || fiscal?.status;
    this.setState({
      data, loading: false, error: fiscalMessages[status] || '', simulatedRecoveryStage: null,
      simulationInterrupt: validCashIntent ? cashIntent.interruption : '',
      fiscalStatus: status, fiscalHold: (!!fiscal || data.simulatedCardApproval || data.simulatedCardIntent || cashIntent) && ['pending', 'uncertain', 'profile'].includes(status),
      fiscalTenderFixed: !!fiscal || !!data.simulatedCardApproval || !!data.simulatedCardIntent || !!cashIntent,
      ...(fiscal ? { method: fiscal.method, account: 'A' } : cashIntent ? {method:'cash',account:'A'} : (data.simulatedCardApproval || data.simulatedCardIntent) ? { method:'card', account:'A' } : {})
    });
  }
  async review() {
    if (this.paymentSelection || this.state.uncertain) return;
    const operation = this.begin('bill-review'); if (!operation) return;
    this.setState({ loading: true });
    try {
      const result = await desktopBridge.bill({ action: 'review', orderId: this.props.orderId });
      if (!this.current(operation)) return;
      if (!result.ok) {
        this.setState({ ...((!this.state.fiscalHold || result.error === 'Access denied') && { data: null }), error: this.serviceError(result.error, 'Could not prepare bill'), loading: false });
        return;
      }
      this.presentBill(result.data);
    } catch (_) { if (this.current(operation)) this.setState({ error: 'Could not prepare bill', loading: false }); }
    finally { this.end(operation); }
  }
  async generate() {
    if (!this.state.data || this.paymentSelection || this.state.uncertain) return;
    const request = { action: 'generate', orderId: this.props.orderId, fingerprint: this.state.data.fingerprint };
    const operation = this.begin('bill-generate'); if (!operation) return;
    try {
      const result = await desktopBridge.bill(request);
      if (!this.current(operation)) return;
      if (result.ok) this.presentBill(result.data);
      else this.setState({ error: this.serviceError(result.error, 'Could not prepare bill') });
    } catch (_) { if (this.current(operation)) this.setState({ error: 'Could not prepare bill' }); }
    finally { this.end(operation); }
  }
  async pay(terminalApproved = false) {
    if (this.canCheckSimulatedCash() || this.state.fiscalHold || (this.state.uncertain && this.paymentSelection?.account === 'A' && this.state.data?.fiscalMode === 'device') ||
        !this.state.data?.id || (!this.paymentSelection && (!this.state.method || !this.state.account))) return;
    if (this.state.data.fiscalMode === 'simulation' && this.state.method === 'card' &&
        !this.paymentSelection && !this.state.data.simulatedCardApproval &&
        (!this.state.data.simulatedCardIntent || terminalApproved !== true)) return;
    const cashIntent = this.state.data.simulatedCashIntent;
    if (!this.paymentSelection && this.state.data.simulationRecoveryControls === true && this.state.data.fiscalMode === 'simulation' &&
        this.state.method === 'cash' && this.state.account === 'A' && !this.state.data.fiscal && this.state.simulationInterrupt && !cashIntent) return;
    const selection = this.paymentSelection || Object.freeze({ billId: this.state.data.id, method: this.state.method, account: this.state.method === 'card' ? 'A' : this.state.account,
      ...(this.state.data.simulationRecoveryControls === true && this.state.data.fiscalMode === 'simulation' && !this.state.data.fiscal &&
          this.state.method === 'cash' && this.state.account === 'A' && cashIntent &&
          Number.isSafeInteger(cashIntent.id) && cashIntent.id > 0 && simulatedInterruptions.some(([stage]) => stage && stage === cashIntent.interruption)
        ? {simulateInterrupt:cashIntent.interruption,intentId:cashIntent.id} : {}),
      ...(this.state.data.fiscalMode === 'simulation' && this.state.method === 'card' && !this.state.data.simulatedCardApproval
        ? {terminalApproved:true,intentId:this.state.data.simulatedCardIntent.id} : {}) });
    const operation = this.begin('payment'); if (!operation) return;
    this.setState({ error: '' });
    try {
      let result;
      try { result = await desktopBridge.payment(selection); }
      catch (_) { result = { ok: false, uncertain: true, error: 'Payment result unknown. Retry the same selection.' }; }
      if (!this.current(operation)) return;
      if (result?.ok) {
        if (result.data?.fiscal?.status === 'accepted') {
          this.showReceipt(result.data.fiscal, this.state.data);
          return;
        }
        this.confirmed = true; this.paymentSelection = null;
        this.props.onConfirmed?.();
        this.props.onUncertain?.(false);
        this.setState({ uncertain: false });
        this.end(operation); // Release the order lease before the staff handoff.
        await this.props.onPaid?.();
      } else if (Object.hasOwn(fiscalMessages, result?.fiscalStatus)) {
        this.paymentSelection = null;
        this.props.onUncertain?.(false);
        this.setState({
          uncertain: false, error: fiscalMessages[result.fiscalStatus], fiscalStatus: result.fiscalStatus,
          fiscalHold: ['uncertain', 'pending', 'selection'].includes(result.fiscalStatus) ||
            (result.fiscalStatus === 'profile' && !!this.state.data?.fiscal),
          fiscalTenderFixed: (selection.method === 'card' && this.state.data?.fiscalMode === 'simulation' && result.fiscalStatus !== 'approvalRequired') || ['uncertain', 'pending', 'selection', 'submitted', 'failed'].includes(result.fiscalStatus) ||
            (result.fiscalStatus === 'profile' && !!this.state.data?.fiscal)
        });
        if (['pending', 'uncertain', 'selection', 'submitted', 'profile'].includes(result.fiscalStatus) || (selection.method === 'card' && this.state.data?.fiscalMode === 'simulation')) {
          // Read only. The journal can already contain a pre-open document or
          // a final acknowledgement even when the payment response was lost.
          const saved = await Promise.resolve().then(() => desktopBridge.bill({ action: 'review', orderId: this.props.orderId })).catch(() => null);
          if (!this.current(operation)) return;
          if (saved?.error === 'Access denied') this.setState({ data: null, error: 'Access denied' });
          else if (saved?.ok && saved.data?.id === selection.billId && (saved.data.fiscal || saved.data.simulatedCardApproval || result.fiscalStatus === 'profile')) {
            this.presentBill(saved.data, result.fiscalStatus === 'profile' || !saved.data.fiscal ? result.fiscalStatus : undefined);
          }
        }
      } else {
        const uncertain = !!this.paymentSelection || this.state.uncertain || !!result?.uncertain;
        this.paymentSelection = uncertain ? selection : null;
        this.props.onUncertain?.(uncertain);
        this.setState({ uncertain, error: this.serviceError(result?.error, 'Could not record payment. Retry the same selection.') });
      }
    } finally { this.end(operation); }
  }
  async terminalIntent() {
    const data=this.state.data;
    if (!data?.id || data.fiscalMode !== 'simulation' || this.state.method !== 'card' || this.state.uncertain ||
        this.state.fiscalHold || data.simulatedCardApproval || data.simulatedCardIntent) return;
    const operation=this.begin('payment'); if (!operation) return;
    try {
      const request={billId:data.id,method:'card',account:'A',prepareSimulated:true};
      try { await desktopBridge.payment(request); } catch (_) { /* inspect the durable intent */ }
      if (!this.current(operation)) return;
      const saved=await Promise.resolve().then(()=>desktopBridge.bill({action:'review',orderId:this.props.orderId})).catch(()=>null);
      if (!this.current(operation)) return;
      if (saved?.ok && saved.data?.id === data.id) {
        this.presentBill(saved.data);
      } else this.setState({error:'Could not prepare bill',fiscalHold:true});
    } finally { this.end(operation); }
  }
  async prepareSimulatedCash() {
    const data = this.state.data, stage = this.state.simulationInterrupt;
    if (!data?.id || data.fiscalMode !== 'simulation' || data.simulationRecoveryControls !== true || data.fiscal || data.simulatedCashIntent ||
        this.state.method !== 'cash' || this.state.account !== 'A' || this.state.fiscalHold || this.state.uncertain ||
        !simulatedInterruptions.some(([value]) => value && value === stage)) return;
    const operation = this.begin('payment'); if (!operation) return;
    try {
      const request = {billId:data.id,method:'cash',account:'A',prepareSimulatedCash:stage};
      try { await desktopBridge.payment(request); } catch (_) { /* inspect the durable intent */ }
      if (!this.current(operation)) return;
      const saved = await Promise.resolve().then(() => desktopBridge.bill({action:'review',orderId:this.props.orderId})).catch(() => null);
      if (!this.current(operation)) return;
      if (saved?.ok && saved.data?.id === data.id && saved.data.simulatedCashIntent?.interruption === stage) {
        this.presentBill(saved.data);
      } else this.setState({error:'Could not prepare the simulated interruption. Reload the saved bill.',fiscalHold:true});
    } finally { this.end(operation); }
  }
  async recoverSimulation() {
    if (!this.state.data?.simulatedCardApproval || this.state.data?.fiscalMode !== 'simulation' ||
        this.state.fiscalStatus !== 'uncertain') return;
    const operation = this.begin('payment'); if (!operation) return;
    try {
      const result = await desktopBridge.payment({billId:this.state.data.id,method:'card',account:'A',recoverSimulated:true});
      if (!this.current(operation)) return;
      if (result?.ok && result.data?.fiscal?.status === 'accepted') this.showReceipt(result.data.fiscal,this.state.data);
      else this.setState({error:fiscalMessages[result?.fiscalStatus] || 'Could not record payment. Retry the same selection.'});
    } catch (_) {
      if (this.current(operation)) this.setState({error:fiscalMessages.uncertain});
    } finally { this.end(operation); }
  }
  canCheckSimulatedCash() {
    const d = this.state.data;
    return d?.id && d.fiscalMode === 'simulation' && d.simulationRecoveryControls === true &&
      this.state.method === 'cash' && this.state.account === 'A' &&
      (this.state.fiscalStatus === 'uncertain' || (this.state.uncertain && !!d.fiscal));
  }
  async checkSimulatedCash() {
    if (!this.canCheckSimulatedCash()) return;
    const operation = this.begin('payment'); if (!operation) return;
    this.setState({ simulatedRecoveryStage: null });
    try {
      const result = await desktopBridge.payment({billId:this.state.data.id,method:'cash',account:'A',checkSimulated:true});
      if (!this.current(operation)) return;
      if (result?.ok && result.data?.fiscal?.status === 'accepted') {
        this.showReceipt(result.data.fiscal,this.state.data);
      } else if (result?.ok && Object.hasOwn(simulatedStages, result.data?.stage)) {
        this.paymentSelection = null;
        this.props.onUncertain?.(false);
        this.setState({ simulatedRecoveryStage: result.data.stage, uncertain: false, fiscalHold: true,
          fiscalTenderFixed: true, fiscalStatus: 'uncertain', error: '' });
      } else this.setState({error:'Could not verify the simulated receipt. It remains on hold.'});
    } catch (_) {
      if (this.current(operation)) this.setState({error:'Could not verify the simulated receipt. It remains on hold.'});
    } finally { this.end(operation); }
  }
  async finishSimulatedCash() {
    if (!this.canCheckSimulatedCash() || !Object.hasOwn(simulatedStages, this.state.simulatedRecoveryStage)) return;
    const operation = this.begin('payment'); if (!operation) return;
    this.setState({ simulatedRecoveryStage: null, error: '' });
    try {
      const result = await desktopBridge.payment({billId:this.state.data.id,method:'cash',account:'A',finishSimulated:true});
      if (!this.current(operation)) return;
      if (result?.ok && result.data?.fiscal?.status === 'accepted') this.showReceipt(result.data.fiscal,this.state.data);
      else this.setState({error:'Could not finish the simulated receipt. Check it again.'});
    } catch (_) {
      if (this.current(operation)) this.setState({error:'Could not finish the simulated receipt. Check it again.'});
    } finally { this.end(operation); }
  }
  showReceipt(fiscal, data) {
    this.confirmed = true;
    this.paymentSelection = null;
    this.props.onConfirmed?.();
    this.props.onUncertain?.(false);
    this.setState({ data, receipt: fiscal, busy: false, loading: false, error: '', uncertain: false, fiscalHold: false, fiscalStatus: 'accepted' });
  }
  async finishReceipt() {
    if (this.disposed || !this.state.receipt || this.leavingReceipt) return;
    this.leavingReceipt = true;
    await this.props.onPaid?.();
  }
  serviceError(error, fallback) {
    const known = ['Invalid request', 'Access denied', 'Send or remove new items before billing', 'No eligible items', 'Order changed; review the bill again', 'Bill already generated', 'Could not prepare bill', 'Bill unavailable', 'Bill already paid with a different selection', 'Could not record payment. Retry the same selection.', 'Payment result unknown. Retry the same selection.'];
    return known.includes(error) ? error : fallback;
  }
  render() {
    const h = React.createElement, d = this.state.data;
    const t = (key, values) => (typeof waiterTranslate === 'function' ? waiterTranslate : (language, key, values = {}) => key.replace(/^waiter\./, '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match))(this.props.language, 'waiter.' + key, values);
    const money = value => Math.round(value).toLocaleString('en-US') + ' den';
    const receipt = this.state.receipt;
    const fiscal = receipt || d?.fiscal;
    const device = (fiscal?.mode || d?.fiscalMode) === 'device';
    const submitted = this.state.fiscalStatus === 'submitted';
    const unknownDevicePayment = this.state.uncertain && this.paymentSelection?.account === 'A' && d?.fiscalMode === 'device';
    const domestic = fiscal?.receipt?.domesticProduct ?? d?.fiscalDomesticProduct;
    const legacyTrial = fiscal?.status === 'failed' && fiscal.mode === 'device' &&
      fiscal.receipt.lines.length === 1 && fiscal.receipt.lines[0].quantity === 1 &&
      typeof fiscal.receipt.domesticProduct === 'boolean' && !Object.hasOwn(fiscal.receipt.lines[0], 'domesticProduct');
    const liveSelection = d?.fiscalMode === 'device' && !receipt && !submitted && !this.state.fiscalHold && !this.state.uncertain && this.state.account === 'A';
    const locked = this.state.busy || this.state.uncertain || this.state.fiscalHold || this.state.fiscalTenderFixed || !!receipt;
    const simulatedCashCheck = this.canCheckSimulatedCash();
    const simulatedCashControls = d?.simulationRecoveryControls === true && d.fiscalMode === 'simulation' &&
      d.id && !d.fiscal && !receipt && this.state.method === 'cash' && this.state.account === 'A';
    const simulatedCashPrepare = simulatedCashControls && !!this.state.simulationInterrupt && !d.simulatedCashIntent && !this.state.uncertain;
    const simulatedCashStart = simulatedCashControls && !!d.simulatedCashIntent && !this.state.fiscalHold;
    return h('div', { className: 'bill-overlay' },
      h('div', { className: 'bill-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'desktop-bill-title', tabIndex: -1, ref: node => { this.dialog = node; }, onKeyDown: event => this.onKeyDown(event) },
        h('header', { className: 'bill-header' },
          h('div', { className: 'bill-heading' },
            h('h2', { id: 'desktop-bill-title' }, receipt ? t(receipt.mode === 'simulation' ? 'Simulated PF700 receipt' : 'Registered PF700 receipt') : d?.id ? t('Bill generated #{id}', {id:d.id}) : t("Review bill")),
            !d?.id && h('p', null, t("Check the items before generating the bill."))),
          h('button', { type: 'button', className: 'bill-brand', 'aria-label': t('Select Cash B'), title: t('Select Cash B'), 'aria-pressed': this.state.method === 'cash' && this.state.account === 'B', disabled: !d?.id || locked, onClick: () => this.selectMethod('cash', 'B') }, h('span', { 'aria-hidden': 'true' }, 'A'), h('strong', null, 'Arra'))),
        h('div', { className: 'bill-body' },
          (this.state.loading || this.state.busy) && h('p', { role: 'status', className: 'bill-status' }, t(this.state.loading ? 'Loading bill…' : 'Working…')),
          (this.state.fiscalStatus === 'uncertain' || unknownDevicePayment || simulatedCashCheck) && h('p', { role: 'alert', className: 'bill-error' }, t((d?.simulatedCardApproval && d?.fiscalMode === 'simulation') || simulatedCashCheck
            ? 'The simulated receipt outcome is unknown. Check the simulated receipt; do not take another payment.' : fiscalMessages.uncertain)),
          this.state.error && !unknownDevicePayment && !(simulatedCashCheck && this.state.error === 'Payment result unknown. Retry the same selection.') &&
            (this.state.fiscalStatus !== 'uncertain' || this.state.error !== fiscalMessages.uncertain) &&
            h('p', { role: 'alert', className: 'bill-error' }, t(this.state.error)),
          receipt && h('p', { role: 'status', className: 'bill-status' }, receipt.reference, ' · ', t(receipt.method === 'card' ? 'Card' : 'Cash')),
          !receipt && d?.fiscalMode === 'simulation' && this.state.account === 'A' &&
            h('p', { className: 'bill-status' }, t('Offline PF700 checkout. This payment uses a simulated printer.')),
          !receipt && d?.fiscalMode === 'simulation' && this.state.method === 'card' &&
            h('p', { className: 'bill-warning' }, t(this.state.fiscalTenderFixed || this.state.uncertain
              ? d.simulatedCardIntent && !d.simulatedCardApproval ? 'Record the observed simulated terminal result. Do not take another payment.' : 'The simulated terminal payment was approved. Do not take another payment.'
              : 'Simulate the separate terminal result for this full amount. No terminal charge is made.')),
          liveSelection && h('p', { className: 'bill-warning' }, t('Supervised PF700 checkout. Confirming Cash A will register a real sale.')),
          device && (!d?.fiscalRequiresOrigins || (fiscal && !fiscal.receipt.lines.some(l => typeof l.domesticProduct === 'boolean'))) && (liveSelection || fiscal) && typeof domestic === 'boolean' &&
            h('p', { className: 'bill-status' }, t(domestic ? 'Macedonian-product mark included' : 'Macedonian-product mark omitted')),
          !receipt && submitted && fiscal?.reference && h('p', { className: 'bill-status' }, t('Acknowledged document {number}', {number:fiscal.reference})),
          device && this.state.fiscalStatus === 'uncertain' && fiscal?.baseline && h('p', { className: 'bill-warning' },
            t('For the person helping: expected document {number} on printer {device}.', {
              number:fiscal.baseline.expectedDocumentNumber, device:fiscal.baseline.deviceId
            })),
          this.state.uncertain && !unknownDevicePayment && !simulatedCashCheck && h('p', { className: 'bill-warning' }, t("The POS payment result is uncertain. Retry the same selection to recover the result; do not repeat the separate terminal payment.")),
          simulatedCashCheck && this.state.simulatedRecoveryStage && h('p', { role:'status', className:'bill-status' }, t(simulatedStages[this.state.simulatedRecoveryStage])),
          !receipt && !legacyTrial && d?.fiscalRequiresOrigins && this.state.account === 'A' && d.lines.some(l => !l.taxGroup || typeof l.domesticProduct !== 'boolean') &&
            h('p', { role: 'alert', className: 'bill-warning' }, t('A bill item is missing its saved VAT group or Macedonian-product mark. Ask Combined to check Menu management.')),
          d && h('section', { className: 'bill-summary' },
            h('ul', { className: 'bill-lines' }, (receipt ? receipt.receipt.lines : d.lines).map(l => h('li', { key: l.itemId }, l.quantity + ' × ' + l.name + ' · ' + money(l.quantity * l.unitPrice), l.taxGroup && Number.isInteger(l.taxRate) && h('small', null, ' · ', t('VAT {rate}% ({group})', {rate:l.taxRate, group:l.taxGroup})), typeof l.domesticProduct === 'boolean' && h('small', null, ' · ', t(l.domesticProduct ? 'Macedonian-product mark included' : 'Macedonian-product mark omitted')), l.modifiers.length > 0 && h('div', { className: 'bill-modifiers' }, l.modifiers.map(m => m.groupName + ': ' + m.optionName + ' (' + m.adjustment + ')').join(', '))))),
            h('div', { className: 'bill-total' }, h('strong', null, t('Total: {total}', {total:money(d.total)})))),
          d?.id && !receipt && h('div', { className: 'bill-payment' },
            h('p', { className: 'bill-payment-label' }, t("Choose payment method and account:")),
            h('div', { className: 'bill-choices' },
              h('button', { 'aria-pressed': this.state.method === 'cash' && this.state.account === 'A', disabled: locked, onClick: () => this.selectMethod('cash', 'A') }, t("Cash")),
              h('button', { 'aria-pressed': this.state.method === 'card', disabled: locked || d.fiscalMode === 'device', onClick: () => this.selectMethod('card') }, t("Card"))),
            simulatedCashControls && h('label', null, t('Simulated interruption'),
              h('select', {value:this.state.simulationInterrupt,disabled:locked,onChange:event=>this.setState({simulationInterrupt:event.target.value})},
                simulatedInterruptions.map(([value,label]) => h('option',{key:value,value},t(label))))))),
        h('footer', { className: 'bill-actions' },
          receipt ? h('button', { className: 'bill-primary', onClick: () => this.finishReceipt() }, t('Continue')) :
            h('button', { onClick: () => this.close(), disabled: this.state.busy || this.state.uncertain }, d?.id ? t("Close") : t("No, go back")),
          this.state.error && !this.state.uncertain && h('button', { onClick: () => this.review(), disabled: this.state.busy }, t(this.state.fiscalHold ? 'Reload saved bill' : 'Review again')),
          d?.simulatedCardApproval && d?.fiscalMode === 'simulation' && this.state.fiscalStatus === 'uncertain' &&
            h('button', { disabled: this.state.busy, onClick: () => this.recoverSimulation() }, t('Check simulated receipt')),
          simulatedCashCheck && h('button', {disabled:this.state.busy,onClick:()=>this.checkSimulatedCash()}, t('Check simulated receipt')),
          simulatedCashCheck && this.state.simulatedRecoveryStage && h('button', {className:'bill-primary',disabled:this.state.busy,onClick:()=>this.finishSimulatedCash()}, t('Finish simulated recovery')),
          simulatedCashPrepare && h('button', {className:'bill-primary',disabled:this.state.busy,onClick:()=>this.prepareSimulatedCash()}, t('Prepare simulated interruption')),
          simulatedCashStart && h('button', {className:'bill-primary',disabled:this.state.busy,onClick:()=>this.pay()}, t(this.state.uncertain ? 'Retry same simulated attempt' : 'Start simulated interrupted sale')),
          !d?.id && d && h('button', { className: 'bill-primary', onClick: () => this.generate(), disabled: this.state.busy }, t("Generate bill")),
          d?.id && this.state.account && !receipt && !this.state.fiscalHold && !unknownDevicePayment && d.fiscalMode === 'simulation' && this.state.method === 'card' && !d.simulatedCardApproval && !this.state.uncertain && !d.simulatedCardIntent &&
            h('button', { disabled: this.state.busy, onClick: () => this.setState({method:'',account:''}) }, t('Simulate decline or cancellation')),
          d?.id && this.state.account && !receipt && !this.state.fiscalHold && !unknownDevicePayment && d.fiscalMode === 'simulation' && this.state.method === 'card' && !d.simulatedCardApproval && !this.state.uncertain && !d.simulatedCardIntent &&
            h('button', { className:'bill-primary', disabled:this.state.busy, onClick:()=>this.terminalIntent() }, t('Prepare simulated terminal')),
          d?.id && this.state.account && !receipt && !this.state.fiscalHold && !unknownDevicePayment && !simulatedCashCheck && !simulatedCashPrepare && !simulatedCashStart && !(d.fiscalMode === 'simulation' && this.state.method === 'card' && !d.simulatedCardApproval && !this.state.uncertain && !d.simulatedCardIntent) && h('button', { className: 'bill-primary', disabled: this.state.busy, onClick: () => this.pay(true) }, t(submitted ? 'Finish recording payment' : liveSelection ? 'Register cash sale' : d.fiscalMode === 'simulation' && this.state.method === 'card' && !d.simulatedCardApproval && !this.state.uncertain ? 'Record observed simulated approval' : 'confirim bill')))));
  }
}
