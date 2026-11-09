export class BusinessDays extends React.Component {
  constructor(props) { super(props); this.state = { data: null, error: '', busy: false }; }
  componentDidMount() { this.load(); }
  async load() {
    const r = await window.arra.businessDays({ action: 'list' });
    this.setState(r.ok ? { data: r.data, error: '' } : { data: null, error: 'Business days unavailable.' });
  }
  async close(id) {
    if (this.state.busy || !window.confirm('Close this business day? Outstanding orders and print issues remain open.')) return;
    this.setState({ busy: true });
    const r = await window.arra.businessDays({ action: 'close', dayId: id });
    if (r.ok) { await this.load(); if (this.props.onDaysChanged) this.props.onDaysChanged(); }
    else this.setState({ error: 'Could not close this day. Refresh and try again.' });
    this.setState({ busy: false });
  }
  render() {
    const h = React.createElement, data = this.state.data;
    const describe = x => h('div', null,
      h('p', null, 'Open orders: ' + (x.orders.map(o => '#' + o.id + ' (table ' + o.tableId + ')').join(', ') || 'none')),
      h('p', null, 'Unsuccessful or uncertain print jobs: ' + (x.printJobs.map(j => '#' + j.id + ' (' + j.result + ')').join(', ') || 'none')));
    return h('section', null, h('h2', null, 'Business days'), this.state.error && h('p', { role: 'alert' }, this.state.error),
      !data ? h('button', { onClick: () => this.load() }, 'Load business days') : h(React.Fragment, null,
        h('p', null, 'Manual periods for sample data; day boundaries are provisional.'),
        h('h3', null, 'Outstanding now'), describe(data.issues),
        data.days.map(day => h('div', { key: day.id }, h('h3', null, 'Period #' + day.id + (day.closedAt === null ? ' · open' : ' · closed')),
          h('p', null, 'Opened: ' + new Date(day.openedAt).toLocaleString() + (day.closedAt === null ? '' : ' · Closed: ' + new Date(day.closedAt).toLocaleString() + ' · Actor #' + day.closedBy)),
          day.closedAt === null ? h('button', { disabled: this.state.busy, onClick: () => this.close(day.id) }, 'Close business day') : describe(day.issues))),
        h('button', { onClick: () => this.load() }, 'Refresh')));
  }
}
