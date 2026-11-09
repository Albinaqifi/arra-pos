export class OrderHistory extends React.Component {
  constructor(props) { super(props); this.state = { orders: [], data: null, error: '' }; }
  componentDidMount() { this.load(null); }
  async load(id) {
    const r = await window.arra.orderHistory(id);
    if (!r.ok) return this.setState({ error: 'History unavailable. Sign in as an authorized administrator and select your own name.', data: null });
    this.setState(id === null ? { orders: r.data.orders, data: null, error: '' } : { data: r.data, error: '' });
  }
  render() {
    const h = React.createElement, d = this.state.data;
    return h('main', { style: { padding: 24, height: '100vh', overflow: 'auto', boxSizing: 'border-box' } },
      h('button', { onClick: this.props.onBack }, 'Back to administration'), h('h1', null, 'Order history'),
      h('p', null, 'Operational history excludes prices and payment information.'),
      this.state.error && h('p', { role: 'alert' }, this.state.error),
      d ? h('div', null, h('button', { onClick: () => this.load(null) }, 'All orders'),
        h('h2', null, 'Order #' + d.order.id + ' · Table ' + d.order.tableId + ' · ' + d.order.status),
        h('p', null, 'Opened ' + new Date(d.order.openedAt).toLocaleString()),
        h('h3', null, 'Current items'), d.items.length ? h('ul', null, d.items.map(i => h('li', { key: i.id }, '#' + i.id + ' · ' + i.name + ' × ' + i.quantity + ' · ' + i.status))) : h('p', null, 'No current items.'),
        h('h3', null, 'Activity'), d.events.length ? h('ol', null, d.events.map(e => h('li', { key: e.id }, new Date(e.occurredAt).toLocaleString() + ' · ' + e.actor + ' · ' + e.action + ' · ' + Object.entries(e).filter(([k]) => !['id','occurredAt','actor','action'].includes(k)).map(([k,v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join(' · '), e.orderId !== d.order.id && h('button', { onClick: () => this.load(e.orderId) }, 'View order #' + e.orderId)))) : h('p', null, 'No activity recorded.')) :
        (this.state.orders.length ? h('ul', null, this.state.orders.map(o => h('li', { key: o.id }, h('button', { onClick: () => this.load(o.id) }, 'Order #' + o.id + ' · Table ' + o.tableId + ' · ' + o.status + ' · ' + new Date(o.openedAt).toLocaleString())))) : !this.state.error && h('p', null, 'No orders recorded.')));
  }
}
