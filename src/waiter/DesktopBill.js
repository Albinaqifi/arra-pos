class DesktopBill extends React.Component {
  constructor(props) { super(props); this.state = { data: null, error: '', busy: false, uncertain: false, method: '', account: '' }; }
  componentDidMount() { this.review(); }
  async review() {
    const r = await window.arra.bill({ action: 'review', orderId: this.props.orderId });
    this.setState(r.ok ? { data: r.data, error: '' } : { data: null, error: r.error });
  }
  async generate() {
    if (this.state.busy || !this.state.data) return;
    this.setState({ busy: true });
    const r = await window.arra.bill({ action: 'generate', orderId: this.props.orderId, fingerprint: this.state.data.fingerprint });
    this.setState(r.ok ? { data: r.data, error: '', busy: false } : { error: r.error, busy: false });
  }
  async pay() {
    if (this.state.busy || !this.state.data?.id || !this.state.method || !this.state.account) return;
    this.setState({ busy: true, error: '' });
    const r = await window.arra.payment({ billId: this.state.data.id, method: this.state.method, account: this.state.account });
    if (r.ok) this.props.onPaid();
    else this.setState({ busy: false, uncertain: this.state.uncertain || !!r.uncertain, error: r.error || (typeof waiterTranslate === 'function' ? waiterTranslate : (language, key, values = {}) => key.replace(/^waiter\./, '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match))(this.props.language, "waiter.Payment unavailable. Retry the same selection.") });
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
    return h('div', { role: 'dialog', 'aria-label': t("Bill review"), style: { position: 'fixed', inset: 0, zIndex: 1000, background: '#0008', display: 'flex', justifyContent: 'center', alignItems: 'center' } },
      h('div', { style: { background: 'white', padding: 28, borderRadius: 20, maxHeight: '90vh', overflow: 'auto', width: 600 } },
        h('h2', null, d?.id ? t('Bill generated #{id}', {id:d.id}) : t("Review bill")),
        h('p', null, d?.id ? t("Test mode only. No card terminal is connected. Confirm the separate payment before recording it.") : t("Check the items before generating the bill.")),
        this.state.error && h('p', { role: 'alert' }, t(this.state.error)),
        this.state.uncertain && h('p', null, t("The POS payment result is uncertain. Retry the same selection to recover the result; do not repeat the separate terminal payment.")),
        d && h(React.Fragment, null, h('ul', null, d.lines.map(l => h('li', { key: l.itemId }, l.quantity + ' × ' + l.name + ' · ' + money(l.quantity * l.unitPrice), l.modifiers.length > 0 && h('div', null, l.modifiers.map(m => m.groupName + ': ' + m.optionName + ' (' + m.adjustment + ')').join(', '))))), h('strong', null, t('Total: {total}', {total:money(d.total)}))),
        d?.id && h('div', null,
          h('button',{disabled:this.state.busy || !window.arra.testPrinting,onClick:()=>this.printTestBill()},t("Print test bill — not a fiscal receipt")),
          this.state.printNotice && h('p',{role:'status'},this.state.printNotice),
          h('p', null, t("Choose payment method and account:")),
          h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ method: 'cash', account: '' }) }, t("Cash")), ' ',
          h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ method: 'card', account: 'A' }) }, t("Card (Account A)")),
          this.state.method === 'cash' && h('div', null, h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ account: 'A' }) }, t("Account A")), ' ', h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ account: 'B' }) }, t("Account B"))),
          this.state.account && h('p', null, t('Selected: {method} · Account {account}', {method:t(this.state.method === 'cash' ? 'Cash' : 'Card'), account:this.state.account})),
          this.state.account && h('button', { disabled: this.state.busy, onClick: () => this.pay() }, t("Record full test payment and close table"))),
        h('div', { style: { marginTop: 20, display: 'flex', gap: 10 } }, h('button', { onClick: this.props.onClose, disabled: this.state.busy || this.state.uncertain }, d?.id ? t("Close") : t("No, go back")),
          !d?.id && d && h('button', { onClick: () => this.generate(), disabled: this.state.busy }, t("Generate bill")),
          this.state.error && !this.state.uncertain && h('button', { onClick: () => this.review(), disabled: this.state.busy }, t("Review again")))));
  }
}
