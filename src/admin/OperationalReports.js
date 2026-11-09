export class OperationalReports extends React.Component {
  constructor(props) { super(props); this.state = { from:'', to:'', data:null, error:'', busy:false }; }
  async load(e) {
    e.preventDefault();
    const from = new Date(this.state.from + 'T00:00:00').getTime();
    const end = new Date(this.state.to + 'T00:00:00'); end.setDate(end.getDate() + 1);
    const to = end.getTime();
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to) return this.setState({ data:null, error:'Choose a valid date range.' });
    this.setState({ busy:true, data:null, error:'' });
    const r = await window.arra.operationalReports({ from, to, account:null });
    this.setState(r.ok ? { data:r.data, error:'', busy:false } : { data:null, error:'Report unavailable.', busy:false });
  }
  render() {
    const h = React.createElement, d = this.state.data;
    const list = (rows, format) => rows.length ? h('ul', null, rows.map((row, i) => h('li', {key:i}, format(row)))) : h('p', null, 'No records in this period.');
    return h('main', {style:{padding:24, height:'100vh', overflow:'auto'}},
      h('button', {onClick:this.props.onBack}, 'Back to administration'), h('h1', null, 'Operational reports'),
      h('p', null, 'Provisional: paid bills only, by local payment date and your financial scope. Values are bill snapshot amounts in minor units. Products are grouped by ID and show their latest paid snapshot name in the period. Unpaid orders are excluded.'),
      h('p', null, 'Table usage counts the table on the paid order; moved tables are not attributed to earlier tables. Waiter activity counts the person who recorded payment, not every contributing waiter. Definitions are provisional.'),
      h('form', {onSubmit:e => this.load(e)}, h('label', null, 'From ', h('input', {type:'date', required:true, disabled:this.state.busy, value:this.state.from, onChange:e => this.setState({from:e.target.value, data:null})})), ' ',
        h('label', null, 'Through ', h('input', {type:'date', required:true, disabled:this.state.busy, value:this.state.to, onChange:e => this.setState({to:e.target.value, data:null})})), ' ', h('button', {disabled:this.state.busy}, 'Show report')),
      this.state.error && h('p', {role:'alert'}, this.state.error, ' Check your access or sign in and select your own name.'), d && h('div', null,
        h('h2', null, 'Products'), list(d.products, r => r.name + ' (ID: ' + r.productId + ') · quantity ' + r.quantity + ' · value ' + r.value),
        h('h2', null, 'Tables'), list(d.tables, r => 'Table ' + r.tableId + ' · paid orders ' + r.count),
        h('h2', null, 'Waiters'), list(d.waiters, r => r.actor + ' · payments recorded ' + r.count)));
  }
}
