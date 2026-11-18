import { configText } from './config-i18n.js';
const h = React.createElement;

// This page assigns only pre-upgrade orders that have no recorded waiter.
export class LegacyOrderAssignment extends React.Component {
  constructor(props) {
    super(props);
    this.state = { orders: [], waiters: [], orderId: '', waiterId: '', loading: true, busy: false, pending: null, error: '', notice: '' };
    this.live = true;
    this.submitting = false;
    this.loading = false;
    this.pending = null;
  }
  t(key) { return configText(this.props.language, key); }
  componentDidMount() { this.load(); }
  componentWillUnmount() { this.live = false; }
  leaveEditor() { return !this.submitting && !this.pending; }
  async load(afterSuccess = false) {
    if (this.loading || this.submitting || (!afterSuccess && this.pending)) return;
    this.loading = true;
    this.setState({ loading: true, error: '' });
    try {
      const result = await window.arra.legacyOrderAssignment({ action: 'list' });
      if (!result.ok || !Array.isArray(result.data?.orders) || !Array.isArray(result.data?.waiters)) throw Error();
      if (this.live) this.setState({ orders: result.data.orders, waiters: result.data.waiters, orderId: '', waiterId: '', loading: false });
    } catch (_) {
      if (this.live) this.setState({ orders: [], waiters: [], loading: false, error: this.t('Legacy orders unavailable or access denied.') });
    } finally { this.loading = false; }
  }
  async submit(event) {
    event?.preventDefault();
    if (this.submitting || this.loading || this.state.busy || this.state.loading) return;
    const order = this.state.orders.find(o => o.orderId === Number(this.state.orderId));
    const waiter = this.state.waiters.find(w => w.id === Number(this.state.waiterId));
    const request = this.pending || (order && waiter && { action: 'assign', orderId: order.orderId, waiterId: waiter.id });
    if (!request) { this.setState({ error: this.t('Select an order and a waiter.') }); return; }
    if (!this.pending && !window.confirm(this.t('Assign this existing order to this waiter? This cannot be changed here.') + '\n' + this.t('Table') + ' ' + order.tableId + ' · ' + waiter.name)) return;
    const wasUncertain = Boolean(this.pending);
    this.submitting = true;
    this.pending = request;
    this.setState({ busy: true, pending: request, error: '', notice: '' });
    try {
      const result = await window.arra.legacyOrderAssignment(request);
      if (!this.live) return;
      if (result.ok) {
        this.submitting = false;
        this.pending = null;
        this.setState({ busy: false, pending: null, notice: this.t('Order assigned. The selected waiter can open it.') });
        await this.load(true);
      } else if (result.uncertain || wasUncertain) {
        this.setState({ busy: false, error: this.t('The result is uncertain. Retry the same assignment.') });
      } else {
        this.pending = null;
        this.setState({ busy: false, pending: null, error: this.t('Assignment was rejected. Refresh and check the order.') });
      }
    } catch (_) {
      if (this.live) this.setState({ busy: false, error: this.t('The result is uncertain. Retry the same assignment.') });
    } finally { this.submitting = false; }
  }
  render() {
    const s = this.state, t = key => this.t(key), locked = s.busy || !!s.pending;
    return h('main', { className: 'floor-page' },
      h('button', { type: 'button', onClick: this.props.onBack, disabled: locked }, t('← Back to administration')),
      h('h1', null, t('Assign existing orders')),
      h('p', { className: 'floor-note' }, t('Existing open orders have no reliable assigned waiter. Confirm the waiter with staff before assigning. Each order can be assigned only once; this does not transfer an assigned order.')),
      s.loading && h('p', { role: 'status' }, t('Loading…')),
      s.error && h('p', { role: 'alert' }, s.error), s.notice && h('p', { role: 'status' }, s.notice),
      !s.loading && !s.pending && s.error && h('button', { type: 'button', onClick: () => this.load() }, t('Refresh list')),
      !s.loading && !s.error && !s.orders.length && h('p', { className: 'floor-empty' }, t('No existing orders need assignment.')),
      !s.loading && s.orders.length > 0 && h('form', { className: 'floor-list', onSubmit: e => this.submit(e) },
        h('label', { className: 'floor-field' }, h('span', null, t('Existing order')), h('select', { value: s.orderId, disabled: locked, onChange: e => this.setState({ orderId: e.target.value, error: '', notice: '' }) },
          h('option', { value: '' }, t('Select an order')), s.orders.map(o => h('option', { key: o.orderId, value: String(o.orderId) }, t('Table') + ' ' + o.tableId + ' · #' + o.orderId)))),
        h('label', { className: 'floor-field' }, h('span', null, t('Waiter')), h('select', { value: s.waiterId, disabled: locked, onChange: e => this.setState({ waiterId: e.target.value, error: '', notice: '' }) },
          h('option', { value: '' }, t('Select a waiter')), s.waiters.map(w => h('option', { key: w.id, value: String(w.id) }, w.name)))),
        !s.waiters.length && h('p', null, t('No eligible active waiters are available.')),
        h('button', { type: 'submit', className: 'floor-primary', disabled: s.busy }, s.pending ? t('Retry same assignment') : t('Assign order'))));
  }
}
