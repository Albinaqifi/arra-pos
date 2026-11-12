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
    else this.setState({ busy: false, uncertain: this.state.uncertain || !!r.uncertain, error: r.error || 'Payment unavailable. Retry the same selection.' });
  }
  async printTestBill() {
    if (this.state.busy || !this.state.data?.id || !window.arra.testPrinting) return;
    this.printToken = this.printToken || crypto.randomUUID();
    this.setState({busy:true,error:''});
    const r = await window.arra.testPrinting({action:'bill',billId:this.state.data.id,requestId:this.printToken});
    this.setState({busy:false, printNotice:r.ok ? 'Test print submitted. Check the printer and paper; queue acceptance is not proof of printing. Use the test jobs list to retry.' : 'Test print status unavailable. Check paper and the test jobs list before retrying.'});
  }
  render() {
    const h = React.createElement, d = this.state.data;
    const money = value => Math.round(value).toLocaleString('en-US') + ' den';
    return h('div', { role: 'dialog', 'aria-label': 'Bill review', style: { position: 'fixed', inset: 0, zIndex: 1000, background: '#0008', display: 'flex', justifyContent: 'center', alignItems: 'center' } },
      h('div', { style: { background: 'white', padding: 28, borderRadius: 20, maxHeight: '90vh', overflow: 'auto', width: 600 } },
        h('h2', null, d?.id ? 'Bill generated #' + d.id : 'Review bill'),
        h('p', null, d?.id ? 'Test mode only. No card terminal is connected. Confirm the separate payment before recording it.' : 'Check the items before generating the bill.'),
        this.state.error && h('p', { role: 'alert' }, this.state.error),
        this.state.uncertain && h('p', null, 'The POS payment result is uncertain. Retry the same selection to recover the result; do not repeat the separate terminal payment.'),
        d && h(React.Fragment, null, h('ul', null, d.lines.map(l => h('li', { key: l.itemId }, l.quantity + ' × ' + l.name + ' · ' + money(l.quantity * l.unitPrice), l.modifiers.length > 0 && h('div', null, l.modifiers.map(m => m.groupName + ': ' + m.optionName + ' (' + m.adjustment + ')').join(', '))))), h('strong', null, 'Total: ' + money(d.total))),
        d?.id && h('div', null,
          h('button',{disabled:this.state.busy || !window.arra.testPrinting,onClick:()=>this.printTestBill()},'Print test bill — not a fiscal receipt'),
          this.state.printNotice && h('p',{role:'status'},this.state.printNotice),
          h('p', null, 'Choose payment method and account:'),
          h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ method: 'cash', account: '' }) }, 'Cash'), ' ',
          h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ method: 'card', account: 'A' }) }, 'Card (Account A)'),
          this.state.method === 'cash' && h('div', null, h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ account: 'A' }) }, 'Account A'), ' ', h('button', { disabled: this.state.busy || this.state.uncertain, onClick: () => this.setState({ account: 'B' }) }, 'Account B')),
          this.state.account && h('p', null, 'Selected: ' + this.state.method + ' · Account ' + this.state.account),
          this.state.account && h('button', { disabled: this.state.busy, onClick: () => this.pay() }, 'Record full test payment and close table')),
        h('div', { style: { marginTop: 20, display: 'flex', gap: 10 } }, h('button', { onClick: this.props.onClose, disabled: this.state.busy || this.state.uncertain }, d?.id ? 'Close' : 'No, go back'),
          !d?.id && d && h('button', { onClick: () => this.generate(), disabled: this.state.busy }, 'Generate bill'),
          this.state.error && !this.state.uncertain && h('button', { onClick: () => this.review(), disabled: this.state.busy }, 'Review again'))));
  }
}
