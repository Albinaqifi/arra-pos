import { desktopBridge } from '../shared/desktop-bridge.js';
import { waiterTranslate } from '../shared/waiter-ui.js';

export class DesktopBill extends React.Component {
  constructor(props) { super(props); this.state = { data: null, error: '', busy: false, loading: true, uncertain: false, method: '', account: '' }; this.disposed = false; this.generation = 0; this.operation = null; this.confirmed = false; this.paymentSelection = null; }
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
  selectMethod(method) {
    if (this.disposed || this.operation || this.confirmed || this.paymentSelection || this.state.uncertain) return;
    if (method === 'cash' || method === 'card') this.setState({ method, account: method === 'card' ? 'A' : '' });
  }
  selectAccount(account) {
    if (this.disposed || this.operation || this.confirmed || this.paymentSelection || this.state.uncertain || this.state.method !== 'cash') return;
    if (account === 'A' || account === 'B') this.setState({ account });
  }
  async review() {
    if (this.paymentSelection || this.state.uncertain) return;
    const operation = this.begin('bill-review'); if (!operation) return;
    this.setState({ loading: true });
    try {
      const result = await desktopBridge.bill({ action: 'review', orderId: this.props.orderId });
      if (this.current(operation)) this.setState(result.ok ? { data: result.data, error: '', loading: false } : { data: null, error: this.serviceError(result.error, 'Could not prepare bill'), loading: false });
    } catch (_) { if (this.current(operation)) this.setState({ data: null, error: 'Could not prepare bill', loading: false }); }
    finally { this.end(operation); }
  }
  async generate() {
    if (!this.state.data || this.paymentSelection || this.state.uncertain) return;
    const request = { action: 'generate', orderId: this.props.orderId, fingerprint: this.state.data.fingerprint };
    const operation = this.begin('bill-generate'); if (!operation) return;
    try {
      const result = await desktopBridge.bill(request);
      if (this.current(operation)) this.setState(result.ok ? { data: result.data, error: '' } : { error: this.serviceError(result.error, 'Could not prepare bill') });
    } catch (_) { if (this.current(operation)) this.setState({ error: 'Could not prepare bill' }); }
    finally { this.end(operation); }
  }
  async pay() {
    if (!this.state.data?.id || (!this.paymentSelection && (!this.state.method || !this.state.account))) return;
    const selection = this.paymentSelection || Object.freeze({ billId: this.state.data.id, method: this.state.method, account: this.state.method === 'card' ? 'A' : this.state.account });
    const operation = this.begin('payment'); if (!operation) return;
    this.setState({ error: '' });
    try {
      let result;
      try { result = await desktopBridge.payment(selection); }
      catch (_) { result = { ok: false, uncertain: true, error: 'Payment result unknown. Retry the same selection.' }; }
      if (!this.current(operation)) return;
      if (result?.ok) {
        this.confirmed = true; this.paymentSelection = null;
        this.props.onConfirmed?.();
        this.props.onUncertain?.(false);
        this.setState({ uncertain: false });
        this.end(operation); // Release the order lease before the staff handoff.
        await this.props.onPaid?.();
      } else {
        const uncertain = !!this.paymentSelection || this.state.uncertain || !!result?.uncertain;
        this.paymentSelection = uncertain ? selection : null;
        this.props.onUncertain?.(uncertain);
        this.setState({ uncertain, error: this.serviceError(result?.error, 'Could not record payment. Retry the same selection.') });
      }
    } finally { this.end(operation); }
  }
  serviceError(error, fallback) {
    const known = ['Invalid request', 'Access denied', 'Send or remove new items before billing', 'No eligible items', 'Order changed; review the bill again', 'Bill already generated', 'Could not prepare bill', 'Bill unavailable', 'Bill already paid with a different selection', 'Could not record payment. Retry the same selection.', 'Payment result unknown. Retry the same selection.'];
    return known.includes(error) ? error : fallback;
  }
  async printTestBill() {
    if (!this.state.data?.id || !desktopBridge.testPrinting || !this.props.printing) return;
    const billId = this.state.data.id, operation = this.begin('bill-print'); if (!operation) return;
    try {
      const result = await this.props.printing.submitTestBill(billId);
      if (this.current(operation)) this.setState({ error: '', printNotice: waiterTranslate(this.props.language, result.ok ? 'waiter.Test print submitted. Check the printer and paper; queue acceptance is not proof of printing. Use the test jobs list to retry.' : 'waiter.Test print status unavailable. Check paper and the test jobs list before retrying.') });
    } finally { this.end(operation); }
  }
  render() {
    const h = React.createElement, d = this.state.data;
    const t = (key, values) => (typeof waiterTranslate === 'function' ? waiterTranslate : (language, key, values = {}) => key.replace(/^waiter\./, '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match))(this.props.language, 'waiter.' + key, values);
    const money = value => Math.round(value).toLocaleString('en-US') + ' den';
    return h('div', { className: 'bill-overlay' },
      h('div', { className: 'bill-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'desktop-bill-title', tabIndex: -1, ref: node => { this.dialog = node; }, onKeyDown: event => this.onKeyDown(event) },
        h('header', { className: 'bill-header' },
          h('div', { className: 'bill-heading' },
            h('h2', { id: 'desktop-bill-title' }, d?.id ? t('Bill generated #{id}', {id:d.id}) : t("Review bill")),
            h('p', null, d?.id ? t("Test mode only. No card terminal is connected. Confirm the separate payment before recording it.") : t("Check the items before generating the bill."))),
          h('div', { className: 'bill-brand', 'aria-label': 'Arra' }, h('span', { 'aria-hidden': 'true' }, 'A'), h('strong', null, 'Arra'))),
        h('div', { className: 'bill-body' },
          (this.state.loading || this.state.busy) && h('p', { role: 'status', className: 'bill-status' }, t(this.state.loading ? 'Loading bill…' : 'Working…')),
          this.state.error && h('p', { role: 'alert', className: 'bill-error' }, t(this.state.error)),
          this.state.uncertain && h('p', { className: 'bill-warning' }, t("The POS payment result is uncertain. Retry the same selection to recover the result; do not repeat the separate terminal payment.")),
          d && h('section', { className: 'bill-summary' },
            h('ul', { className: 'bill-lines' }, d.lines.map(l => h('li', { key: l.itemId }, l.quantity + ' × ' + l.name + ' · ' + money(l.quantity * l.unitPrice), l.modifiers.length > 0 && h('div', { className: 'bill-modifiers' }, l.modifiers.map(m => m.groupName + ': ' + m.optionName + ' (' + m.adjustment + ')').join(', '))))),
            h('div', { className: 'bill-total' }, h('strong', null, t('Total: {total}', {total:money(d.total)})))),
          d?.id && h('div', { className: 'bill-payment' },
            h('button',{className:'bill-print',disabled:this.state.busy || !desktopBridge.testPrinting,onClick:()=>this.printTestBill()},t("Print test bill — not a fiscal receipt")),
            this.state.printNotice && h('p',{role:'status',className:'bill-status'},this.state.printNotice),
            h('p', { className: 'bill-payment-label' }, t("Choose payment method and account:")),
            h('div', { className: 'bill-choices' },
              h('button', { 'aria-pressed': this.state.method === 'cash', disabled: this.state.busy || this.state.uncertain, onClick: () => this.selectMethod('cash') }, t("Cash")),
              h('button', { 'aria-pressed': this.state.method === 'card', disabled: this.state.busy || this.state.uncertain, onClick: () => this.selectMethod('card') }, t("Card (Account A)"))),
            this.state.method === 'cash' && h('div', { className: 'bill-choices' }, h('button', { 'aria-pressed': this.state.account === 'A', disabled: this.state.busy || this.state.uncertain, onClick: () => this.selectAccount('A') }, t("Account A")), h('button', { 'aria-pressed': this.state.account === 'B', disabled: this.state.busy || this.state.uncertain, onClick: () => this.selectAccount('B') }, t("Account B"))),
            this.state.account && h('p', { className: 'bill-selection' }, t('Selected: {method} · Account {account}', {method:t(this.state.method === 'cash' ? 'Cash' : 'Card'), account:this.state.account})))),
        h('footer', { className: 'bill-actions' },
          h('button', { onClick: () => this.close(), disabled: this.state.busy || this.state.uncertain }, d?.id ? t("Close") : t("No, go back")),
          this.state.error && !this.state.uncertain && h('button', { onClick: () => this.review(), disabled: this.state.busy }, t("Review again")),
          !d?.id && d && h('button', { className: 'bill-primary', onClick: () => this.generate(), disabled: this.state.busy }, t("Generate bill")),
          d?.id && this.state.account && h('button', { className: 'bill-primary', disabled: this.state.busy, onClick: () => this.pay() }, t("Record full test payment and close table")))));
  }
}
