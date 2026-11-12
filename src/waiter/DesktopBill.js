class DesktopBill extends React.Component {
  constructor(props) { super(props); this.state = { data: null, error: '', busy: false, loading: true, uncertain: false, method: '', account: '' }; }
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
  async review() {
    this.setState({ loading: true });
    const r = await window.arra.bill({ action: 'review', orderId: this.props.orderId });
    this.setState(r.ok ? { data: r.data, error: '', loading: false } : { data: null, error: this.serviceError(r.error, 'Could not prepare bill'), loading: false });
  }
  async generate() {
    if (this.state.busy || !this.state.data) return;
    this.setState({ busy: true });
    const r = await window.arra.bill({ action: 'generate', orderId: this.props.orderId, fingerprint: this.state.data.fingerprint });
    this.setState(r.ok ? { data: r.data, error: '', busy: false } : { error: this.serviceError(r.error, 'Could not prepare bill'), busy: false });
  }
  async pay() {
    if (this.state.busy || !this.state.data?.id || !this.state.method || !this.state.account) return;
    this.setState({ busy: true, error: '' });
    const r = await window.arra.payment({ billId: this.state.data.id, method: this.state.method, account: this.state.account });
    if (r.ok) this.props.onPaid();
    else this.setState({ busy: false, uncertain: this.state.uncertain || !!r.uncertain, error: this.serviceError(r.error, 'Could not record payment. Retry the same selection.') });
  }
  serviceError(error, fallback) {
    const known = ['Invalid request', 'Access denied', 'Send or remove new items before billing', 'No eligible items', 'Order changed; review the bill again', 'Bill already generated', 'Could not prepare bill', 'Bill unavailable', 'Bill already paid with a different selection', 'Could not record payment. Retry the same selection.', 'Payment result unknown. Retry the same selection.'];
    return known.includes(error) ? error : fallback;
  }
  async printTestBill() {
    if (this.state.busy || !this.state.data?.id || !window.arra.testPrinting) return;
    this.printToken = this.printToken || crypto.randomUUID();
    this.setState({busy:true,error:''});
    const r = await window.arra.testPrinting({action:'bill',billId:this.state.data.id,requestId:this.printToken});
    this.setState({busy:false, printNotice:r.ok ? waiterTranslate(this.props.language, "waiter.Test print submitted. Check the printer and paper; queue acceptance is not proof of printing. Use the test jobs list to retry.") : waiterTranslate(this.props.language, "waiter.Test print status unavailable. Check paper and the test jobs list before retrying.")});
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
            h('button',{className:'bill-print',disabled:this.state.busy || !window.arra.testPrinting,onClick:()=>this.printTestBill()},t("Print test bill — not a fiscal receipt")),
            this.state.printNotice && h('p',{role:'status',className:'bill-status'},this.state.printNotice),
            h('p', { className: 'bill-payment-label' }, t("Choose payment method and account:")),
            h('div', { className: 'bill-choices' },
              h('button', { 'aria-pressed': this.state.method === 'cash', disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ method: 'cash', account: '' }) }, t("Cash")),
              h('button', { 'aria-pressed': this.state.method === 'card', disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ method: 'card', account: 'A' }) }, t("Card (Account A)"))),
            this.state.method === 'cash' && h('div', { className: 'bill-choices' }, h('button', { 'aria-pressed': this.state.account === 'A', disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ account: 'A' }) }, t("Account A")), h('button', { 'aria-pressed': this.state.account === 'B', disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ account: 'B' }) }, t("Account B"))),
            this.state.account && h('p', { className: 'bill-selection' }, t('Selected: {method} · Account {account}', {method:t(this.state.method === 'cash' ? 'Cash' : 'Card'), account:this.state.account})))),
        h('footer', { className: 'bill-actions' },
          h('button', { onClick: this.props.onClose, disabled: this.state.busy || this.state.uncertain }, d?.id ? t("Close") : t("No, go back")),
          this.state.error && !this.state.uncertain && h('button', { onClick: () => this.review(), disabled: this.state.busy }, t("Review again")),
          !d?.id && d && h('button', { className: 'bill-primary', onClick: () => this.generate(), disabled: this.state.busy }, t("Generate bill")),
          d?.id && this.state.account && h('button', { className: 'bill-primary', disabled: this.state.busy, onClick: () => this.pay() }, t("Record full test payment and close table")))));
  }
}
