class OperationalReports extends React.Component {
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
class TransferCorrection extends React.Component {
  constructor(props) { super(props); this.state = { records: null, table: null, reason: '', error: '', busy: false }; }
  componentDidMount() { this.load(); }
  async load() { const r = await window.arra.transferCorrection({action:'list'}); this.setState(r.ok ? {records:r.data.payments, tables:r.data.tables, error:''} : {records:null,error:'Eligible payments unavailable.'}); }
  async correct(id) {
    if (this.state.busy || !window.confirm('Correct this cash payment from Account B to Account A?')) return;
    this.setState({busy:true});
    const r = await window.arra.transferCorrection({action:'correct',paymentId:id,reason:this.state.reason});
    if (r.ok) { this.setState({reason:'',error:''}); await this.load(); }
    else { await this.load(); this.setState({error:'Correction was not confirmed. Refresh the list before trying again.'}); }
    this.setState({busy:false});
  }
  render() {
    const h=React.createElement, rows=this.state.records, table=this.state.table;
    return h('main',{style:{padding:24,overflow:'auto',height:'100vh'}},h('button',{onClick:this.props.onBack},'Switch user'),h('h1',null,'Transfer Manager'),h('p',null,'Eligible cash payments in the open business period.'),this.state.error && h('p',{role:'alert'},this.state.error),
      rows && table === null ? h(React.Fragment,null,h('h2',null,'Tables'),this.state.tables.map(t=>h('button',{key:t.id,onClick:()=>this.setState({table:t.id})},'Table '+t.id+' · '+t.area+(t.active ? '' : ' · inactive'))),!this.state.tables.length && h('p',null,'No tables.')) : null,
      rows && table !== null ? h(React.Fragment,null,h('button',{onClick:()=>this.setState({table:null})},'All tables'),h('h2',null,'Table '+table),h('label',null,'Reason (optional)',h('input',{value:this.state.reason,maxLength:500,onChange:e=>this.setState({reason:e.target.value})})),!rows.some(x=>x.tableId===table) && h('p',null,'No eligible payments for this table.'),rows.filter(x=>x.tableId===table).map(p=>h('div',{key:p.id},'Payment #'+p.id+' · '+p.amount+' · '+new Date(p.paidAt).toLocaleString()+' ',h('button',{disabled:this.state.busy,onClick:()=>this.correct(p.id)},'Correct B to A')))) : null,h('button',{onClick:()=>this.load()},'Refresh'));
  }
}
class BusinessDays extends React.Component {
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
class SalesReports extends React.Component {
  constructor(props) { super(props); this.state = { days:[], period:'date', dayId:'', from:'', to:'', account:'', method:'', data:null, error:'', busy:false }; }
  async componentDidMount() {
    const r = await window.arra.financialVisibility({action:'reportDays'});
    this.setState(r.ok ? {days:r.data} : {error:'Business days unavailable.'});
  }
  async load(e) {
    e.preventDefault();
    let from = null, to = null, dayId = null;
    if (this.state.period === 'day') {
      dayId = Number(this.state.dayId);
      if (!Number.isSafeInteger(dayId) || dayId <= 0) return this.setState({data:null,error:'Choose a business day.'});
    } else {
      from = new Date(this.state.from + 'T00:00:00').getTime();
      const end = new Date(this.state.to + 'T00:00:00'); end.setDate(end.getDate() + 1); to = end.getTime();
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to) return this.setState({data:null,error:'Choose a valid date range.'});
    }
    this.setState({busy:true,data:null,error:''});
    const r = await window.arra.financialVisibility({action:'report',from,to,dayId,account:this.state.account || null,method:this.state.method || null});
    this.setState(r.ok ? {busy:false,data:r.data,error:''} : {busy:false,data:null,error:'Report unavailable or account outside your scope.'});
  }
  render() {
    const h=React.createElement, s=this.state;
    const select = (name, options) => h('select', {value:s[name],disabled:s.busy,onChange:e=>this.setState({[name]:e.target.value,data:null})}, options.map(([value,label])=>h('option',{key:value,value},label)));
    return h('section', null, h('h2',null,'Sales and payment report'),
      h('p',null,'Provisional: recorded payments by payment date or assigned business day, effective account and method. Amounts are in minor units. Corrections below relate to the selected payments and do not add sales. Accounting definitions are not final.'),
      h('form',{onSubmit:e=>this.load(e)},
        h('label',null,'Period ',select('period',[['date','Payment date'],['day','Business day']])), ' ',
        s.period === 'date' ? h(React.Fragment,null,h('label',null,'From ',h('input',{type:'date',value:s.from,disabled:s.busy,onChange:e=>this.setState({from:e.target.value,data:null})})), ' ',h('label',null,'Through ',h('input',{type:'date',value:s.to,disabled:s.busy,onChange:e=>this.setState({to:e.target.value,data:null})}))) : h('label',null,'Business day ',select('dayId',[['','Choose'],...s.days.map(d=>[String(d.id),'#'+d.id+' · '+new Date(d.openedAt).toLocaleString()+(d.closedAt===null?' · open':' · closed')])])), ' ',
        h('label',null,'Account ',select('account',[['','Allowed scope'],['A','A'],['B','B']])), ' ',h('label',null,'Method ',select('method',[['','All'],['cash','Cash'],['card','Card']])), ' ',h('button',{disabled:s.busy},'Show sales report')),
      s.error && h('p',{role:'alert'},s.error), s.data && h(React.Fragment,null,
        h('h3',null,'Sales by effective account and method'),s.data.groups.length ? h('ul',null,s.data.groups.map(g=>h('li',{key:g.account+g.method},g.account+' · '+g.method+' · '+g.count+' payments · '+g.total))) : h('p',null,'No payments in this selection.'),
        h('h3',null,'Payment records'),s.data.records.length ? h('ul',null,s.data.records.map(p=>h('li',{key:p.id},'Payment #'+p.id+' · Bill #'+p.billId+' · Day #'+p.dayId+' · '+new Date(p.paidAt).toLocaleString()+' · '+p.account+' · '+p.method+' · '+p.amount))) : h('p',null,'No payment records.'),
        h('h3',null,'Account corrections'),s.data.corrections.length ? h('ul',null,s.data.corrections.map(c=>h('li',{key:c.id},'Correction #'+c.id+' · Payment #'+c.paymentId+' · B to A · '+c.amount+' · Actor #'+c.actorId+' · '+new Date(c.occurredAt).toLocaleString()+' · Reason: '+(c.reason || 'none')))) : h('p',null,'No corrections for selected payments.')));
  }
}
class FinancialVisibility extends React.Component {
  constructor(props) { super(props); this.state = { records: [], unpaid: null, totals: null, detail: null, error: '', dayRevision: 0 }; }
  componentDidMount() { this.load(); }
  async load() {
    const [records, totals, unpaid] = await Promise.all([
      window.arra.financialVisibility({ action: 'search', account: null }),
      window.arra.financialVisibility({ action: 'aggregate', account: null }),
      window.arra.financialVisibility({ action: 'unpaid' })
    ]);
    if (!records.ok || !totals.ok || !unpaid.ok) return this.setState({ records: [], unpaid: null, totals: null, detail: null, error: 'Financial information unavailable.' });
    this.setState({ records: records.data, unpaid: unpaid.ok ? unpaid.data : null, totals: totals.data, detail: null, error: '' });
  }
  async detail(paymentId) {
    const r = await window.arra.financialVisibility({ action: 'detail', paymentId });
    this.setState(r.ok ? { detail: r.data, error: '' } : { detail: null, error: 'Payment unavailable.' });
  }
  async unpaidDetail(billId) {
    const r = await window.arra.financialVisibility({ action: 'unpaidDetail', billId });
    this.setState(r.ok ? { detail: r.data, error: '' } : { detail: null, error: 'Bill unavailable.' });
  }
  render() {
    const h = React.createElement, d = this.state.detail;
    return h('main', { style: { padding: 24, height: '100vh', overflow: 'auto' } },
      h('button', { onClick: this.props.onBack }, 'Back to administration'), h('h1', null, 'Financial information'),
      h('p', null, 'Sample payments only.'), h(SalesReports, { key: this.state.dayRevision }), h(BusinessDays, { onDaysChanged: () => this.setState({ dayRevision: this.state.dayRevision + 1 }) }), this.state.error && h('p', { role: 'alert' }, this.state.error),
      this.state.totals && h('p', null, 'Payments: ' + this.state.totals.count + ' · Total: ' + this.state.totals.total),
      d ? h('div', null, h('button', { onClick: () => this.load() }, 'All history'),
        h('h2', null, 'Bill #' + d.bill.id + (d.payment ? ' · Payment #' + d.payment.id : ' · Unpaid')),
        h('p', null, 'Order #' + d.bill.orderId + ' · Table ' + d.bill.tableId + ' · Opened ' + new Date(d.bill.openedAt).toLocaleString()),
        h('p', null, 'Bill generated by actor #' + d.bill.actorId + ' · ' + new Date(d.bill.generatedAt).toLocaleString() + ' · Total ' + d.bill.total),
        d.payment && h('p', null, 'Payment by actor #' + d.payment.actorId + ' · ' + new Date(d.payment.paidAt).toLocaleString() + ' · ' + d.payment.method + ' · ' + d.payment.amount + ' · Original account ' + d.payment.originalAccount + ' · Effective account ' + d.payment.account),
        d.payment && (d.corrections.length ? d.corrections.map(c => h('p', { key: c.id }, 'Correction #' + c.id + ' · ' + c.fromAccount + ' to ' + c.toAccount + ' · Actor #' + c.actorId + ' · ' + new Date(c.occurredAt).toLocaleString() + ' · Reason: ' + (c.reason || 'none'))) : h('p', null, 'No account corrections.')),
        h('ul', null, d.lines.map((line, i) => h('li', { key: i }, line.quantity + ' × ' + line.name + ' · ' + line.unitPrice)))) :
        h(React.Fragment, null,
          this.state.records.length ? h('ul', null, this.state.records.map(p => h('li', { key: p.id }, h('button', { onClick: () => this.detail(p.id) }, '#' + p.id + ' · ' + p.account + ' · ' + p.amount)))) : !this.state.error && h('p', null, 'No payments.'),
          this.state.unpaid && h('section', null, h('h2', null, 'Unpaid bills (unclassified)'), this.state.unpaid.length ? h('ul', null, this.state.unpaid.map(b => h('li', { key: b.id }, h('button', { onClick: () => this.unpaidDetail(b.id) }, 'Bill #' + b.id + ' · Order #' + b.orderId + ' · ' + b.total)))) : h('p', null, 'No unpaid bills.'))));
  }
}
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
  render() {
    const h = React.createElement, d = this.state.data;
    const money = value => Math.round(value).toLocaleString('en-US') + ' den';
    return h('div', { role: 'dialog', 'aria-label': 'Bill review', style: { position: 'fixed', inset: 0, zIndex: 1000, background: '#0008', display: 'flex', justifyContent: 'center', alignItems: 'center' } },
      h('div', { style: { background: 'white', padding: 28, borderRadius: 20, maxHeight: '90vh', overflow: 'auto', width: 600 } },
        h('h2', null, d?.id ? 'Bill generated #' + d.id : 'Review bill'),
        h('p', null, d?.id ? 'Test mode only. No bill is printed and no card terminal is connected. Confirm the separate payment before recording it.' : 'Check the items before generating the bill.'),
        this.state.error && h('p', { role: 'alert' }, this.state.error),
        d && h(React.Fragment, null, h('ul', null, d.lines.map(l => h('li', { key: l.itemId }, l.quantity + ' × ' + l.name + ' · ' + money(l.quantity * l.unitPrice), l.modifiers.length > 0 && h('div', null, l.modifiers.map(m => m.groupName + ': ' + m.optionName + ' (' + m.adjustment + ')').join(', '))))), h('strong', null, 'Total: ' + money(d.total))),
        d?.id && h('div', null,
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
class OrderHistory extends React.Component {
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
class EmployeeConfig extends React.Component {
  constructor(props) { super(props); this.state = { users: [], grants: [], audit: [], credentialAudit: [], accountAudit: [], permissions: [], selected: null, error: '', access: null }; }
  componentDidMount() { this.load(); }
  async load() {
    const r = await window.arra.employeeConfig({ action: 'list' });
    if (r.ok) this.setState({ ...r.data, error: '', access: true }); else this.setState({ error: r.error || 'Employees unavailable', access: false });
  }
  async save(request) {
    const r = await window.arra.employeeConfig(request);
    if (r.ok) await this.load(); else this.setState({ error: r.error || 'Could not save' });
  }
  render() {
    const h = React.createElement, selected = this.state.users.find(u => u.id === this.state.selected);
    if (this.state.access !== true) return h('main', null, h('button', {onClick:this.props.onBack}, 'Back to administration'), h('h1', null, 'Employees and permissions'), this.state.access === null ? h('p', {role:'status'}, 'Loading employees…') : h('p', {role:'alert'}, this.state.error, ' Sign in with your own administrator account and select your own name.'));
    const granted = selected ? this.state.grants.filter(g => g.userId === selected.id).map(g => g.permission) : [];
    const submit = fn => e => { e.preventDefault(); fn(e.currentTarget); };
    return h('main', { style: { padding: 24, overflow: 'auto', height: '100vh', boxSizing: 'border-box' } },
      h('button', { onClick: this.props.onBack }, 'Back to administration'), h('h1', null, 'Employees and permissions'),
      h('p', null, 'Sign in with your own administrator password and select your own name to manage employees. Financial access is not configurable here.'),
      this.state.error && h('p', { role: 'alert' }, this.state.error),
      h('h2', null, 'Create employee'),
      h('form', { onSubmit: submit(form => { const request = { action: 'create', username: form.elements.username.value, password: form.elements.password.value, pin: form.elements.pin.value }; form.reset(); this.save(request); }) },
        h('label', null, 'Name ', h('input', { name: 'username', required: true, maxLength: 128 })), ' ',
        h('label', null, 'Password ', h('input', { name: 'password', type: 'password', required: true, autoComplete: 'new-password' })), ' ',
        h('label', null, 'Optional 4-digit PIN ', h('input', { name: 'pin', type: 'password', pattern: '[0-9]{4}', maxLength: 4, autoComplete: 'new-password' })), ' ', h('button', null, 'Create')),
      h('h2', null, 'Select employee'),
      h('select', { value: this.state.selected || '', onChange: e => this.setState({ selected: Number(e.target.value) || null }) },
        h('option', { value: '' }, 'Choose an employee'), this.state.users.map(u => h('option', { key: u.id, value: u.id }, u.username + (u.active ? '' : ' (inactive)')))),
      selected && h('div', { key: selected.id },
        h('h2', null, selected.username),
        h('form', { onSubmit: submit(form => this.save({ action: 'account', id: selected.id, username: form.elements.username.value, active: form.elements.active.checked })) },
          h('label', null, 'Name ', h('input', { name: 'username', defaultValue: selected.username, required: true, maxLength: 128 })), ' ',
          h('label', null, h('input', { type: 'checkbox', name: 'active', defaultChecked: !!selected.active }), ' Active'), ' ', h('button', null, 'Save account')),
        h('h3', null, 'Reset credentials'), h('p', null, 'Leave a field blank to keep it. Use Remove PIN to allow selection without one.'),
        h('form', { onSubmit: submit(form => { const password = form.elements.password.value; const pin = form.elements.removePin.checked ? '' : form.elements.pin.value || null; const request = { action: 'credential', id: selected.id, password: password || null, pin }; form.reset(); this.save(request); }) },
          h('label', null, 'New password ', h('input', { type: 'password', name: 'password', autoComplete: 'new-password' })), ' ',
          h('label', null, 'New 4-digit PIN ', h('input', { type: 'password', name: 'pin', pattern: '[0-9]{4}', maxLength: 4, autoComplete: 'new-password' })), ' ',
          h('label', null, h('input', { type: 'checkbox', name: 'removePin' }), ' Remove PIN'), ' ', h('button', null, 'Reset credentials')),
        h('h3', null, 'Granted actions'),
        h('form', { key: selected.id + ':' + granted.join(','), onSubmit: submit(form => this.save({ action: 'permissions', id: selected.id, permissions: this.state.permissions.filter(p => form.elements[p].checked) })) },
          this.state.permissions.map(p => h('label', { key: p, style: { display: 'block' } }, h('input', { type: 'checkbox', name: p, defaultChecked: granted.includes(p) }), ' ', p)), h('button', null, 'Save permissions'))),
      h('h2', null, 'Recent permission changes'),
      this.state.audit.length ? h('ul', null, this.state.audit.map((a, i) => h('li', { key: i }, new Date(a.occurredAt).toLocaleString() + ' · ' + ((this.state.users.find(u => u.id === a.actorId)?.username || 'Unknown') + ' #' + a.actorId) + ' → ' + ((this.state.users.find(u => u.id === a.targetId)?.username || 'Unknown') + ' #' + a.targetId) + ' · ' + a.permission + (a.granted ? ' granted' : ' revoked')))) : h('p', null, 'No permission changes recorded.'),
      h('h2', null, 'Recent credential resets'),
      this.state.credentialAudit.length ? h('ul', null, this.state.credentialAudit.map((a, i) => h('li', { key: i }, new Date(a.occurredAt).toLocaleString() + ' · ' + ((this.state.users.find(u => u.id === a.actorId)?.username || 'Unknown') + ' #' + a.actorId) + ' → ' + ((this.state.users.find(u => u.id === a.targetId)?.username || 'Unknown') + ' #' + a.targetId) + ' · ' + (a.passwordChanged ? 'Password ' : '') + (a.pinChanged ? 'PIN ' : '') + 'reset'))) : h('p', null, 'No credential resets recorded.'),
      h('h2', null, 'Recent account changes'),
      this.state.accountAudit.length ? h('ul', null, this.state.accountAudit.map((a, i) => h('li', { key: i }, new Date(a.occurredAt).toLocaleString() + ' · actor #' + a.actorId + ' → employee #' + a.targetId + ' · ' + a.oldUsername + ' → ' + a.newUsername + ' · ' + (a.oldActive ? 'active' : 'inactive') + ' → ' + (a.newActive ? 'active' : 'inactive')))) : h('p', null, 'No account changes recorded.'));
  }
}

// Convert the design's CSS declarations to React's style object.
function style(text) {
  const result = {};
  for (const declaration of (text || '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (name) result[name] = declaration.slice(colon + 1).trim();
  }
  return result;
}

class TableConfig extends React.Component {
  constructor(props) { super(props); this.state = { areas: [], tables: [], error: '', area: '', table: '', areaId: '', capacity: '4', access: null }; }
  componentDidMount() { this.load(); }
  async load() {
    const r = await window.arra.tableConfig({ action: 'list' });
    if (r.ok) this.setState({ ...r.data, error: '', access: true }); else this.setState({ error: r.error || 'Areas and tables unavailable.', access: false });
  }
  async save(request) {
    const r = await window.arra.tableConfig(request);
    if (!r.ok) this.setState({ error: r.error }); else await this.load();
  }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return h('main', null, h('button', {onClick:this.props.onBack}, 'Back to administration'), h('h1', null, 'Areas and tables'), s.access === null ? h('p', {role:'status'}, 'Loading areas and tables…') : h('p', {role:'alert'}, s.error, ' Check your access or sign in and select your own name.'));
    const input = (label, value, change, type = 'text') => h('label', null, label, ' ', h('input', { type, value, onChange: e => change(e.target.value) }));
    const areaSelect = (value, change) => h('label', null, 'Area ', h('select', { value, onChange: e => change(Number(e.target.value)) }, h('option', { value: '' }, 'Choose'), ...s.areas.filter(a => a.active || a.id === Number(value)).map(a => h('option', { key: a.id, value: a.id }, a.name))));
    return h('main', { style: { padding: 24, overflow: 'auto', fontFamily: 'system-ui' } },
      h('button', { onClick: this.props.onBack }, 'Back to administration'), h('h1', null, 'Areas and tables'),
      h('p', null, 'Tables or areas with open orders cannot be deactivated. Table numbers remain stable.'),
      s.error && h('p', { role: 'alert' }, s.error),
      h('h2', null, 'Areas'), ...s.areas.map(a => h('div', { key: a.id, style: { marginBottom: 8 } },
        input('Name', a.name, value => this.setState({ areas: s.areas.map(x => x.id === a.id ? { ...x, name: value } : x) })), ' ',
        h('label', null, h('input', { type: 'checkbox', checked: !!a.active, onChange: e => this.setState({ areas: s.areas.map(x => x.id === a.id ? { ...x, active: Number(e.target.checked) } : x) }) }), ' Active'), ' ',
        h('button', { onClick: () => this.save({ action: 'area', id: a.id, name: a.name.trim(), active: !!a.active }) }, 'Save area'))),
      input('New area', s.area, value => this.setState({ area: value })), ' ', h('button', { onClick: () => this.save({ action: 'area', id: null, name: s.area.trim(), active: true }) }, 'Add area'),
      h('h2', null, 'Tables'), ...s.tables.map(t => h('div', { key: t.id, style: { marginBottom: 8 } },
        h('strong', null, 'Table ' + t.id + (t.hasOrder ? ' (open order)' : '')), ' ', areaSelect(t.areaId, value => this.setState({ tables: s.tables.map(x => x.id === t.id ? { ...x, areaId: value } : x) })), ' ',
        input('Capacity', t.capacity, value => this.setState({ tables: s.tables.map(x => x.id === t.id ? { ...x, capacity: value } : x) }), 'number'), ' ',
        h('label', null, h('input', { type: 'checkbox', checked: !!t.active, onChange: e => this.setState({ tables: s.tables.map(x => x.id === t.id ? { ...x, active: Number(e.target.checked) } : x) }) }), ' Active'), ' ',
        h('button', { onClick: () => this.save({ action: 'table', create: false, id: t.id, areaId: Number(t.areaId), capacity: Number(t.capacity), active: !!t.active }) }, 'Save table'))),
      input('New table number', s.table, value => this.setState({ table: value }), 'number'), ' ', areaSelect(s.areaId, value => this.setState({ areaId: value })), ' ',
      input('Capacity', s.capacity, value => this.setState({ capacity: value }), 'number'), ' ', h('button', { onClick: () => this.save({ action: 'table', create: true, id: Number(s.table), areaId: Number(s.areaId), capacity: Number(s.capacity), active: true }) }, 'Add table'));
  }
}

class MenuConfig extends React.Component {
  constructor(props) { super(props); this.state = { categories: [], products: [], groups: [], options: [], error: '', newCategory: '', newProduct: '', categoryId: '', price: '0', groupName: '', groupProduct: '', optionName: '', optionGroup: '', adjustment: '0', access: null }; }
  componentDidMount() { this.load(); }
  async load() { const r = await window.arra.menuConfig({ action: 'list' }); if (r.ok) this.setState({ ...r.data, error: '', access: true }); else this.setState({ error: r.error || 'Menu unavailable.', access: false }); }
  async save(request) { const r = await window.arra.menuConfig(request); if (r.ok) await this.load(); else this.setState({ error: r.error }); }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return h('main', null, h('button', {onClick:this.props.onBack}, 'Back to administration'), h('h1', null, 'Menu management'), s.access === null ? h('p', {role:'status'}, 'Loading menu…') : h('p', {role:'alert'}, s.error, ' Check your access or sign in and select your own name.'));
    const numeric = value => String(value).trim() === '' ? NaN : Number(value);
    const update = (list, id, field, value) => this.setState({ [list]: s[list].map(x => x.id === id ? { ...x, [field]: value } : x) });
    const field = (label, value, change, type = 'text') => h('label', null, label, ' ', h('input', { type, value, onChange: e => change(e.target.value) }));
    const active = (checked, change) => h('label', null, h('input', { type: 'checkbox', checked: !!checked, onChange: e => change(e.target.checked) }), ' Active');
    const categorySelect = (value, change, choices, none) => h('label', null, none ? 'Parent ' : 'Category ', h('select', { value: value || '', onChange: e => change(e.target.value || null) }, h('option', { value: '' }, none ? 'None' : 'Choose'), ...choices.map(c => h('option', { key: c.id, value: c.id }, c.name))));
    return h('main', { style: { padding: 24, overflow: 'auto', fontFamily: 'system-ui' } }, h('button', { onClick: this.props.onBack }, 'Back to administration'), h('h1', null, 'Menu management'),
      h('p', null, 'Order values determine display order. Inactive categories hide their products and subcategories.'), s.error && h('p', { role: 'alert' }, s.error),
      h('h2', null, 'Categories'), ...s.categories.map(c => h('div', { key: c.id, style: { marginBottom: 8 } },
        field('Name', c.name, v => update('categories', c.id, 'name', v)), ' ', categorySelect(c.parentId, v => update('categories', c.id, 'parentId', v), s.categories.filter(x => x.id !== c.id && !x.parentId), true), ' ',
        field('Order', c.sortOrder, v => update('categories', c.id, 'sortOrder', v), 'number'), ' ', active(c.active, v => update('categories', c.id, 'active', v)), ' ',
        h('button', { onClick: () => this.save({ action: 'category', id: c.id, name: c.name.trim(), parentId: c.parentId, sortOrder: numeric(c.sortOrder), active: !!c.active }) }, 'Save category'))),
      field('New category', s.newCategory, v => this.setState({ newCategory: v })), ' ', h('button', { onClick: () => this.save({ action: 'category', id: null, name: s.newCategory.trim(), parentId: null, sortOrder: s.categories.length, active: true }) }, 'Add category'),
      h('h2', null, 'Products'), ...s.products.map(p => h('div', { key: p.id, style: { marginBottom: 8 } }, field('Name', p.name, v => update('products', p.id, 'name', v)), ' ', categorySelect(p.categoryId, v => update('products', p.id, 'categoryId', v), s.categories, false), ' ',
        h('label', null, 'Destination ', h('select', { value: p.destination || 'kitchen', onChange: e => update('products', p.id, 'destination', e.target.value) }, h('option', { value: 'kitchen' }, 'Kitchen'), h('option', { value: 'bar' }, 'Bar'))), ' ', field('Price', p.price, v => update('products', p.id, 'price', v), 'number'), ' ', field('Order', p.sortOrder, v => update('products', p.id, 'sortOrder', v), 'number'), ' ', active(p.active, v => update('products', p.id, 'active', v)), ' ',
        h('button', { onClick: () => this.save({ action: 'product', id: p.id, categoryId: p.categoryId, name: p.name.trim(), price: numeric(p.price), sortOrder: numeric(p.sortOrder), active: !!p.active, destination: p.destination || 'kitchen' }) }, 'Save product'))),
      field('New product', s.newProduct, v => this.setState({ newProduct: v })), ' ', categorySelect(s.categoryId, v => this.setState({ categoryId: v }), s.categories, false), ' ', field('Price', s.price, v => this.setState({ price: v }), 'number'), ' ',
      h('button', { onClick: () => this.save({ action: 'product', id: null, categoryId: s.categoryId, name: s.newProduct.trim(), price: numeric(s.price), sortOrder: s.products.length, active: true }) }, 'Add product'),
      h('h2', null, 'Modifier groups'), h('p', null, 'Choose at most one option per group. Required groups need one choice.'),
      ...s.groups.map(g => h('div', { key: g.id }, h('strong', null, s.products.find(p => p.id === g.productId)?.name, ' '), field('Group', g.name, v => update('groups', g.id, 'name', v)), ' ', h('label', null, h('input', { type: 'checkbox', checked: !!g.required, onChange: e => update('groups', g.id, 'required', e.target.checked) }), ' Required'), ' ', active(g.active, v => update('groups', g.id, 'active', v)), ' ', h('button', { onClick: () => this.save({ action: 'group', id: g.id, productId: g.productId, name: g.name.trim(), required: !!g.required, active: !!g.active }) }, 'Save group'))),
      field('New group', s.groupName, v => this.setState({ groupName: v })), ' ', h('select', { value: s.groupProduct, onChange: e => this.setState({ groupProduct: e.target.value }) }, h('option', { value: '' }, 'Choose product'), ...s.products.map(p => h('option', { key: p.id, value: p.id }, p.name))), ' ', h('button', { onClick: () => this.save({ action: 'group', id: null, productId: s.groupProduct, name: s.groupName.trim(), required: false, active: true }) }, 'Add group'),
      h('h2', null, 'Modifier options'), ...s.options.map(o => h('div', { key: o.id }, h('strong', null, s.groups.find(g => g.id === o.groupId)?.name, ' '), field('Option', o.name, v => update('options', o.id, 'name', v)), ' ', field('Adjustment', o.adjustment, v => update('options', o.id, 'adjustment', v), 'number'), ' ', active(o.active, v => update('options', o.id, 'active', v)), ' ', h('button', { onClick: () => this.save({ action: 'option', id: o.id, groupId: o.groupId, name: o.name.trim(), adjustment: numeric(o.adjustment), active: !!o.active }) }, 'Save option'))),
      field('New option', s.optionName, v => this.setState({ optionName: v })), ' ', h('select', { value: s.optionGroup, onChange: e => this.setState({ optionGroup: e.target.value }) }, h('option', { value: '' }, 'Choose group'), ...s.groups.map(g => h('option', { key: g.id, value: g.id }, (s.products.find(p => p.id === g.productId)?.name || '') + ' / ' + g.name))), ' ', field('Adjustment', s.adjustment, v => this.setState({ adjustment: v }), 'number'), ' ', h('button', { onClick: () => this.save({ action: 'option', id: null, groupId: s.optionGroup, name: s.optionName.trim(), adjustment: numeric(s.adjustment), active: true }) }, 'Add option'));
  }
}

class PrintJobs extends React.Component {
  constructor(props) { super(props); this.state = { jobs: [], printers: [], error: '', busy: false }; this.tokens = {}; }
  componentDidMount() { this.load(); }
  componentDidUpdate(previous) { if (previous.revision !== this.props.revision) this.load(); }
  async load() {
    try { const r = await window.arra.printJobs({ action: 'list' }); if (r.ok) this.setState({ ...r.data, error: '' }); else this.setState({ error: r.error || 'Print jobs unavailable.' }); }
    catch (_) { this.setState({ error: 'Print jobs unavailable.' }); }
  }
  async change(request) {
    if (this.busy) return;
    this.busy = true; this.setState({ busy: true });
    try {
      const r = await window.arra.printJobs(request);
      if (r.ok) { if (request.action === 'retry') delete this.tokens[request.jobId]; this.setState({ ...r.data, error: '' }); }
      else this.setState({ error: r.error || 'Print jobs unavailable. Try again.' });
    } catch (_) { this.setState({ error: 'Print jobs unavailable. Try again.' }); }
    finally { this.busy = false; this.setState({ busy: false }); }
  }
  retry(jobId) {
    const requestId = this.tokens[jobId] || (this.tokens[jobId] = crypto.randomUUID());
    return this.change({ action: 'retry', jobId, requestId });
  }
  render() {
    const h = React.createElement;
    return h('section', { style: { padding: '10px 20px', background: '#fff7ed', maxHeight: 220, overflow: 'auto' } },
      h('strong', null, 'Simulated preparation printing — no physical printer is connected'),
      this.state.error && h('p', { role: 'alert' }, this.state.error),
      h('div', null, this.state.printers.map(p => h('label', { key: p.destination, style: { marginRight: 16 } }, p.destination + ' simulated result ',
        h('select', { value: p.result, disabled: this.state.busy, onChange: e => this.change({ action: 'simulate', destination: p.destination, result: e.target.value }) },
          h('option', { value: 'success' }, 'Success'), h('option', { value: 'failed' }, 'Failure'), h('option', { value: 'uncertain' }, 'Uncertain'))))),
      this.state.jobs.map(j => h('div', { key: j.id }, `${j.destination} · Table ${j.tableId} · Round ${j.round} · ${j.attempts} attempt(s) · `,
        j.result === 'uncertain' ? 'Output uncertain; check before retrying.' : j.result === 'failed' ? 'Simulated failure.' : 'Simulated success.',
        j.hadUncertain && j.result !== 'uncertain' && ' An earlier attempt was uncertain; duplicate output is possible.',
        j.result !== 'success' && h('button', { disabled: this.state.busy, onClick: () => this.retry(j.id), style: { marginLeft: 10 } }, 'Retry simulated job'))));
  }
}

class WaiterDemo extends React.Component {
  constructor(...a) {
    super(...a); this._dataGeneration = 0; this.state = this.seed();
    if (window.arra) {
      this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {} };
      this.state.menuLoad = 'loading';
    }
  }
  componentDidMount() {
    this._mounted = true;
    this._tick = setInterval(() => this.forceUpdate(), 20000);
  }
  clearDesktopData() {
    this._dataGeneration++;
    this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {}, G: {} };
    this.setState({ sections: [], orders: {}, items: [], tableId: null, modal: null, menuLoad: 'loading', tableLoad: 'loading' });
  }
  loadDesktopData() {
    const generation = ++this._dataGeneration;
    if (window.arra) {
      this.setState({ menuLoad: 'loading', tableLoad: 'loading' });
      window.arra.getMenu().then(result => {
        if (!this._mounted || generation !== this._dataGeneration) return;
        if (!result.ok) { this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {}, G: {} }; this.setState({ menuLoad: 'error' }); return; }
        const cats = result.data.categories.map(c => ({ id: c.id, label: c.name,
          color: '#1D4ED8', tint: '#EAF1FF', route: c.id === 'drinks' ? 'bar' : 'kitchen', subs: [[c.id, c.name]] }));
        const catById = Object.fromEntries(cats.map(c => [c.id, c]));
        const groups = result.data.groups || [], options = result.data.options || [];
        const G = Object.fromEntries(groups.map(g => [g.id, { label: g.name, req: !!g.required, opts: options.filter(o => o.groupId === g.id).map(o => [o.name, o.adjustment, o.id]) }]));
        const products = result.data.products.map(p => ({ id: p.id, name: p.name, price: p.price,
          cat: p.categoryId, sub: p.categoryId, groups: groups.filter(g => g.productId === p.id).map(g => g.id), route: catById[p.categoryId].route }));
        this._menu = { ...this._menu, cats, catById, products, G,
          byId: Object.fromEntries(products.map(p => [p.id, p])) };
        this.setState({ menuLoad: 'ready', cat: cats[0]?.id || '', sub: cats[0]?.id || '' });
      }).catch(() => { if (this._mounted && generation === this._dataGeneration) { this._menu = { ...this._menu, cats: [], catById: {}, products: [], byId: {}, G: {} }; this.setState({ menuLoad: 'error' }); } });
      window.arra.getTables().then(result => {
        if (!this._mounted || generation !== this._dataGeneration) return;
        if (!result.ok) { this.setState({ tableLoad: 'error', sections: [], orders: {}, items: [], tableId: null, modal: null }); return; }
        const sections = [];
        result.data.forEach(table => {
          let section = sections.find(s => s.label === table.area);
          if (!section) { section = { label: table.area, ids: [] }; sections.push(section); }
          section.ids.push(table.id);
        });
        const orders = {};
        result.data.forEach(table => {
          if (table.orderId !== null) orders[table.id] = { id: table.orderId, openedAt: table.openedAt, openedBy: '', rounds: 0, log: [] };
        });
        this.setState({ sections, orders, tableLoad: 'ready' });
      }).catch(() => { if (this._mounted && generation === this._dataGeneration) this.setState({ tableLoad: 'error', sections: [], orders: {}, items: [], tableId: null, modal: null }); });
    }
  }
  componentWillUnmount() { this._mounted = false; clearInterval(this._tick); clearTimeout(this._tt); }

  menu() {
    if (this._menu) return this._menu;
    const G = {
      side: { label: 'Side', req: true, opts: [['Fries', 0], ['Rice', 0], ['Grilled vegetables', 40], ['Mashed potatoes', 0], ['No side', 0]] },
      cook: { label: 'Cooking', req: true, opts: [['Rare', 0], ['Medium rare', 0], ['Medium', 0], ['Well done', 0]] },
      portion: { label: 'Portion', req: true, opts: [['5 pieces', 0], ['10 pieces', 120]] },
      milk: { label: 'Milk', req: false, opts: [['Regular milk', 0], ['Lactose-free', 0], ['Oat milk', 30]] }
    };
    const cats = [
      { id: 'food', label: 'Food', color: '#C2410C', tint: '#FFF1E6', route: 'kitchen', subs: [['grill', 'Grill'], ['salads', 'Salads'], ['pizza', 'Pizza & pasta'], ['starters', 'Starters']] },
      { id: 'drinks', label: 'Drinks', color: '#1D4ED8', tint: '#EAF1FF', route: 'bar', subs: [['coffee', 'Coffee & tea'], ['soft', 'Soft drinks'], ['beer', 'Beer'], ['wine', 'Wine']] },
      { id: 'desserts', label: 'Desserts', color: '#BE185D', tint: '#FDECF4', route: 'kitchen', subs: [['cakes', 'Cakes'], ['cold', 'Ice cream & fruit']] }
    ];
    const P = [
      ['qebapa', 'grill', 'Qebapa', 220, ['portion', 'side']],
      ['pljesk', 'grill', 'Pljeskavica', 280, ['side']],
      ['steak', 'grill', 'Beef steak', 890, ['cook', 'side']],
      ['chicken', 'grill', 'Chicken fillet', 360, ['side']],
      ['mixed', 'grill', 'Mixed grill for 2', 1150, ['side']],
      ['sujuk', 'grill', 'Sujuk', 260, ['side']],
      ['shopska', 'salads', 'Shopska salad', 180, []],
      ['greek', 'salads', 'Greek salad', 220, []],
      ['caesar', 'salads', 'Caesar salad', 320, []],
      ['season', 'salads', 'Seasonal salad', 160, []],
      ['marg', 'pizza', 'Pizza Margherita', 320, []],
      ['capri', 'pizza', 'Pizza Capricciosa', 390, []],
      ['arrapz', 'pizza', 'Pizza Arra', 450, []],
      ['carbo', 'pizza', 'Pasta Carbonara', 380, []],
      ['bolo', 'pizza', 'Pasta Bolognese', 360, []],
      ['fries', 'starters', 'Fries', 120, []],
      ['ajvar', 'starters', 'Ajvar & white cheese', 220, []],
      ['soup', 'starters', 'Soup of the day', 150, []],
      ['peppers', 'starters', 'Grilled peppers', 160, []],
      ['bread', 'starters', 'Bread basket', 60, []],
      ['espresso', 'coffee', 'Espresso', 70, []],
      ['macch', 'coffee', 'Macchiato', 80, ['milk']],
      ['capp', 'coffee', 'Cappuccino', 100, ['milk']],
      ['turk', 'coffee', 'Turkish coffee', 70, []],
      ['tea', 'coffee', 'Tea', 70, []],
      ['cola', 'soft', 'Coca-Cola', 100, []],
      ['fanta', 'soft', 'Fanta', 100, []],
      ['water', 'soft', 'Still water', 60, []],
      ['spark', 'soft', 'Sparkling water', 80, []],
      ['orange', 'soft', 'Fresh orange juice', 150, []],
      ['lemon', 'soft', 'Lemonade', 140, []],
      ['skopsko', 'beer', 'Skopsko', 120, []],
      ['heineken', 'beer', 'Heineken', 150, []],
      ['dab', 'beer', 'Zlaten Dab', 120, []],
      ['red', 'wine', 'House red (glass)', 150, []],
      ['white', 'wine', 'House white (glass)', 150, []],
      ['vranec', 'wine', 'Vranec (bottle)', 1200, []],
      ['baklava', 'cakes', 'Baklava', 150, []],
      ['trilece', 'cakes', 'Trileçe', 180, []],
      ['choc', 'cakes', 'Chocolate cake', 190, []],
      ['icecream', 'cold', 'Ice cream (3 scoops)', 160, []],
      ['fruit', 'cold', 'Fruit salad', 200, []]
    ];
    const subCat = {};
    cats.forEach(c => c.subs.forEach(sb => { subCat[sb[0]] = c; }));
    const products = P.map(([id, sub, name, price, groups]) => ({ id, sub, name, price, groups, cat: subCat[sub].id, route: subCat[sub].route }));
    const byId = {}; products.forEach(p => { byId[p.id] = p; });
    const catById = {}; cats.forEach(c => { catById[c.id] = c; });
    const waiters = [
      { id: 'arta', name: 'Arta', pin: true, color: '#C2410C' },
      { id: 'besnik', name: 'Besnik', pin: true, color: '#1D4ED8' },
      { id: 'dita', name: 'Dita', pin: false, color: '#BE185D' },
      { id: 'marko', name: 'Marko', pin: true, color: '#15803D' },
      { id: 'elena', name: 'Elena', pin: false, color: '#6D28D9' },
      { id: 'liridon', name: 'Liridon', pin: true, color: '#0E7490' }
    ];
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
    const sections = [{ label: 'Inside', ids: range(1, 10) }, { label: 'Terrace', ids: range(11, 16) }];
    const allIds = range(1, 16);
    this._menu = { G, cats, catById, products, byId, waiters, sections, allIds };
    return this._menu;
  }

  seed() {
    const now = Date.now(), m = 60000;
    const st = {
      screen: 'login', user: '', pass: '', waiter: null, pinFor: null, pin: '',
      tableId: null, cat: 'food', sub: 'grill', search: '', tab: 'order', modal: null, toast: null,
      printers: { kitchen: true, bar: true, A: true, B: true },
      orders: {}, items: [], jobs: [], history: [], seq: 100, billNo: 1045,
      sections: window.arra ? [] : this.menu().sections, tableLoad: window.arra ? 'loading' : 'ready'
    };
    const M = this.menu();
    const add = (tid, pid, qty, mods, delta, note, round, ago, who) => {
      const p = M.byId[pid];
      st.items.push({ id: 'i' + (st.seq++), tableId: tid, pid, name: p.name, unit: p.price + delta, qty, mods: mods || '', note: note || '', route: p.route, status: 'sent', round, sentAt: now - ago * m, sentBy: who, cxQty: 0, cx: [] });
    };
    const open = (tid, who, ago, rounds) => { st.orders[tid] = { openedAt: now - ago * m, openedBy: who, rounds, log: [{ t: now - ago * m, who, text: 'Opened table' }] }; };
    const lg = (tid, ago, who, text) => st.orders[tid].log.push({ t: now - ago * m, who, text });

    open(3, 'Besnik', 38, 2);
    add(3, 'qebapa', 2, '10 pieces · Fries', 120, '', 1, 35, 'Besnik');
    add(3, 'shopska', 1, '', 0, '', 1, 35, 'Besnik');
    add(3, 'skopsko', 2, '', 0, '', 1, 35, 'Besnik');
    add(3, 'cola', 1, '', 0, '', 1, 35, 'Besnik');
    lg(3, 35, 'Besnik', 'Sent round 1: Kitchen got 3 items, Bar got 3 items');
    add(3, 'ajvar', 1, '', 0, '', 2, 12, 'Besnik');
    lg(3, 12, 'Besnik', 'Sent round 2: Kitchen got 1 item');

    open(7, 'Arta', 22, 1);
    add(7, 'steak', 1, 'Medium rare · Grilled vegetables', 40, 'Sauce on the side', 1, 20, 'Arta');
    add(7, 'caesar', 1, '', 0, '', 1, 20, 'Arta');
    add(7, 'red', 2, '', 0, '', 1, 20, 'Arta');
    lg(7, 20, 'Arta', 'Sent round 1: Kitchen got 2 items, Bar got 2 items');

    open(9, 'Marko', 55, 1);
    add(9, 'arrapz', 1, '', 0, '', 1, 52, 'Marko');
    add(9, 'marg', 1, '', 0, '', 1, 52, 'Marko');
    add(9, 'lemon', 2, '', 0, '', 1, 52, 'Marko');
    add(9, 'spark', 1, '', 0, '', 1, 52, 'Marko');
    lg(9, 52, 'Marko', 'Sent round 1: Kitchen got 2 items, Bar got 3 items');

    open(12, 'Dita', 6, 1);
    add(12, 'turk', 2, '', 0, '', 1, 5, 'Dita');
    add(12, 'macch', 1, 'Oat milk', 30, '', 1, 5, 'Dita');
    lg(12, 5, 'Dita', 'Sent round 1: Bar got 3 items');

    st.history = [
      { no: 1044, table: 'Table 1', closedAt: now - 45 * m, waiter: 'Marko', method: 'Card', account: 'A', total: 2310, count: 9 },
      { no: 1043, table: 'Table 14', closedAt: now - 80 * m, waiter: 'Dita', method: 'Cash', account: 'B', total: 620, count: 4 },
      { no: 1042, table: 'Table 6', closedAt: now - 110 * m, waiter: 'Arta', method: 'Cash', account: 'A', total: 940, count: 5 },
      { no: 1041, table: 'Table 2', closedAt: now - 150 * m, waiter: 'Besnik', method: 'Card', account: 'A', total: 1860, count: 7 }
    ];
    if (window.arra) { st.orders = {}; st.items = []; st.history = []; }
    return st;
  }

  // ---------- helpers ----------
  fmt(v) { return Math.round(v).toLocaleString('en-US') + ' den'; }
  who(n) { return n.waiter ? n.waiter.name : ''; }
  mut(fn) { this.setState(s => { const n = JSON.parse(JSON.stringify(s)); fn(n); return n; }); }
  toast(n, msg, kind) {
    n.toast = { msg, kind: kind || 'ok' };
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.setState({ toast: null }), 4200);
  }
  log(n, tid, text) { const o = n.orders[tid]; if (o) o.log.push({ t: Date.now(), who: this.who(n), text }); }
  freeIfEmpty(n, tid) { if (window.arra) return; const o = n.orders[tid]; if (o && o.rounds === 0 && !n.items.some(x => x.tableId === tid)) delete n.orders[tid]; }
  rlabel(k) { return k === 'bar' ? 'Bar' : 'Kitchen'; }

  // ---------- login / waiter ----------
  async login() {
    if (this._signingIn) return;
    const { user, pass } = this.state;
    if (!user.trim() || !pass) { this.mut(n => this.toast(n, 'Enter the restaurant username and password.', 'err')); return; }
    if (!window.arra) { this.setState({ screen: 'waiters', pass: '' }); return; }
    this._signingIn = true;
    try {
      const result = await window.arra.signIn(user, pass);
      if (!this._mounted) return;
      if (result.ok) { this._menu = { ...this._menu, waiters: [] }; this.setState({ screen: 'waiters', pass: '', waiterMessage: 'Loading waiters…' }); await this.loadWaiters(); }
      else this.mut(n => { n.pass = ''; this.toast(n, 'Sign in failed.', 'err'); });
    } catch (_) {
      if (this._mounted) this.mut(n => { n.pass = ''; this.toast(n, 'Sign in failed.', 'err'); });
    } finally { this._signingIn = false; }
  }
  async signOut() {
    if (window.arra && (this._opening || this._itemBusy || this._selecting || this.state.modal?.unresolved)) return;
    if (window.arra) {
      this.clearDesktopData();
      try { if (!(await window.arra.signOut()).ok) { this.mut(n => this.toast(n, 'Sign out failed.', 'err')); return; } }
      catch (_) { this.mut(n => this.toast(n, 'Sign out failed.', 'err')); return; }
    }
    this._dataGeneration++;
    this.mut(n => { n.screen = 'login'; n.waiter = null; n.user = ''; n.pass = ''; });
  }
  async loadWaiters() {
    try {
      const result = await window.arra.getWaiters();
      if (!result.ok) throw new Error();
      this._menu = { ...this._menu, waiters: result.data.map(w => ({ id: w.id, name: w.name, pin: w.hasPin, isTransfer: w.isTransfer, color: '#1D4ED8' })) };
      this.setState({ waiterMessage: result.data.length ? '' : 'No active waiters available.' });
    } catch (_) { this._menu = { ...this._menu, waiters: [] }; this.setState({ waiterMessage: 'Waiters unavailable. Sign out and try again.' }); }
  }
  async chooseWaiter(w, pin) {
    if (this._selecting) return;
    this._selecting = true;
    try {
      if (window.arra && !(await window.arra.selectWaiter(w.id, pin)).ok) throw new Error();
      if (window.arra) this.clearDesktopData();
      this.setState({ waiter: w, pin: '', screen: w.isTransfer ? 'transferCorrection' : 'tables' });
      if (window.arra && !w.isTransfer) this.loadDesktopData();
    } catch (_) { this.mut(n => { n.pin = ''; this.toast(n, 'Waiter selection failed.', 'err'); }); }
    finally { this._selecting = false; }
  }
  pickWaiter(w) {
    const ww = { id: w.id, name: w.name, color: w.color, isTransfer: w.isTransfer };
    if (w.pin) this.setState({ pinFor: ww, pin: '', screen: 'pin' });
    else this.chooseWaiter(ww, '');
  }
  pinPress(k) {
    let pin = this.state.pin;
    if (k === 'Clear') pin = '';
    else if (k === 'Del') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    if (pin.length === 4) { this.setState({ pin: '' }); this.chooseWaiter(this.state.pinFor, pin); }
    else this.setState({ pin });
  }
  async switchWaiter() {
    if (this._opening || this._itemBusy || this._selecting || this.state.modal?.unresolved) return;
    if (window.arra) {
      try { if (!(await window.arra.clearWaiter()).ok) throw new Error(); }
      catch (_) { this.mut(n => this.toast(n, 'Could not switch waiter.', 'err')); return; }
    }
    if (window.arra) this.clearDesktopData(); else this._dataGeneration++;
    this.mut(n => { n.waiter = null; n.screen = 'waiters'; n.modal = null; n.tableId = null; if (window.arra) { n.sections = []; n.orders = {}; n.items = []; } });
    if (window.arra) await this.loadWaiters();
  }
  goTables() {
    if (this._itemBusy || this.state.modal?.unresolved) return;
    this.mut(n => {
      if (n.screen === 'order') {
        const p = n.items.filter(i => i.tableId === n.tableId && i.status === 'pending').reduce((a, i) => a + i.qty, 0);
        if (p > 0) this.toast(n, 'Table ' + n.tableId + ' still has ' + p + (p === 1 ? ' item' : ' items') + ' not sent to the kitchen or bar.', 'warn');
      }
      n.screen = 'tables'; n.modal = null;
    });
  }
  async openTable(id) {
    if (window.arra) {
      if (this._opening || this._itemBusy) return;
      this._opening = true;
      try {
        const result = await window.arra.openOrder(id);
        if (!this._mounted) return;
        if (!result.ok) { this.mut(n => this.toast(n, 'Could not open table. Try again.', 'err')); return; }
        this.mut(n => {
          const old = n.orders[id];
          n.orders[id] = { id: result.data.id, openedAt: result.data.openedAt, openedBy: '', rounds: old?.rounds || 0,
            log: old?.log || [], itemsLoaded: old?.id === result.data.id && !!old.itemsLoaded };
        });
        const items = await window.arra.orderItems('list', result.data.id);
        if (!this._mounted) return;
        if (!items.ok) { this.mut(n => this.toast(n, 'Could not load order items. Try again.', 'err')); return; }
        this.mut(n => {
          n.orders[id].itemsLoaded = true;
          this.replaceDesktopItems(n, id, items.data.items);
          n.tableId = id; n.screen = 'order'; n.tab = 'order'; n.search = '';
        });
      } catch (_) { if (this._mounted) this.mut(n => this.toast(n, 'Could not open table. Try again.', 'err')); }
      finally { this._opening = false; }
      return;
    }
    this.mut(n => { n.tableId = id; n.screen = 'order'; n.tab = 'order'; n.search = ''; });
  }
  togglePrinter(k) {
    const names = { kitchen: 'Kitchen', bar: 'Bar', A: 'Bill A', B: 'Bill B' };
    this.mut(n => {
      n.printers[k] = !n.printers[k];
      this.toast(n, 'Demo: ' + names[k] + ' printer is now ' + (n.printers[k] ? 'online.' : 'offline.'), n.printers[k] ? 'ok' : 'warn');
    });
  }

  // ---------- order entry ----------
  replaceDesktopItems(n, tableId, items) {
    n.items = n.items.filter(i => i.tableId !== tableId).concat(items.map(i => ({
      id: i.id, tableId, pid: i.productId, name: i.name, unit: i.unitPrice, qty: i.quantity,
      mods: (i.modifiers || []).map(m => m.groupName + ': ' + m.optionName + ' (' + (m.adjustment >= 0 ? '+' : '') + m.adjustment + ')').join(' · '), note: i.note, status: i.status || 'pending', round: i.round || 0, sentAt: i.sentAt, sentBy: i.sentBy, route: i.route, cxQty: i.correctedQuantity || 0, cx: (i.corrections || []).map(c => ({ qty: c.quantity, reason: c.reason, who: c.actor, t: c.occurredAt }))
    })));
  }
  async changeDesktopItems(action, value) {
    if (this._itemBusy) { this.mut(n => this.toast(n, 'Please wait for the order to save.', 'warn')); return; }
    const tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
    if (!orderId) return;
    this._itemBusy = true;
    try {
      const result = await window.arra.orderItems(action, orderId, value);
      if (!this._mounted) return;
      if (!result.ok) { this.mut(n => this.toast(n, 'Could not save order items. Try again.', 'err')); return false; }
      this.mut(n => this.replaceDesktopItems(n, tableId, result.data.items));
      return result.data;
    } catch (_) { if (this._mounted) this.mut(n => this.toast(n, 'Could not save order items. Try again.', 'err')); }
    finally { this._itemBusy = false; }
  }
  addProduct(pid) {
    if (window.arra && !this.menu().byId[pid]?.groups.length) return this.changeDesktopItems('add', pid);
    this.mut(n => {
      const p = this.menu().byId[pid];
      if (!p) return;
      if (p.groups.length) n.modal = { type: 'mods', pid, sel: {} };
      else this.addItem(n, p, '', 0);
    });
  }
  addItem(n, p, mods, delta) {
    const tid = n.tableId;
    if (!n.orders[tid]) { n.orders[tid] = { openedAt: Date.now(), openedBy: this.who(n), rounds: 0, log: [] }; this.log(n, tid, 'Opened table'); }
    const same = n.items.find(i => i.tableId === tid && i.status === 'pending' && i.pid === p.id && i.mods === mods && !i.note);
    if (same) same.qty++;
    else n.items.push({ id: 'i' + (n.seq++), tableId: tid, pid: p.id, name: p.name, unit: p.price + delta, qty: 1, mods, note: '', route: p.route, status: 'pending', round: 0, cxQty: 0, cx: [] });
    this.log(n, tid, 'Added ' + p.name + (mods ? ' (' + mods + ')' : ''));
  }
  async modAdd() {
    if (window.arra) {
      if (this._itemBusy || this.state.modal?.saving) return;
      const modal = this.state.modal, p = this.menu().byId[modal.pid], G = this.menu().G;
      const optionIds = p.groups.filter(g => modal.sel[g] != null).map(g => G[g].opts[modal.sel[g]][2]);
      this.mut(n => { if (n.modal?.type === 'mods' && n.modal.pid === modal.pid) n.modal.saving = true; });
      const saved = await this.changeDesktopItems('add', { productId: p.id, optionIds });
      if (this._mounted) this.mut(n => {
        if (n.modal?.type === 'mods' && n.modal.pid === modal.pid && n.modal.saving) {
          if (saved) n.modal = null;
          else n.modal.saving = false;
        }
      });
      return;
    }
    this.mut(n => {
      const M = this.menu(); const p = M.byId[n.modal.pid];
      let d = 0; const ls = [];
      p.groups.forEach(g => { const k = n.modal.sel[g]; if (k != null) { ls.push(M.G[g].opts[k][0]); d += M.G[g].opts[k][1]; } });
      this.addItem(n, p, ls.join(' · '), d);
      n.modal = null;
    });
  }
  incItem(id) { if (window.arra) return this.changeDesktopItems('increment', id); this.mut(n => { const i = n.items.find(x => x.id === id); if (i && i.status === 'pending') i.qty++; }); }
  decItem(id) {
    if (window.arra) return this.changeDesktopItems('decrement', id);
    this.mut(n => {
      const i = n.items.find(x => x.id === id); if (!i || i.status !== 'pending') return;
      if (i.qty > 1) i.qty--; else this.dropItem(n, i);
    });
  }
  removeItem(id) { if (window.arra) return this.changeDesktopItems('remove', id); this.mut(n => { const i = n.items.find(x => x.id === id); if (i && i.status === 'pending') this.dropItem(n, i); }); }
  dropItem(n, i) {
    n.items = n.items.filter(x => x.id !== i.id);
    this.log(n, i.tableId, 'Removed ' + i.name + ' (was not sent yet)');
    this.freeIfEmpty(n, i.tableId);
  }
  openNote(id) { this.mut(n => { const i = n.items.find(x => x.id === id && x.status === 'pending'); if (i) n.modal = { type: 'note', itemId: id, text: i.note }; }); }
  async saveNote() {
    if (window.arra) {
      if (this._itemBusy) return;
      const modal = this.state.modal, tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
      if (!modal || modal.type !== 'note' || !orderId) return;
      this._itemBusy = true;
      this.mut(n => { n.modal.saving = true; n.modal.error = ''; });
      try {
        const result = await window.arra.orderItems('note', orderId, { itemId: modal.itemId, note: modal.text.trim() });
        if (!this._mounted) return;
        if (!result.ok) { this.mut(n => { if (n.modal?.type === 'note' && n.modal.itemId === modal.itemId) { n.modal.saving = false; n.modal.error = 'Could not save note. Try again.'; } }); return; }
        this.mut(n => { this.replaceDesktopItems(n, tableId, result.data.items); if (n.modal?.type === 'note' && n.modal.itemId === modal.itemId) n.modal = null; });
      } catch (_) { if (this._mounted) this.mut(n => { if (n.modal?.type === 'note' && n.modal.itemId === modal.itemId) { n.modal.saving = false; n.modal.error = 'Could not save note. Try again.'; } }); }
      finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const i = n.items.find(x => x.id === n.modal.itemId);
      if (i) { i.note = n.modal.text.trim(); this.log(n, i.tableId, i.note ? 'Note added to ' + i.name : 'Removed note from ' + i.name); }
      n.modal = null;
    });
  }

  // ---------- send / print ----------
  send() {
    if (window.arra) {
      if (this._itemBusy) return;
      const tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
      if (!orderId) return;
      this._sendRequests = this._sendRequests || {};
      const token = this._sendRequests[orderId] || (this._sendRequests[orderId] = crypto.randomUUID());
      return this.changeDesktopItems('send', token).then(data => {
        if (!data) return;
        delete this._sendRequests[orderId];
        this.setState({ printRevision: (this.state.printRevision || 0) + 1 });
        const pending = data.items.some(i => i.status === 'pending');
        if (this._mounted) this.mut(n => this.toast(n, pending
          ? 'Previous send confirmed. New items are still pending; send again. No physical ticket was printed.'
          : 'Round saved using simulated printing; no physical ticket was printed.', pending ? 'warn' : 'ok'));
      });
    }
    this.mut(n => {
      const tid = n.tableId;
      const pend = n.items.filter(i => i.tableId === tid && i.status === 'pending');
      if (!pend.length) return;
      const o = n.orders[tid]; o.rounds++;
      const r = o.rounds, t = Date.now(), who = this.who(n);
      pend.forEach(i => { i.status = 'sent'; i.round = r; i.sentAt = t; i.sentBy = who; });
      const parts = [], bad = [];
      ['kitchen', 'bar'].forEach(k => {
        const L = pend.filter(i => i.route === k); if (!L.length) return;
        const c = L.reduce((a, i) => a + i.qty, 0); const ok = n.printers[k];
        n.jobs.push({ id: 'j' + (n.seq++), tableId: tid, round: r, printer: k, count: c, status: ok ? 'ok' : 'failed', attempts: 1 });
        parts.push(this.rlabel(k) + ' got ' + c + (c === 1 ? ' item' : ' items'));
        if (!ok) bad.push(this.rlabel(k));
      });
      this.log(n, tid, 'Sent round ' + r + ': ' + parts.join(', ') + (bad.length ? ' (' + bad.join(' and ') + ' ticket did not print)' : ''));
      if (bad.length) this.toast(n, 'Round ' + r + ' is saved, but the ' + bad.join(' and ') + ' ticket did not print. Use the red bar at the top.', 'err');
      else this.toast(n, 'Round ' + r + ' sent. ' + parts.join(', ') + '.');
    });
  }
  retryJob(id) {
    this.mut(n => {
      const j = n.jobs.find(x => x.id === id); if (!j) return;
      const l = this.rlabel(j.printer); j.attempts++;
      if (n.printers[j.printer]) {
        j.status = 'ok';
        this.log(n, j.tableId, 'Reprinted ' + l + ' ticket for round ' + j.round + ' (same items, nothing added twice)');
        this.toast(n, l + ' ticket printed. Nothing was added to the order twice.');
      } else {
        this.log(n, j.tableId, 'Retry of ' + l + ' ticket failed');
        this.toast(n, l + ' printer is still not responding. Try the backup printer.', 'err');
      }
    });
  }
  backupJob(id) {
    this.mut(n => {
      const j = n.jobs.find(x => x.id === id); if (!j) return;
      j.status = 'ok'; j.attempts++;
      const l = this.rlabel(j.printer);
      this.log(n, j.tableId, 'Printed ' + l + ' ticket for round ' + j.round + ' on the backup printer');
      this.toast(n, l + ' ticket printed on the backup printer.');
    });
  }

  // ---------- cancel ----------
  openCancel(id) { this.mut(n => { n.modal = { type: 'cancel', itemId: id, qty: 1, reason: '', other: '' }; }); }
  async confirmCancel() {
    if (window.arra) {
      const m = this.state.modal;
      if (!m || !m.reason || (m.reason === 'Other' && !m.other.trim()) || this._itemBusy) return;
      const reason = m.reason === 'Other' ? m.other.trim() : m.reason;
      const requestId = m.requestId || crypto.randomUUID();
      const tableId = this.state.tableId, orderId = this.state.orders[tableId]?.id;
      if (!orderId) return;
      this._itemBusy = true;
      this.mut(n => { n.modal.requestId = requestId; n.modal.saving = true; });
      try {
        const result = await window.arra.orderItems('correct', orderId, { itemId: m.itemId, quantity: m.qty, reason, requestId });
        if (!this._mounted) return;
        this.mut(n => {
          if (result.ok) { this.replaceDesktopItems(n, tableId, result.data.items); n.modal = null; this.toast(n, 'Correction saved. Tell preparation staff in person.'); }
          else if (result.rejected) { n.modal.saving = false; n.modal.unresolved = false; n.modal.requestId = null; this.toast(n, 'Correction rejected. Check authorization and quantity.', 'err'); }
          else { n.modal.saving = false; n.modal.unresolved = true; this.toast(n, 'Correction status unknown. Retry before leaving.', 'err'); }
        });
      } catch (_) { if (this._mounted) this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; this.toast(n, 'Correction status unknown. Retry before leaving.', 'err'); }); }
      finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const m = n.modal; const i = n.items.find(x => x.id === m.itemId); if (!i) return;
      if (!m.reason || (m.reason === 'Other' && !m.other.trim())) return;
      const q = Math.min(m.qty, i.qty - i.cxQty);
      const reason = m.reason === 'Other' ? m.other.trim() : m.reason;
      i.cxQty += q; i.cx.push({ qty: q, reason, who: this.who(n), t: Date.now() });
      if (i.cxQty >= i.qty) i.status = 'cancelled';
      const l = this.rlabel(i.route);
      this.log(n, i.tableId, 'Cancelled ' + q + '× ' + i.name + '. Reason: ' + reason + '. Waiting for owner review');
      if (n.printers[i.route]) this.toast(n, 'Cancelled. A cancel notice printed at the ' + l + '.');
      else this.toast(n, 'Cancelled and saved. The ' + l + ' printer is offline, so tell them in person.', 'warn');
      n.modal = null;
    });
  }

  // ---------- move ----------
  async confirmMoveTable() {
    if (window.arra) {
      if (this._itemBusy || this.state.modal?.saving) return;
      const from = this.state.tableId, to = this.state.modal?.dest, orderId = this.state.orders[from]?.id;
      if (!orderId || !to || to === from || this.state.orders[to]) return;
      this._moveRequests = this._moveRequests || {};
      const key = [orderId, from, to].join(':');
      const token = this._moveRequests[key] || (this._moveRequests[key] = crypto.randomUUID());
      this._itemBusy = true;
      this.mut(n => { n.modal.saving = true; n.modal.error = ''; });
      try {
        let result;
        try { result = await window.arra.moveOrder(orderId, from, to, token); } catch (_) { result = { ok: false }; }
        if (!this._mounted) return;
        if (!result.ok) {
          let tables;
          try { tables = await window.arra.getTables(); } catch (_) { tables = { ok: false }; }
          if (!this._mounted) return;
          if (!tables?.ok || !Array.isArray(tables.data)) {
            this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = 'Move status is unknown. Retry to check it before leaving.'; });
            return;
          }
          const current = tables.data.find(t => t.orderId === orderId);
          if (current?.id !== to) {
            this.mut(n => {
              const previous = n.orders;
              n.orders = {};
              for (const table of tables.data) if (table.orderId !== null)
                n.orders[table.id] = Object.values(previous).find(o => o.id === table.orderId) || { id: table.orderId, openedAt: table.openedAt, openedBy: '', rounds: 0, log: [] };
              if (current?.id === from) {
                n.modal.saving = false; n.modal.unresolved = false; n.modal.dest = null;
                n.modal.error = 'Order was not moved. Check the destination and try again.';
              } else {
                n.screen = 'tables'; n.tableId = null; n.modal = null; n.items = [];
                this.toast(n, 'Order location changed. Select a table to continue.', 'warn');
              }
            });
            return;
          }
        }
        delete this._moveRequests[key];
        this.mut(n => {
          n.orders[to] = n.orders[from]; delete n.orders[from];
          n.items.forEach(i => { if (i.tableId === from) i.tableId = to; });
          n.tableId = to; n.modal = null;
          this.toast(n, 'Everything moved to Table ' + to + '. Table ' + from + ' is free now.');
        });
      } finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const from = n.tableId, to = n.modal.dest;
      if (to == null || to === from || n.orders[to]) return;
      n.orders[to] = n.orders[from]; delete n.orders[from];
      n.items.forEach(i => { if (i.tableId === from) i.tableId = to; });
      n.jobs.forEach(j => { if (j.tableId === from) j.tableId = to; });
      n.tableId = to;
      this.log(n, to, 'Moved the whole order from Table ' + from + ' to Table ' + to);
      this.toast(n, 'Everything moved to Table ' + to + '. Table ' + from + ' is free now.');
      n.modal = null;
    });
  }
  async confirmMoveItems() {
    if (window.arra) {
      if (this._itemBusy || this.state.modal?.saving) return;
      const from = this.state.tableId, modal = this.state.modal, to = modal?.dest, orderId = this.state.orders[from]?.id;
      const ids = Object.keys(modal?.sel || {}).filter(k => modal.sel[k]).map(Number).sort((a,b) => a-b);
      if (!orderId || !to || to === from || !ids.length) return;
      const destOrderId = this.state.orders[to]?.id || null;
      const token = modal.requestId || crypto.randomUUID();
      this._itemBusy = true;
      this.mut(n => { n.modal.saving = true; n.modal.requestId = token; n.modal.error = ''; });
      try {
        let result;
        try { result = await window.arra.moveItems(orderId, from, to, destOrderId, ids, token); } catch (_) { result = { ok: false }; }
        if (!this._mounted) return;
        if (!result.ok && !result.rejected) {
          this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = 'Move status is unknown. Retry to check it before leaving.'; });
          return;
        }
        this.mut(n => {
          n.screen = 'tables'; n.tableId = null; n.modal = null; n.items = []; n.orders = {};
          this.toast(n, result.ok ? 'Items moved. Select a table to continue.' : 'Could not confirm the move. Check the tables before trying again.', result.ok ? 'ok' : 'warn');
        });
        this.loadDesktopData();
      } finally { this._itemBusy = false; }
      return;
    }
    this.mut(n => {
      const from = n.tableId, to = n.modal.dest;
      const ids = Object.keys(n.modal.sel).filter(k => n.modal.sel[k]);
      if (to == null || to === from || !ids.length) return;
      if (!n.orders[to]) { n.orders[to] = { openedAt: Date.now(), openedBy: this.who(n), rounds: 0, log: [] }; this.log(n, to, 'Opened table'); }
      const moved = n.items.filter(i => ids.includes(i.id) && i.tableId === from);
      let maxR = 0, cnt = 0;
      moved.forEach(i => { i.tableId = to; if (i.status !== 'pending') i.movedFrom = from; maxR = Math.max(maxR, i.round); cnt += i.qty - i.cxQty; });
      n.orders[to].rounds = Math.max(n.orders[to].rounds, maxR);
      const names = moved.map(i => (i.qty - i.cxQty) + '× ' + i.name).join(', ');
      this.log(n, from, 'Moved to Table ' + to + ': ' + names);
      this.log(n, to, 'Received from Table ' + from + ': ' + names);
      const left = n.items.filter(i => i.tableId === from && (i.qty - i.cxQty) > 0);
      if (!left.length) {
        n.items = n.items.filter(i => i.tableId !== from);
        delete n.orders[from];
        n.tableId = to;
        this.toast(n, 'Moved ' + cnt + (cnt === 1 ? ' item' : ' items') + ' to Table ' + to + '. Table ' + from + ' is free now.');
      } else {
        this.toast(n, 'Moved ' + cnt + (cnt === 1 ? ' item' : ' items') + ' to Table ' + to + '.');
      }
      n.modal = null;
    });
  }

  // ---------- bill ----------
  bSet(fn) { this.mut(n => { if (n.modal && n.modal.type === 'bill') fn(n.modal, n); }); }
  printBill(useBackup) {
    this.mut(n => {
      const b = n.modal; if (!b || b.type !== 'bill') return;
      if (b.method === 'Card') b.account = 'A';
      const where = 'Printer ' + b.account + (useBackup ? ' (backup)' : '');
      if (!useBackup && !n.printers[b.account]) {
        b.step = 'failed';
        this.log(n, n.tableId, 'Bill did not print on Printer ' + b.account + '. No payment recorded');
        return;
      }
      b.printed++; b.backup = !!useBackup; b.step = 'printed';
      this.log(n, n.tableId, b.printed > 1 ? 'Reprinted the bill on ' + where + ' (no new payment)' : 'Printed bill on ' + where + ': ' + b.method + ', Account ' + b.account);
      if (b.printed > 1) this.toast(n, 'Bill reprinted. Still one payment.');
    });
  }
  paid() {
    if (window.arra) { this.mut(n => this.toast(n, 'Closing orders is not available yet.', 'warn')); return; }
    this.mut(n => {
      const b = n.modal; const tid = n.tableId;
      if (!b || !b.printed) return;
      if (b.method === 'Card' && b.account !== 'A') { this.toast(n, 'Blocked: card payments can only go to Account A.', 'err'); return; }
      const its = n.items.filter(i => i.tableId === tid);
      const total = its.reduce((a, i) => a + (i.qty - i.cxQty) * i.unit, 0);
      const count = its.reduce((a, i) => a + (i.qty - i.cxQty), 0);
      n.history.unshift({ no: n.billNo++, table: 'Table ' + tid, closedAt: Date.now(), waiter: this.who(n), method: b.method, account: b.account, total, count });
      n.items = n.items.filter(i => i.tableId !== tid);
      delete n.orders[tid];
      n.jobs = n.jobs.filter(j => j.tableId !== tid);
      n.modal = null; n.screen = 'tables'; n.tableId = null;
      this.toast(n, 'Table ' + tid + ' is free. Payment saved once: ' + b.method + ', Account ' + b.account + ', ' + this.fmt(total) + '.');
    });
  }

  // ---------- render ----------
  renderVals() {
    const s = this.state, M = this.menu(), now = Date.now();
    const money = x => this.fmt(x);
    const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const bq = i => i.qty - i.cxQty;
    const av = (c, z) => 'width:' + z + 'px; height:' + z + 'px; border-radius:999px; background:' + c + '; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:' + Math.round(z * 0.42) + 'px; flex:none';
    const scr = s.screen;
    const v = {};

    v.isLogin = scr === 'login'; v.isWaiters = scr === 'waiters'; v.isPin = scr === 'pin';
    v.isApp = scr === 'tables' || scr === 'order' || scr === 'history';
    v.isTables = scr === 'tables'; v.isOrder = scr === 'order'; v.isHistory = scr === 'history';

    // login
    v.user = s.user; v.pass = s.pass;
    v.onUser = e => this.setState({ user: e.target.value });
    v.onPass = e => this.setState({ pass: e.target.value });
    v.login = () => this.login();

    // waiters
    v.waiters = M.waiters.map(w => ({ name: w.name, initial: w.name[0], avStyle: av(w.color, 76), hasPin: w.pin, noPin: !w.pin, pick: () => this.pickWaiter(w) }));
    v.signOut = () => this.signOut();

    // pin
    const pf = s.pinFor || { name: '', color: '#475569' };
    v.pinName = pf.name; v.pinInitial = pf.name ? pf.name[0] : ''; v.pinAv = av(pf.color, 84);
    v.pinDots = [0, 1, 2, 3].map(k => ({ style: k < s.pin.length ? 'width:22px; height:22px; border-radius:999px; background:#0F172A' : 'width:22px; height:22px; border-radius:999px; border:3px solid #94A3B8; box-sizing:border-box' }));
    v.keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'].map(k => ({
      label: k === 'Del' ? 'Delete' : k,
      aria: k === 'Del' ? 'Delete last digit' : (k === 'Clear' ? 'Clear PIN' : 'Digit ' + k),
      press: () => this.pinPress(k),
      style: 'height:76px; border-radius:18px; border:2px solid #E2E8F0; background:' + (k.length > 1 ? '#F1F5F9' : '#FFFFFF') + '; color:#0F172A; font-size:' + (k.length > 1 ? '18px' : '32px') + '; font-weight:800'
    }));
    v.pinBack = () => this.mut(n => { n.screen = 'waiters'; n.pin = ''; });

    // top bar
    const w = s.waiter || { name: '', color: '#475569' };
    v.waiterName = w.name; v.waiterInitial = w.name ? w.name[0] : ''; v.waiterAv = av(w.color, 44);
    v.clock = hm(now);
    const tab = on => 'height:48px; padding:0 18px; border-radius:12px; border:none; font-size:17px; font-weight:800; background:' + (on ? '#0F172A' : 'transparent') + '; color:' + (on ? '#FFFFFF' : '#334155');
    v.tabTablesStyle = tab(scr !== 'history'); v.tabHistoryStyle = tab(scr === 'history');
    v.goTables = () => this.goTables();
    v.goHistory = () => this.mut(n => { n.screen = 'history'; n.modal = null; });
    v.switchWaiter = () => this.switchWaiter();
    v.printers = [['kitchen', 'Kitchen'], ['bar', 'Bar'], ['A', 'Bill A'], ['B', 'Bill B']].map(([k, l]) => {
      const on = s.printers[k];
      return {
        label: l, state: on ? '' : ' offline',
        aria: l + ' printer ' + (on ? 'online' : 'offline') + '. Demo: click to switch',
        style: 'height:44px; padding:0 14px; border-radius:999px; font-size:15px; font-weight:800; display:inline-flex; align-items:center; gap:8px; border:2px solid ' + (on ? '#BBF7D0' : '#DC2626') + '; background:' + (on ? '#F0FDF4' : '#FEF2F2') + '; color:' + (on ? '#14532D' : '#991B1B'),
        dot: 'width:11px; height:11px; border-radius:999px; background:' + (on ? '#16A34A' : '#DC2626'),
        toggle: () => this.togglePrinter(k)
      };
    });

    // failed print jobs
    const failed = s.jobs.filter(j => j.status === 'failed');
    v.hasFailed = failed.length > 0;
    v.failed = failed.map(j => ({
      text: this.rlabel(j.printer) + ' ticket for Table ' + j.tableId + ' (round ' + j.round + ', ' + j.count + (j.count === 1 ? ' item' : ' items') + ') did not print. The order is saved.',
      attempts: 'Tried ' + j.attempts + '×',
      retry: () => this.retryJob(j.id), backup: () => this.backupJob(j.id)
    }));

    // tables
    const tTotal = tid => s.items.filter(i => i.tableId === tid).reduce((a, i) => a + bq(i) * i.unit, 0);
    let free = 0, taken = 0;
    v.tableMessage = s.tableLoad === 'loading' ? 'Loading tables…' :
      s.tableLoad === 'error' ? 'Tables unavailable. Restart the app and try again.' :
      s.sections.length === 0 ? 'No tables available. Set up sample tables to get started.' : '';
    v.sections = s.sections.map(sec => ({
      label: sec.label,
      tables: sec.ids.map(id => {
        const o = s.orders[id]; const tk = !!o; if (tk) taken++; else free++;
        const figuresKnown = !window.arra || !tk || !!o.itemsLoaded;
        const its = s.items.filter(i => i.tableId === id);
        const unsent = its.filter(i => i.status === 'pending').reduce((a, i) => a + i.qty, 0);
        const cnt = its.reduce((a, i) => a + bq(i), 0);
        const issue = s.jobs.some(j => j.tableId === id && j.status === 'failed');
        const mins = tk ? Math.max(0, Math.round((now - o.openedAt) / 60000)) : 0;
        return {
          num: String(id), taken: tk, free: !tk, total: figuresKnown ? money(tTotal(id)) : '—', waiter: tk ? o.openedBy : '',
          count: figuresKnown ? cnt + (cnt === 1 ? ' item' : ' items') : 'Open to view items', mins: mins + ' min',
          hasUnsent: figuresKnown && unsent > 0, unsent: unsent + ' not sent', hasIssue: issue,
          aria: tk ? 'Table ' + id + ', taken' + (figuresKnown ? ', ' + money(tTotal(id)) : ', open to view items') : 'Table ' + id + ', free',
          style: 'min-height:156px; border-radius:22px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; ' + (tk ? 'background:#F97316; color:#1A0B00; border:2px solid #EA580C; box-shadow:0 10px 22px rgba(249,115,22,0.28)' : 'background:#FFFFFF; color:#0F172A; border:2px solid #E2E8F0; box-shadow:0 4px 12px rgba(15,23,42,0.04)'),
          open: () => this.openTable(id)
        };
      })
    }));
    v.freeCount = free + ' free'; v.takenCount = taken + ' taken';

    // order screen
    const tid = s.tableId; const o = tid ? s.orders[tid] : null;
    v.tableName = tid ? 'Table ' + tid : '';
    v.orderMeta = o ? 'Opened ' + hm(o.openedAt) + (o.openedBy ? ' by ' + o.openedBy : '') + ' · ' + Math.max(0, Math.round((now - o.openedAt) / 60000)) + ' min' : 'Free. Add products to open it.';
    v.statusLabel = o ? 'Taken' : 'Free';
    v.statusStyle = 'height:36px; padding:0 14px; border-radius:999px; display:inline-flex; align-items:center; font-size:15px; font-weight:800; ' + (o ? 'background:#F97316; color:#1A0B00' : 'background:#DCFCE7; color:#14532D');
    const cat = M.catById[s.cat] || { subs: [] };
    const q = s.search.trim().toLowerCase();
    v.cats = M.cats.map(c => {
      const on = c.id === s.cat && !q;
      return {
        label: c.label, pressed: String(on),
        style: 'min-height:96px; width:100%; border-radius:18px; font-size:19px; font-weight:800; padding:8px; ' + (on ? 'background:' + c.color + '; color:#FFFFFF; border:2px solid ' + c.color + '; box-shadow:0 8px 18px rgba(15,23,42,0.15)' : 'background:' + c.tint + '; color:' + c.color + '; border:2px solid transparent'),
        pick: () => this.mut(n => { n.cat = c.id; n.sub = c.subs[0][0]; n.search = ''; })
      };
    });
    v.search = s.search; v.hasSearch = q.length > 0;
    v.onSearch = e => this.setState({ search: e.target.value });
    v.clearSearch = () => this.setState({ search: '' });
    v.subs = cat.subs.map(([id, l]) => {
      const on = id === s.sub && !q;
      return {
        label: l, pressed: String(on),
        style: 'height:50px; padding:0 20px; border-radius:999px; font-size:17px; font-weight:800; white-space:nowrap; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1'),
        pick: () => this.mut(n => { n.sub = id; n.search = ''; })
      };
    });
    const pendQ = {};
    s.items.forEach(i => { if (i.tableId === tid && i.status === 'pending') pendQ[i.pid] = (pendQ[i.pid] || 0) + i.qty; });
    const list = q ? M.products.filter(p => p.name.toLowerCase().includes(q)) : M.products.filter(p => p.sub === s.sub);
    v.searchInfo = list.length + (list.length === 1 ? ' match' : ' matches') + ' in the whole menu';
    v.products = list.map(p => {
      const c = M.catById[p.cat]; const b = pendQ[p.id] || 0;
      return {
        name: p.name, price: money(p.price), hasOpts: p.groups.length > 0, hasBadge: b > 0, badge: String(b),
        aria: 'Add ' + p.name + ', ' + money(p.price) + (p.groups.length ? ', has options' : ''),
        style: 'position:relative; min-height:116px; border-radius:18px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; background:' + c.tint + '; border:2px solid ' + (b > 0 ? c.color : 'transparent'),
        priceStyle: 'font-size:16px; font-weight:800; color:' + c.color,
        add: () => this.addProduct(p.id)
      };
    });
    v.noProducts = list.length === 0;
    v.menuMessage = s.menuLoad === 'loading' ? 'Loading menu…' : s.menuLoad === 'error' ?
      'Menu unavailable. Restart the app and try again.' : 'No products available.';

    const its = tid ? s.items.filter(i => i.tableId === tid) : [];
    const pend = its.filter(i => i.status === 'pending');
    const pc = pend.reduce((a, i) => a + i.qty, 0);
    const tb = on => 'flex:1; height:48px; border:none; border-bottom:4px solid ' + (on ? '#F97316' : 'transparent') + '; background:transparent; font-size:16px; font-weight:800; color:' + (on ? '#0F172A' : '#475569');
    v.tabOrder = s.tab === 'order'; v.tabAct = s.tab === 'activity';
    v.tabOrderSel = String(v.tabOrder); v.tabActSel = String(v.tabAct);
    v.tabOrderStyle = tb(v.tabOrder); v.tabActStyle = tb(v.tabAct);
    v.setTabOrder = () => this.setState({ tab: 'order' });
    v.setTabAct = () => this.setState({ tab: 'activity' });
    v.isEmpty = its.length === 0;
    v.hasPending = pend.length > 0;
    v.pendingCount = pc + (pc === 1 ? ' item' : ' items');
    v.pending = pend.map(i => ({
      name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note, qty: String(i.qty), amount: money(i.qty * i.unit),
      inc: () => this.incItem(i.id), dec: () => this.decItem(i.id), remove: () => this.removeItem(i.id), editNote: () => this.openNote(i.id),
      noteLabel: i.note ? 'Edit note' : 'Note', decAria: 'One less ' + i.name, incAria: 'One more ' + i.name, removeAria: 'Remove ' + i.name
    }));
    const sent = its.filter(i => i.status !== 'pending');
    const byRound = {};
    sent.forEach(i => { (byRound[i.round] = byRound[i.round] || []).push(i); });
    v.rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a).map(r => {
      const L = byRound[r]; const first = L.reduce((a, i) => (i.sentAt < a.sentAt ? i : a), L[0]);
      return {
        title: 'Round ' + r, meta: 'Sent ' + hm(first.sentAt) + ' by ' + first.sentBy,
        items: L.map(i => {
          const qq = bq(i); const all = qq === 0; const c = i.cx[i.cx.length - 1];
          return {
            name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note,
            hasMoved: !!i.movedFrom, moved: 'From Table ' + i.movedFrom,
            qtyLabel: (all ? i.qty : qq) + '×',
            qtyStyle: 'min-width:40px; height:36px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:17px; font-weight:800; ' + (all ? 'background:#F1F5F9; color:#64748B; text-decoration:line-through' : 'background:#0F172A; color:#FFFFFF'),
            nameStyle: 'font-size:17px; font-weight:800; ' + (all ? 'text-decoration:line-through; color:#64748B' : 'color:#0F172A'),
            amount: all ? 'Cancelled' : money(qq * i.unit),
            amountStyle: 'font-size:17px; font-weight:800; white-space:nowrap; color:' + (all ? '#B91C1C' : '#0F172A'),
            routeLabel: i.route === 'bar' ? 'Bar' : 'Kitchen',
            routeStyle: 'height:24px; padding:0 8px; border-radius:6px; display:inline-flex; align-items:center; font-size:12px; font-weight:800; ' + (i.route === 'bar' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#FFEDD5; color:#9A3412'),
            hasCx: i.cxQty > 0,
            cxText: c ? i.cxQty + ' cancelled total · latest: ' + c.qty + ' · ' + c.reason + ' · ' + c.who + ' ' + hm(c.t) + (window.arra ? '' : ' · waiting for owner review') : '',
            canCancel: qq > 0, cancel: () => this.openCancel(i.id), cancelAria: 'Cancel ' + i.name
          };
        })
      };
    });
    const total = its.reduce((a, i) => a + bq(i) * i.unit, 0);
    v.total = money(total);
    v.sendDisabled = pc === 0;
    v.sendLabel = pc ? 'Send order · ' + pc : 'Nothing new to send';
    v.sendStyle = 'flex:2; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (pc ? 'background:#16A34A; color:#FFFFFF; box-shadow:0 10px 22px rgba(22,163,74,0.35)' : 'background:#E2E8F0; color:#475569');
    const billable = sent.filter(i => bq(i) > 0);
    v.billDisabled = !o || (!window.arra && billable.length === 0);
    v.billStyle = 'flex:1; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (v.billDisabled ? 'background:#E2E8F0; color:#475569' : 'background:#2563EB; color:#FFFFFF; box-shadow:0 10px 22px rgba(37,99,235,0.3)');
    v.moveDisabled = !o;
    v.moveStyle = 'flex:1; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:800; ' + (o ? 'border:2px solid #C4B5FD; background:#F5F3FF; color:#5B21B6' : 'border:2px solid #E2E8F0; background:#F8FAFC; color:#64748B');
    v.send = () => this.send();
    v.openBill = () => this.mut(n => { n.modal = { type: window.arra ? 'desktopBill' : 'bill', step: 'confirm', method: null, account: null, printed: 0, backup: false }; });
    v.openMoveTable = () => this.mut(n => { n.modal = { type: 'moveTable', dest: null }; });
    v.openMoveItems = () => this.mut(n => { n.modal = { type: 'moveItems', sel: {}, dest: null }; });
    v.activity = o ? o.log.slice().reverse().map(e => ({ time: hm(e.t), who: e.who, text: e.text })) : [];
    v.noActivity = v.activity.length === 0;

    // history
    const H = s.history;
    v.hist = H.map(h => ({
      no: '#' + h.no, table: h.table, time: hm(h.closedAt), waiter: h.waiter, items: String(h.count), method: h.method, account: 'Account ' + h.account, total: money(h.total),
      accStyle: 'height:30px; padding:0 12px; border-radius:999px; display:inline-flex; align-items:center; font-size:14px; font-weight:800; ' + (h.account === 'A' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#F3E8FF; color:#6B21A8')
    }));
    const sum = f => money(H.filter(f).reduce((a, h) => a + h.total, 0));
    v.hCount = String(H.length);
    v.hCashA = sum(h => h.method === 'Cash' && h.account === 'A');
    v.hCashB = sum(h => h.method === 'Cash' && h.account === 'B');
    v.hCardA = sum(h => h.method === 'Card');

    // modals: defaults
    const md = s.modal; const ty = md ? md.type : '';
    v.hasModal = !!md && ty !== 'desktopBill';
    v.isMods = ty === 'mods'; v.isNote = ty === 'note'; v.isCancel = ty === 'cancel';
    v.isMoveTable = ty === 'moveTable'; v.isMoveItems = ty === 'moveItems'; v.isBill = ty === 'bill';
    v.closeModal = () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.setState({ modal: null }); };
    v.modalTitle = ''; v.modalSub = '';
    v.modalCardStyle = 'background:#FFFFFF; border-radius:26px; width:100%; max-width:' + (ty === 'bill' || ty === 'moveItems' ? '880px' : '760px') + '; max-height:calc(100vh - 40px); overflow:auto; padding:26px; box-sizing:border-box; display:flex; flex-direction:column; gap:20px; box-shadow:0 30px 80px rgba(15,23,42,0.35)';
    v.modGroups = []; v.noteChips = []; v.cxReasons = []; v.mtTables = []; v.miItems = []; v.miTables = []; v.billLines = [];
    const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
    const chip = on => 'min-height:60px; border-radius:16px; padding:10px 14px; font-size:17px; font-weight:800; text-align:center; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1');

    if (ty === 'mods') {
      const p = M.byId[md.pid]; let d = 0, ok = true;
      v.modalTitle = p.name; v.modalSub = 'Pick the options from the paper order. Base price ' + money(p.price) + '.';
      v.modGroups = p.groups.map(gid => {
        const g = M.G[gid]; const sel = md.sel[gid];
        if (g.req && sel == null) ok = false;
        if (sel != null) d += g.opts[sel][1];
        return {
          label: g.label, reqLabel: g.req ? 'Required' : 'Optional',
          reqStyle: 'height:26px; padding:0 10px; border-radius:999px; display:inline-flex; align-items:center; font-size:13px; font-weight:800; ' + (g.req ? (sel == null ? 'background:#FEE2E2; color:#991B1B' : 'background:#DCFCE7; color:#14532D') : 'background:#F1F5F9; color:#475569'),
          options: g.opts.map(([l, dd], k) => {
            const on = sel === k;
            return {
              label: l, price: dd ? (dd > 0 ? '+' : '') + money(dd) : 'Included', pressed: String(on), disabled: !!md.saving,
              style: 'min-height:84px; border-radius:16px; padding:12px; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:6px; text-align:left; ' + (on ? 'background:#2563EB; color:#FFFFFF; border:2px solid #2563EB' : 'background:#F8FAFC; color:#0F172A; border:2px solid #CBD5E1'),
              pick: () => { if (!this._itemBusy && !this.state.modal?.saving) this.mut(n => { if (n.modal.sel[gid] === k && !g.req) delete n.modal.sel[gid]; else n.modal.sel[gid] = k; }); }
            };
          })
        };
      });
      v.modAddDisabled = !ok || !!md.saving;
      v.modAddLabel = md.saving ? 'Saving…' : ok ? 'Add to order · ' + money(p.price + d) : 'Pick the required options first';
      v.modAddStyle = bigBtn(ok && !md.saving, '#16A34A', '#FFFFFF');
      v.modAdd = () => this.modAdd();
    }

    if (ty === 'note') {
      const it = s.items.find(i => i.id === md.itemId);
      v.modalTitle = 'Note for ' + (it ? it.name : '');
      v.modalSub = md.error || (window.arra ? 'Save a note for this item. Leave blank to remove it.' : 'This prints on the kitchen or bar ticket.');
      v.noteText = md.text; v.noteSaving = !!md.saving;
      const parts = md.text.split(',').map(x => x.trim()).filter(Boolean);
      v.noteChips = ['No onions', 'Less salt', 'Extra spicy', 'Sauce on the side', 'No ice', 'Bring first', 'For sharing', 'Kids portion'].map(l => {
        const on = parts.includes(l);
        return {
          label: l, pressed: String(on), style: chip(on),
          toggle: () => this.mut(n => { let ps = n.modal.text.split(',').map(x => x.trim()).filter(Boolean); ps = ps.includes(l) ? ps.filter(x => x !== l) : ps.concat(l); n.modal.text = ps.join(', '); })
        };
      });
      v.onNoteText = e => { const val = e.target.value; this.setState(st => ({ modal: Object.assign({}, st.modal, { text: val }) })); };
      v.saveNote = () => this.saveNote();
    }

    if (ty === 'cancel') {
      const it = s.items.find(i => i.id === md.itemId);
      const mx = it ? bq(it) : 1; const l = it ? this.rlabel(it.route) : '';
      v.modalTitle = 'Cancel a sent item';
      v.modalSub = 'It was already sent, so it stays on record, crossed out.';
      v.cxName = it ? it.name : ''; v.cxMods = it ? it.mods : ''; v.cxHasMods = !!(it && it.mods);
      v.cxMeta = it ? 'Round ' + it.round + ' · sent ' + hm(it.sentAt) + ' to ' + l : '';
      v.cxMulti = mx > 1; v.cxQty = String(md.qty); v.cxMax = 'of ' + mx;
      v.cxInc = () => this.mut(n => { if (!n.modal.requestId) n.modal.qty = Math.min(mx, n.modal.qty + 1); });
      v.cxDec = () => this.mut(n => { if (!n.modal.requestId) n.modal.qty = Math.max(1, n.modal.qty - 1); });
      v.cxReasons = ['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].map(r => ({
        label: r, pressed: String(md.reason === r), style: chip(md.reason === r),
        pick: () => this.mut(n => { if (!n.modal.requestId) n.modal.reason = r; })
      }));
      v.cxIsOther = md.reason === 'Other'; v.cxOther = md.other;
      v.onCxOther = e => { const val = e.target.value; this.setState(st => st.modal.requestId ? null : ({ modal: Object.assign({}, st.modal, { other: val }) })); };
      const ok = !!md.reason && (md.reason !== 'Other' || md.other.trim().length > 0);
      v.cxDisabled = !ok;
      v.cxStyle = 'flex:2; ' + bigBtn(ok, '#DC2626', '#FFFFFF').replace('height:72px', 'height:64px');
      v.cxInfo = window.arra ? 'Only an authorized administrator signed in under their own name can save this correction. Tell preparation staff in person; no notice is printed.' : 'The ' + l + ' already has this ticket. A cancel notice prints there, but if they already started, tell them in person too. This is saved under your name and goes to the owner for review.';
      v.cxConfirm = () => this.confirmCancel();
    }

    if (ty === 'moveTable') {
      v.modalTitle = 'Move the whole table';
      v.modalSub = md.error || ('Everything on Table ' + tid + ' moves to the table you pick. Table ' + tid + ' becomes free. Only free tables can be picked, so no order gets overwritten.');
      v.mtTables = s.sections.flatMap(sec => sec.ids).filter(id => id !== tid).map(id => {
        const tk = !!s.orders[id]; const on = md.dest === id;
        return {
          num: String(id), sub: tk ? 'Taken' : 'Free', disabled: tk,
          aria: 'Table ' + id + (tk ? ', taken, not available' : ', free'),
          style: 'min-height:84px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (tk ? 'background:#F1F5F9; color:#64748B; border:2px dashed #CBD5E1' : (on ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
          pick: () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.mut(n => { n.modal.dest = id; n.modal.error = ''; }); }
        };
      });
      v.mtDisabled = md.dest == null || !!md.saving;
      v.mtLabel = md.dest != null ? 'Move everything to Table ' + md.dest : 'Pick a free table';
      v.mtStyle = bigBtn(md.dest != null, '#7C3AED', '#FFFFFF');
      v.mtConfirm = () => this.confirmMoveTable();
    }

    if (ty === 'moveItems') {
      v.modalTitle = 'Move items to another table';
      v.modalSub = md.error || ('Select whole item lines. Confirming adds them to the chosen table without replacing its order.');
      const elig = its.filter(i => bq(i) > 0);
      let k = 0, units = 0;
      v.miItems = elig.map(i => {
        const on = !!md.sel[i.id]; if (on) { k++; units += bq(i); }
        return {
          label: bq(i) + '× ' + i.name, sub: (i.status === 'pending' ? 'Not sent yet' : 'Round ' + i.round + ' · ' + this.rlabel(i.route)) + (i.mods ? ' · ' + i.mods : ''),
          checked: on, pressed: String(on),
          style: 'min-height:60px; border-radius:14px; padding:10px 14px; display:flex; align-items:center; gap:12px; ' + (on ? 'background:#F5F3FF; border:2px solid #7C3AED; color:#0F172A' : 'background:#FFFFFF; border:2px solid #E2E8F0; color:#0F172A'),
          boxStyle: 'width:28px; height:28px; border-radius:8px; flex:none; display:flex; align-items:center; justify-content:center; box-sizing:border-box; ' + (on ? 'background:#7C3AED; border:2px solid #7C3AED' : 'background:#FFFFFF; border:2px solid #94A3B8'),
          toggle: () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.mut(n => { n.modal.sel[i.id] = !n.modal.sel[i.id]; }); }
        };
      });
      v.miTables = s.sections.flatMap(sec => sec.ids).filter(id => id !== tid).map(id => {
        const tk = !!s.orders[id]; const on = md.dest === id;
        return {
          num: String(id), sub: tk ? 'Taken · adds on' : 'Free',
          aria: 'Table ' + id + (tk ? ', taken, items will be added to its order' : ', free'),
          style: 'min-height:76px; border-radius:14px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (on ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : (tk ? 'background:#FFEDD5; color:#7C2D12; border:2px solid #FDBA74' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
          pick: () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.mut(n => { n.modal.dest = id; n.modal.error = ''; }); }
        };
      });
      const ok = k > 0 && md.dest != null;
      v.miDisabled = !ok || !!md.saving;
      v.miLabel = md.saving ? 'Saving…' : md.unresolved ? 'Retry move' : ok ? 'Move ' + units + (units === 1 ? ' item' : ' items') + ' to Table ' + md.dest : (k === 0 ? 'Tick at least one item' : 'Pick a table');
      v.miStyle = bigBtn(ok, '#7C3AED', '#FFFFFF');
      v.miConfirm = () => this.confirmMoveItems();
    }

    if (ty === 'bill') {
      const b = md; const st = b.step;
      v.bConfirm = st === 'confirm'; v.bMethod = st === 'method'; v.bAccount = st === 'account';
      v.bReview = st === 'review'; v.bFailed = st === 'failed'; v.bPrinted = st === 'printed';
      v.bReceipt = v.bReview || v.bFailed || v.bPrinted;
      v.billLines = billable.map(i => ({ qty: bq(i) + '×', name: i.name, mods: i.mods, hasMods: !!i.mods, amount: money(bq(i) * i.unit) }));
      v.billTotal = money(billable.reduce((a, i) => a + bq(i) * i.unit, 0));
      v.billTable = 'Table ' + tid;
      v.billBlocked = pc > 0;
      v.billBlockedText = pc + ' new ' + (pc === 1 ? 'item is' : 'items are') + ' not sent yet. Send or remove ' + (pc === 1 ? 'it' : 'them') + ' before printing the bill.';
      v.bYesStyle = 'flex:2; ' + bigBtn(pc === 0, '#2563EB', '#FFFFFF');
      const titles = {
        confirm: ['Print the bill for Table ' + tid + '?', 'Check the items with the customer. Cancelled items are not on the bill.'],
        method: ['How is the customer paying?', 'Table ' + tid + ' · ' + v.billTotal],
        account: ['Cash: which account?', 'Table ' + tid + ' · ' + v.billTotal + ' · each account has its own bill printer'],
        review: ['Check and print', 'Table ' + tid + ' · ' + v.billTotal],
        failed: ['The bill did not print', 'Table ' + tid + ' · nothing was charged'],
        printed: ['Bill printed', 'Table ' + tid + ' · ' + v.billTotal]
      };
      v.modalTitle = titles[st][0]; v.modalSub = titles[st][1];
      v.isCard = b.method === 'Card';
      const acc = b.method === 'Card' ? 'A' : (b.account || '');
      v.billMethod = b.method || ''; v.billAccount = acc ? 'Account ' + acc : '';
      v.billAccStyle = acc === 'B' ? 'color:#6B21A8' : 'color:#1E40AF';
      v.billPrinter = acc ? 'Printer ' + acc + (b.backup ? ' (backup)' : '') : '';
      v.billMethodLine = (b.method || '') + ' · Account ' + acc;
      v.billNo = 'Bill #' + s.billNo; v.billWaiter = 'Waiter: ' + w.name;
      const dd = new Date(now);
      v.billDate = String(dd.getDate()).padStart(2, '0') + '.' + String(dd.getMonth() + 1).padStart(2, '0') + '.' + dd.getFullYear() + ' ' + hm(now);
      v.printedText = 'Printed on Printer ' + acc + (b.backup ? ' (backup)' : '') + (b.printed > 1 ? ' · printed ' + b.printed + ' times, still one payment' : '') + '.';
      v.failText = 'Printer ' + acc + ' is not responding. The bill did not print and no payment was recorded. The order is safe.';
      v.bYes = () => this.bSet(m => { if (!pc) m.step = 'method'; });
      v.bCash = () => this.bSet(m => { m.method = 'Cash'; m.account = null; m.step = 'account'; });
      v.bCard = () => this.bSet(m => { m.method = 'Card'; m.account = 'A'; m.step = 'review'; });
      v.bAccA = () => this.bSet(m => { m.account = 'A'; m.step = 'review'; });
      v.bAccB = () => this.bSet(m => { if (m.method === 'Cash') { m.account = 'B'; m.step = 'review'; } });
      v.bBack = () => this.bSet(m => {
        if (m.step === 'method') m.step = 'confirm';
        else if (m.step === 'account') m.step = 'method';
        else if (m.step === 'review') m.step = m.method === 'Card' ? 'method' : 'account';
      });
      v.bPrint = () => this.printBill(false);
      v.bRetry = () => this.printBill(false);
      v.bBackup = () => this.printBill(true);
      v.bReprint = () => this.printBill(false);
      v.bPaid = () => this.paid();
    }

    // toast
    const t = s.toast;
    v.hasToast = !!t; v.toastText = t ? t.msg : '';
    const tc = t && t.kind === 'err' ? 'background:#DC2626; color:#FFFFFF' : (t && t.kind === 'warn' ? 'background:#FDE047; color:#1A1400' : 'background:#0F172A; color:#FFFFFF');
    v.toastStyle = 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); max-width:min(720px, calc(100vw - 32px)); padding:16px 24px; border-radius:16px; font-size:18px; font-weight:800; line-height:1.35; z-index:80; box-shadow:0 18px 40px rgba(15,23,42,0.3); ' + tc;

    return v;
  }
  render() {
    if (this.state.screen === 'transferCorrection') return React.createElement(TransferCorrection, { onBack: () => this.switchWaiter() });
    const adminScreens = { operationalReports: OperationalReports, financialVisibility: FinancialVisibility, orderHistory: OrderHistory, employeeConfig: EmployeeConfig, menuConfig: MenuConfig, tableConfig: TableConfig };
    const AdminPage = adminScreens[this.state.screen];
    if (this.state.screen === 'admin' || AdminPage) return React.createElement(ArraComponents.AdminShell, {
      screen: this.state.screen, user: this.state.waiter?.name,
      navigate: screen => this.setState({ screen }),
      back: () => { this.setState({ screen: 'tables' }); this.loadDesktopData(); },
      switchUser: () => this.switchWaiter()
    }, AdminPage ? React.createElement(AdminPage, { onBack: () => this.setState({ screen: 'admin' }) }) : null);
    const v = this.renderVals();
    return React.createElement(React.Fragment, null, (window.arra && this.state.modal?.type === 'desktopBill' ? React.createElement(DesktopBill, { orderId: this.state.orders[this.state.tableId]?.id, onClose: () => this.setState({ modal: null }), onPaid: () => { this.setState({ modal: null, screen: 'tables' }); this.loadDesktopData(); } }) : null), "\n", React.createElement("div", {"style": style("height: 100vh; min-height: 820px; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden")} , "\n\n", "\n", (v.isLogin ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; display: flex; flex-wrap: wrap; min-height: 0; overflow: auto")} , "\n  ", React.createElement("div", {"style": style("flex: 1 1 420px; background: #F97316; color: #1A0B00; padding: 56px; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; box-sizing: border-box")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("width: 52px; height: 52px; border-radius: 16px; background: #1A0B00; color: #F97316; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 28px")} , "A"), "\n      ", React.createElement("div", {"style": style("font-weight: 800; font-size: 22px")} , "Arra POS"), "\n    "), "\n    ", React.createElement("div", {} , "\n      ", React.createElement("div", {"style": style("font-size: 104px; font-weight: 800; line-height: 0.9; letter-spacing: -0.04em")} , "Arra"), "\n      ", React.createElement("div", {"style": style("font-size: 26px; font-weight: 700; margin-top: 20px; max-width: 460px; line-height: 1.3")} , "Paper order in. Kitchen and bar tickets out. Bill printed. Done."), "\n    "), "\n    ", React.createElement("div", {"style": style("font-size: 16px; font-weight: 700")} , "Tetovo · Main PC"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1 1 420px; display: flex; align-items: center; justify-content: center; padding: 48px 24px; box-sizing: border-box; background: #FFFFFF")} , "\n    ", React.createElement("div", {"style": style("width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 22px")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , "Restaurant sign in"), "\n      ", React.createElement("p", {"style": style("margin: 0; font-size: 18px; color: #475569; line-height: 1.45")} , "Do this once at the start of the day. Waiters pick their own name on the next screen."), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 700")} , "Username\n        ", React.createElement("input", {"type": "text", "value": v.user, "onChange": v.onUser, "autoComplete": "username", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 20px; font-weight: 600; color: #0F172A; background: #FFFFFF")}), "\n      "), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 700")} , "Password\n        ", React.createElement("input", {"type": "password", "value": v.pass, "onChange": v.onPass, "autoComplete": "current-password", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 20px; font-weight: 600; color: #0F172A; background: #FFFFFF")}), "\n      "), "\n      ", React.createElement("button", {"onClick": v.login, "style": style("height: 68px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 22px; font-weight: 800; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , "Sign in"), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isWaiters ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; overflow: auto; padding: 32px 24px 48px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("width: 44px; height: 44px; border-radius: 14px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24px")} , "A"), "\n      ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px; flex: 1")} , "Arra POS"), "\n      ", React.createElement("button", {"onClick": v.signOut, "style": style("height: 48px; padding: 0 18px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #334155; font-size: 16px; font-weight: 700")} , "Sign out restaurant"), "\n    "), "\n    ", React.createElement("div", {"style": style("text-align: center; display: flex; flex-direction: column; gap: 10px")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 44px; font-weight: 800; letter-spacing: -0.02em")} , "Who is using the PC?"), "\n      ", React.createElement("p", {"style": style("margin: 0; font-size: 20px; color: #475569")} , window.arra ? (this.state.waiterMessage || 'Choose your name.') : 'Demo waiter selection only.'), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 18px")} , "\n      ", (v.waiters || []).map((w, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": w.pick, "style": style("min-height: 190px; border-radius: 24px; border: 2px solid #E2E8F0; background: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06)")} , "\n          ", React.createElement("div", {"style": style(w.avStyle)} , w.initial), "\n          ", React.createElement("div", {"style": style("font-size: 26px; font-weight: 800; color: #0F172A")} , w.name), "\n          ", (w.hasPin ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #475569")} , "\n              ", React.createElement("svg", {"width": "16", "height": "16", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "5", "y": "11", "width": "14", "height": "10", "rx": "2"}), React.createElement("path", {"d": "M8 11V7a4 4 0 0 1 8 0v4"})), "\n              PIN\n            "), "\n          ") : null), "\n          ", (w.noPin ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("font-size: 14px; font-weight: 700; color: #475569")} , "No PIN"), "\n          ") : null), "\n        "), "\n      "))), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isPin ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 32px 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("width: 100%; max-width: 420px; background: #FFFFFF; border-radius: 28px; padding: 32px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 22px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.1)")} , "\n    ", React.createElement("div", {"style": style(v.pinAv)} , v.pinInitial), "\n    ", React.createElement("div", {"style": style("text-align: center")} , "\n      ", React.createElement("div", {"style": style("font-size: 28px; font-weight: 800")} , "Hi " + v.pinName), "\n      ", React.createElement("div", {"style": style("font-size: 17px; color: #475569; margin-top: 4px")} , "Enter your 4-digit PIN"), "\n    "), "\n    ", React.createElement("div", {"style": style("display: flex; gap: 18px"), "aria-hidden": "true"} , "\n      ", (v.pinDots || []).map((d, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, React.createElement("div", {"style": style(d.style)})))), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%")} , "\n      ", (v.keys || []).map((k, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": k.press, "aria-label": k.aria, "style": style(k.style)} , k.label), "\n      "))), "\n    "), "\n    ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 600")} , window.arra ? '' : 'Demo: any 4 digits work'), "\n    ", React.createElement("button", {"onClick": v.pinBack, "style": style("height: 48px; padding: 0 18px; border-radius: 12px; border: none; background: transparent; color: #1D4ED8; font-size: 17px; font-weight: 700")} , "Not you? Pick another name"), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isApp ? React.createElement(React.Fragment, null, "\n", React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , v.clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , "Switch waiter"), "\n  "), "\n"), "\n\n", (window.arra ? React.createElement(PrintJobs, { revision: this.state.printRevision || 0 }) : null), (v.hasFailed ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"role": "alert", "style": style("flex: none; background: #DC2626; color: #FFFFFF; padding: 12px 20px; display: flex; flex-direction: column; gap: 10px")} , "\n  ", (v.failed || []).map((f, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n      ", React.createElement("svg", {"width": "26", "height": "26", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 9V3h12v6"}), React.createElement("rect", {"x": "6", "y": "14", "width": "12", "height": "7"}), React.createElement("path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"})), "\n      ", React.createElement("div", {"style": style("flex: 1 1 320px; font-size: 18px; font-weight: 700; line-height: 1.3")} , f.text), "\n      ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , f.attempts), "\n      ", React.createElement("button", {"onClick": f.retry, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: none; background: #FFFFFF; color: #B91C1C; font-size: 17px; font-weight: 800")} , "Retry"), "\n      ", React.createElement("button", {"onClick": f.backup, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: 2px solid #FFFFFF; background: transparent; color: #FFFFFF; font-size: 17px; font-weight: 800")} , "Print on backup printer"), "\n    "), "\n  "))), "\n"), "\n") : null), "\n\n", "\n", (v.isTables ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1360px; margin: 0 auto; display: flex; flex-direction: column; gap: 26px")} , "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800; flex: 1")} , "Tables"), window.arra ? React.createElement("button", { className: "admin-entry", onClick: () => this.setState({ screen: "admin" }) }, "Administration →") : null, "\n      ", React.createElement("span", {"style": style("height: 40px; padding: 0 16px; border-radius: 999px; background: #FFFFFF; border: 2px solid #E2E8F0; display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800")} , React.createElement("span", {"style": style("width: 14px; height: 14px; border-radius: 999px; background: #FFFFFF; border: 3px solid #16A34A; box-sizing: border-box")}), v.freeCount), "\n      ", React.createElement("span", {"style": style("height: 40px; padding: 0 16px; border-radius: 999px; background: #FFEDD5; border: 2px solid #F97316; display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; color: #7C2D12")} , React.createElement("span", {"style": style("width: 14px; height: 14px; border-radius: 999px; background: #F97316")}), v.takenCount), "\n    "), "\n    ", (v.tableMessage ? React.createElement("p", {"role": "status"}, v.tableMessage) : null), "\n    ", (v.sections || []).map((sec, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n      ", React.createElement("section", {"style": style("display: flex; flex-direction: column; gap: 12px")} , "\n        ", React.createElement("h2", {"style": style("margin: 0; font-size: 16px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.08em")} , sec.label), "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); gap: 14px")} , "\n          ", (sec.tables || []).map((t, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": t.open, "aria-label": t.aria, "style": style(t.style)} , "\n              ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 8px")} , "\n                ", React.createElement("span", {"style": style("font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.02em")} , t.num), "\n                ", (t.taken ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 30px; padding: 0 10px; border-radius: 999px; background: rgba(26, 11, 0, 0.12); display: inline-flex; align-items: center; font-size: 14px; font-weight: 800")} , t.mins), "\n                ") : null), "\n              "), "\n              ", (t.taken ? React.createElement(React.Fragment, null, "\n                ", React.createElement("div", {"style": style("width: 100%")} , "\n                  ", React.createElement("div", {"style": style("font-size: 22px; font-weight: 800")} , t.total), "\n                  ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; margin-top: 2px")} , t.waiter + " · " + t.count), "\n                "), "\n              ") : null), "\n              ", (t.free ? React.createElement(React.Fragment, null, "\n                ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #15803D")} , "Free"), "\n              ") : null), "\n              ", React.createElement("div", {"style": style("display: flex; gap: 6px; flex-wrap: wrap")} , "\n                ", (t.hasUnsent ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 28px; padding: 0 10px; border-radius: 999px; background: #FFFFFF; color: #B91C1C; display: inline-flex; align-items: center; font-size: 13px; font-weight: 800; border: 2px solid #B91C1C")} , t.unsent), "\n                ") : null), "\n                ", (t.hasIssue ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 28px; padding: 0 10px; border-radius: 999px; background: #DC2626; color: #FFFFFF; display: inline-flex; align-items: center; font-size: 13px; font-weight: 800")} , "Ticket not printed"), "\n                ") : null), "\n              "), "\n            "), "\n          "))), "\n        "), "\n      "), "\n    "))), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isOrder ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("flex: 1; min-height: 0; display: flex; flex-wrap: wrap; overflow: auto")} , "\n\n  ", React.createElement("section", {"aria-label": "Menu", "style": style("flex: 999 1 560px; min-width: 0; display: flex; height: 100%; min-height: 520px")} , "\n    ", React.createElement("nav", {"aria-label": "Categories", "style": style("width: 128px; flex: none; background: #FFFFFF; border-right: 1px solid #E2E8F0; padding: 14px 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; overflow: auto")} , "\n      ", (v.cats || []).map((c, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("button", {"onClick": c.pick, "aria-pressed": c.pressed, "style": style(c.style)} , c.label), "\n      "))), "\n    "), "\n    ", React.createElement("div", {"style": style("flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0")} , "\n      ", React.createElement("div", {"style": style("padding: 14px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #E2E8F0; background: #FFFFFF")} , "\n        ", React.createElement("div", {"style": style("display: flex; gap: 8px; flex-wrap: wrap; flex: 1 1 360px")} , "\n          ", (v.subs || []).map((sb, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": sb.pick, "aria-pressed": sb.pressed, "style": style(sb.style)} , sb.label), "\n          "))), "\n        "), "\n        ", React.createElement("div", {"style": style("position: relative; flex: 0 1 280px; min-width: 200px")} , "\n          ", React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "#475569", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true", "style": style("position: absolute; left: 14px; top: 14px")} , React.createElement("circle", {"cx": "11", "cy": "11", "r": "7"}), React.createElement("path", {"d": "M21 21l-4.3-4.3"})), "\n          ", React.createElement("input", {"type": "text", "value": v.search, "onChange": v.onSearch, "placeholder": "Search menu", "aria-label": "Search the whole menu", "style": style("width: 100%; box-sizing: border-box; height: 48px; border-radius: 999px; border: 2px solid #CBD5E1; padding: 0 44px 0 44px; font-size: 17px; font-weight: 600; color: #0F172A; background: #F8FAFC")}), "\n          ", (v.hasSearch ? React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": v.clearSearch, "aria-label": "Clear search", "style": style("position: absolute; right: 4px; top: 4px; width: 40px; height: 40px; border-radius: 999px; border: none; background: #E2E8F0; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M18 6L6 18M6 6l12 12"}))), "\n          ") : null), "\n        "), "\n      "), "\n      ", React.createElement("div", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 16px; box-sizing: border-box")} , "\n        ", (v.hasSearch ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; color: #475569; margin-bottom: 12px")} , v.searchInfo), "\n        ") : null), "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 12px; align-content: start")} , "\n          ", (v.products || []).map((p, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": p.add, "aria-label": p.aria, "style": style(p.style)} , "\n              ", (p.hasBadge ? React.createElement(React.Fragment, null, "\n                ", React.createElement("span", {"style": style("position: absolute; top: -8px; right: -8px; min-width: 32px; height: 32px; padding: 0 8px; box-sizing: border-box; border-radius: 999px; background: #0F172A; color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; border: 3px solid #FFFFFF")} , p.badge), "\n              ") : null), "\n              ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800; line-height: 1.2; color: #0F172A")} , p.name), "\n              ", React.createElement("span", {"style": style("display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px")} , "\n                ", React.createElement("span", {"style": style(p.priceStyle)} , p.price), "\n                ", (p.hasOpts ? React.createElement(React.Fragment, null, "\n                  ", React.createElement("span", {"style": style("height: 26px; padding: 0 9px; border-radius: 999px; background: #FFFFFF; color: #0F172A; display: inline-flex; align-items: center; font-size: 12px; font-weight: 800")} , "Options"), "\n                ") : null), "\n              "), "\n            "), "\n          "))), "\n        "), "\n        ", (v.noProducts ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("padding: 48px 16px; text-align: center; font-size: 18px; font-weight: 700; color: #475569")} , v.hasSearch ? "Nothing on the menu matches that." : v.menuMessage), "\n        ") : null), "\n      "), "\n    "), "\n  "), "\n\n  ", React.createElement("aside", {"aria-label": "Current order", "style": style("flex: 1 1 410px; min-width: 0; max-width: 100%; background: #FFFFFF; border-left: 1px solid #E2E8F0; display: flex; flex-direction: column; height: 100%; min-height: 520px")} , "\n    ", React.createElement("div", {"style": style("padding: 14px 16px 0; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid #E2E8F0")} , "\n      ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 12px")} , "\n        ", React.createElement("button", {"onClick": v.goTables, "aria-label": "Back to tables", "style": style("width: 52px; height: 52px; flex: none; border-radius: 14px; border: 2px solid #E2E8F0; background: #FFFFFF; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "24", "height": "24", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M15 18l-6-6 6-6"}))), "\n        ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n          ", React.createElement("div", {"style": style("font-size: 30px; font-weight: 800; line-height: 1.1")} , v.tableName), "\n          ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 700; margin-top: 2px")} , v.orderMeta), "\n        "), "\n        ", React.createElement("span", {"style": style(v.statusStyle)} , v.statusLabel), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 8px")} , "\n        ", React.createElement("button", {"onClick": v.openMoveItems, "disabled": v.moveDisabled, "style": style(v.moveStyle)} , "\n          ", React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M5 12h14"}), React.createElement("path", {"d": "M13 6l6 6-6 6"})), "\n          Move items\n        "), "\n        ", React.createElement("button", {"onClick": v.openMoveTable, "disabled": v.moveDisabled, "style": style(v.moveStyle)} , "\n          ", React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "3", "y": "7", "width": "7", "height": "10", "rx": "1.5"}), React.createElement("path", {"d": "M14 12h7"}), React.createElement("path", {"d": "M18 8l3 4-3 4"})), "\n          Move whole table\n        "), "\n      "), "\n      ", React.createElement("div", {"role": "tablist", "style": style("display: flex; gap: 4px")} , "\n        ", React.createElement("button", {"role": "tab", "aria-selected": v.tabOrderSel, "onClick": v.setTabOrder, "style": style(v.tabOrderStyle)} , "Order"), "\n        ", React.createElement("button", {"role": "tab", "aria-selected": v.tabActSel, "onClick": v.setTabAct, "style": style(v.tabActStyle)} , "Activity log"), "\n      "), "\n    "), "\n\n    ", React.createElement("div", {"style": style("flex: 1; min-height: 0; overflow: auto; background: #F8FAFC")} , "\n      ", (v.tabOrder ? React.createElement(React.Fragment, null, "\n        ", (v.isEmpty ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("padding: 56px 28px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px")} , "\n            ", React.createElement("div", {"style": style("width: 72px; height: 72px; border-radius: 999px; background: #FFEDD5; color: #C2410C; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "34", "height": "34", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.2", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 2h12v20l-3-2-3 2-3-2-3 2z"}), React.createElement("path", {"d": "M9 7h6M9 11h6M9 15h4"}))), "\n            ", React.createElement("div", {"style": style("font-size: 22px; font-weight: 800")} , "No items yet"), "\n            ", React.createElement("div", {"style": style("font-size: 17px; color: #475569; line-height: 1.4")} , "Copy the paper order: tap the products on the left. Nothing goes to the kitchen until you press Send."), "\n          "), "\n        ") : null), "\n\n        ", (v.hasPending ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("margin: 12px; border: 2px solid #16A34A; border-radius: 18px; overflow: hidden; background: #FFFFFF")} , "\n            ", React.createElement("div", {"style": style("background: #DCFCE7; color: #14532D; padding: 10px 14px; font-weight: 800; font-size: 15px; display: flex; justify-content: space-between; letter-spacing: 0.03em")} , "\n              ", React.createElement("span", {} , "NEW · NOT SENT YET"), React.createElement("span", {} , v.pendingCount), "\n            "), "\n            ", (v.pending || []).map((it, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("padding: 12px 14px; border-top: 1px solid #E2E8F0; display: flex; flex-direction: column; gap: 10px")} , "\n                ", React.createElement("div", {"style": style("display: flex; gap: 10px; align-items: flex-start")} , "\n                  ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n                    ", React.createElement("div", {"style": style("font-size: 18px; font-weight: 800")} , it.name), "\n                    ", (it.hasMods ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("font-size: 15px; color: #475569; font-weight: 700; margin-top: 2px")} , it.mods)) : null), "\n                    ", (it.hasNote ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("display: inline-flex; margin-top: 6px; padding: 4px 10px; border-radius: 8px; background: #FEF3C7; color: #78350F; font-size: 14px; font-weight: 800")} , "Note: " + it.note)) : null), "\n                  "), "\n                  ", React.createElement("div", {"style": style("font-size: 18px; font-weight: 800; white-space: nowrap")} , it.amount), "\n                "), "\n                ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 8px")} , "\n                  ", React.createElement("button", {"onClick": it.dec, "aria-label": it.decAria, "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "3", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M5 12h14"}))), "\n                  ", React.createElement("span", {"style": style("min-width: 34px; text-align: center; font-size: 22px; font-weight: 800")} , it.qty), "\n                  ", React.createElement("button", {"onClick": it.inc, "aria-label": it.incAria, "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "3", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M12 5v14M5 12h14"}))), "\n                  ", React.createElement("div", {"style": style("flex: 1")}), "\n                  ", React.createElement("button", {"onClick": it.editNote, "style": style("height: 48px; padding: 0 14px; border-radius: 12px; border: 2px solid #FCD34D; background: #FFFBEB; color: #78350F; font-size: 15px; font-weight: 800; display: flex; align-items: center; gap: 6px")} , React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M12 20h9"}), React.createElement("path", {"d": "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"})), it.noteLabel), "\n                  ", React.createElement("button", {"onClick": it.remove, "aria-label": it.removeAria, "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #FECACA; background: #FEF2F2; color: #B91C1C; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "20", "height": "20", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M3 6h18"}), React.createElement("path", {"d": "M8 6V4h8v2"}), React.createElement("path", {"d": "M19 6l-1 14H6L5 6"}))), "\n                "), "\n              "), "\n            "))), "\n          "), "\n        ") : null), "\n\n        ", (v.rounds || []).map((r, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("margin: 12px; border: 1px solid #E2E8F0; border-radius: 18px; overflow: hidden; background: #FFFFFF")} , "\n            ", React.createElement("div", {"style": style("background: #F1F5F9; padding: 10px 14px; display: flex; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 800; color: #334155")} , "\n              ", React.createElement("span", {} , r.title), React.createElement("span", {} , r.meta), "\n            "), "\n            ", (r.items || []).map((it, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("padding: 12px 14px; border-top: 1px solid #EEF2F7; display: flex; gap: 12px; align-items: flex-start")} , "\n                ", React.createElement("span", {"style": style(it.qtyStyle)} , it.qtyLabel), "\n                ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n                  ", React.createElement("div", {"style": style(it.nameStyle)} , it.name), "\n                  ", (it.hasMods ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 700; margin-top: 2px")} , it.mods)) : null), "\n                  ", (it.hasNote ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("display: inline-flex; margin-top: 6px; padding: 3px 9px; border-radius: 8px; background: #FEF3C7; color: #78350F; font-size: 13px; font-weight: 800")} , "Note: " + it.note)) : null), "\n                  ", React.createElement("div", {"style": style("display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap")} , "\n                    ", React.createElement("span", {"style": style(it.routeStyle)} , it.routeLabel), "\n                    ", (it.hasMoved ? React.createElement(React.Fragment, null, React.createElement("span", {"style": style("height: 24px; padding: 0 8px; border-radius: 6px; background: #EDE9FE; color: #5B21B6; display: inline-flex; align-items: center; font-size: 12px; font-weight: 800")} , it.moved)) : null), "\n                  "), "\n                  ", (it.hasCx ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("margin-top: 6px; font-size: 13px; font-weight: 800; color: #B91C1C")} , it.cxText)) : null), "\n                "), "\n                ", React.createElement("div", {"style": style("display: flex; flex-direction: column; align-items: flex-end; gap: 8px")} , "\n                  ", React.createElement("div", {"style": style(it.amountStyle)} , it.amount), "\n                  ", (it.canCancel ? React.createElement(React.Fragment, null, "\n                    ", React.createElement("button", {"onClick": it.cancel, "aria-label": it.cancelAria, "style": style("height: 44px; padding: 0 14px; border-radius: 12px; border: 2px solid #FECACA; background: #FFFFFF; color: #B91C1C; font-size: 14px; font-weight: 800")} , "Cancel"), "\n                  ") : null), "\n                "), "\n              "), "\n            "))), "\n          "), "\n        "))), "\n      ") : null), "\n\n      ", (v.tabAct ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("padding: 14px 16px; display: flex; flex-direction: column; gap: 4px")} , "\n          ", React.createElement("div", {"style": style("font-size: 14px; color: #475569; font-weight: 700; padding-bottom: 8px")} , "Every action on this table, with who did it. Waiters can't edit this list."), "\n          ", (v.activity || []).map((a, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; gap: 12px; padding: 10px 12px; background: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0")} , "\n              ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 800; color: #334155; width: 48px; flex: none")} , a.time), "\n              ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 800; color: #1D4ED8; width: 68px; flex: none")} , a.who), "\n              ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 600; color: #0F172A; line-height: 1.35")} , a.text), "\n            "), "\n          "))), "\n          ", (v.noActivity ? React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("padding: 32px 8px; text-align: center; font-size: 16px; color: #475569; font-weight: 700")} , "Nothing has happened on this table yet."), "\n          ") : null), "\n        "), "\n      ") : null), "\n    "), "\n\n    ", React.createElement("div", {"style": style("border-top: 1px solid #E2E8F0; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; background: #FFFFFF")} , "\n      ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; align-items: baseline")} , "\n        ", React.createElement("span", {"style": style("font-size: 17px; font-weight: 800; color: #475569")} , "Table total"), "\n        ", React.createElement("span", {"style": style("font-size: 32px; font-weight: 800; letter-spacing: -0.01em")} , v.total), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.openBill, "disabled": v.billDisabled, "style": style(v.billStyle)} , "\n          ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 2h12v20l-3-2-3 2-3-2-3 2z"}), React.createElement("path", {"d": "M9 7h6M9 11h6M9 15h4"})), "\n          Bill\n        "), "\n        ", React.createElement("button", {"onClick": v.send, "disabled": v.sendDisabled, "style": style(v.sendStyle)} , "\n          ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M22 2L11 13"}), React.createElement("path", {"d": "M22 2l-7 20-4-9-9-4 20-7z"})), "\n          " + v.sendLabel + "\n        "), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.isHistory ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px")} , "\n    ", React.createElement("div", {} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , "Today's bills"), "\n      ", React.createElement("p", {"style": style("margin: 6px 0 0; font-size: 17px; color: #475569; max-width: 760px; line-height: 1.45")} , "Every closed table, paid once. If a bill went to the wrong account, the owner moves it later from the admin side. That never creates a second payment."), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n      ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; padding: 20px; border: 1px solid #E2E8F0")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , "Bills closed"), "\n        ", React.createElement("div", {"style": style("font-size: 36px; font-weight: 800; margin-top: 6px")} , v.hCount), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #EAF1FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #1E40AF")} , "Cash · Account A"), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashA), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #F3E8FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #6B21A8")} , "Cash · Account B"), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashB), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #DCFCE7; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #166534")} , "Card · Account A"), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCardA), "\n      "), "\n    "), "\n    ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; overflow-x: auto")} , "\n      ", React.createElement("div", {"style": style("min-width: 820px")} , "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E2E8F0")} , "\n          ", React.createElement("span", {} , "Bill"), React.createElement("span", {} , "Table"), React.createElement("span", {} , "Closed"), React.createElement("span", {} , "Waiter"), React.createElement("span", {} , "Items"), React.createElement("span", {} , "Payment"), React.createElement("span", {} , "Account"), React.createElement("span", {"style": style("text-align: right")} , "Total"), "\n        "), "\n        ", (v.hist || []).map((h, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; align-items: center; font-size: 17px; font-weight: 700; border-bottom: 1px solid #F1F5F9")} , "\n            ", React.createElement("span", {"style": style("color: #475569")} , h.no), "\n            ", React.createElement("span", {"style": style("font-weight: 800")} , h.table), "\n            ", React.createElement("span", {} , h.time), "\n            ", React.createElement("span", {} , h.waiter), "\n            ", React.createElement("span", {} , h.items), "\n            ", React.createElement("span", {} , h.method), "\n            ", React.createElement("span", {} , React.createElement("span", {"style": style(h.accStyle)} , h.account)), "\n            ", React.createElement("span", {"style": style("text-align: right; font-weight: 800")} , h.total), "\n          "), "\n        "))), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n") : null), "\n\n", "\n", (v.hasModal ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"style": style("position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; z-index: 50")} , "\n  ", React.createElement("div", {"role": "dialog", "aria-modal": "true", "aria-label": v.modalTitle, "style": style(v.modalCardStyle)} , "\n\n    ", React.createElement("div", {"style": style("display: flex; align-items: flex-start; gap: 12px")} , "\n      ", React.createElement("div", {"style": style("flex: 1; min-width: 0")} , "\n        ", React.createElement("div", {"style": style("font-size: 28px; font-weight: 800; line-height: 1.15")} , v.modalTitle), "\n        ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 600; color: #475569; margin-top: 4px; line-height: 1.4")} , v.modalSub), "\n      "), "\n      ", React.createElement("button", {"onClick": v.closeModal, "aria-label": "Close", "style": style("width: 52px; height: 52px; flex: none; border-radius: 14px; border: none; background: #F1F5F9; color: #0F172A; display: flex; align-items: center; justify-content: center")} , React.createElement("svg", {"width": "24", "height": "24", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.6", "strokeLinecap": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M18 6L6 18M6 6l12 12"}))), "\n    "), "\n\n    ", "\n    ", (v.isMods ? React.createElement(React.Fragment, null, "\n      ", (v.modGroups || []).map((g, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: flex; flex-direction: column; gap: 10px")} , "\n          ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n            ", React.createElement("span", {"style": style("font-size: 19px; font-weight: 800")} , g.label), "\n            ", React.createElement("span", {"style": style(g.reqStyle)} , g.reqLabel), "\n          "), "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px")} , "\n            ", (g.options || []).map((o, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": o.pick, "disabled": o.disabled, "aria-pressed": o.pressed, "style": style(o.style)} , "\n                ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800")} , o.label), "\n                ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , o.price), "\n              "), "\n            "))), "\n          "), "\n        "), "\n      "))), "\n      ", React.createElement("button", {"onClick": v.modAdd, "disabled": v.modAddDisabled, "style": style(v.modAddStyle)} , v.modAddLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isNote ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px")} , "\n        ", (v.noteChips || []).map((nc, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": nc.toggle, "disabled": v.noteSaving, "aria-pressed": nc.pressed, "style": style(nc.style)} , nc.label), "\n        "))), "\n      "), "\n      ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 800")} , "Or type the note\n        ", React.createElement("input", {"type": "text", "value": v.noteText, "onChange": v.onNoteText, "disabled": v.noteSaving, "placeholder": "e.g. medium rare, no onions", "style": style("height: 60px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 18px; font-size: 19px; font-weight: 600; color: #0F172A")}), "\n      "), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 64px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 19px; font-weight: 800")} , "Back"), "\n        ", React.createElement("button", {"onClick": v.saveNote, "disabled": v.noteSaving, "style": style("flex: 2; height: 64px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 20px; font-weight: 800")} , "Save note"), "\n      "), "\n    ") : null), "\n\n    ", "\n    ", (v.isCancel ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("padding: 16px; border-radius: 16px; background: #F8FAFC; border: 1px solid #E2E8F0; display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n        ", React.createElement("div", {"style": style("flex: 1; min-width: 200px")} , "\n          ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800")} , v.cxName), "\n          ", (v.cxHasMods ? React.createElement(React.Fragment, null, React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; color: #475569")} , v.cxMods)) : null), "\n          ", React.createElement("div", {"style": style("font-size: 14px; font-weight: 700; color: #475569; margin-top: 4px")} , v.cxMeta), "\n        "), "\n        ", (v.cxMulti ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 8px")} , "\n            ", React.createElement("span", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , "How many?"), "\n            ", React.createElement("button", {"onClick": v.cxDec, "aria-label": "Cancel fewer", "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; font-size: 24px; font-weight: 800; color: #0F172A")} , "−"), "\n            ", React.createElement("span", {"style": style("font-size: 22px; font-weight: 800; min-width: 64px; text-align: center")} , v.cxQty + " " + v.cxMax), "\n            ", React.createElement("button", {"onClick": v.cxInc, "aria-label": "Cancel more", "style": style("width: 48px; height: 48px; border-radius: 12px; border: 2px solid #CBD5E1; background: #FFFFFF; font-size: 24px; font-weight: 800; color: #0F172A")} , "+"), "\n          "), "\n        ") : null), "\n      "), "\n      ", React.createElement("div", {"style": style("font-size: 19px; font-weight: 800")} , "Why? ", React.createElement("span", {"style": style("font-size: 15px; color: #B91C1C")} , "Required")), "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px")} , "\n        ", (v.cxReasons || []).map((rs, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": rs.pick, "aria-pressed": rs.pressed, "style": style(rs.style)} , rs.label), "\n        "))), "\n      "), "\n      ", (v.cxIsOther ? React.createElement(React.Fragment, null, "\n        ", React.createElement("label", {"style": style("display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 800")} , "Write the reason\n          ", React.createElement("input", {"type": "text", "value": v.cxOther, "onChange": v.onCxOther, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; padding: 0 16px; font-size: 18px; font-weight: 600; color: #0F172A")}), "\n        "), "\n      ") : null), "\n      ", React.createElement("div", {"style": style("padding: 14px 16px; border-radius: 14px; background: #FFF7ED; color: #7C2D12; font-size: 16px; font-weight: 700; line-height: 1.45")} , v.cxInfo), "\n      ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n        ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 64px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 19px; font-weight: 800")} , "Keep item"), "\n        ", React.createElement("button", {"onClick": v.cxConfirm, "disabled": v.cxDisabled, "style": style(v.cxStyle)} , "Cancel item"), "\n      "), "\n    ") : null), "\n\n    ", "\n    ", (v.isMoveTable ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px")} , "\n        ", (v.mtTables || []).map((mt, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("button", {"onClick": mt.pick, "disabled": mt.disabled, "aria-label": mt.aria, "style": style(mt.style)} , "\n            ", React.createElement("span", {"style": style("font-size: 30px; font-weight: 800; line-height: 1")} , mt.num), "\n            ", React.createElement("span", {"style": style("font-size: 13px; font-weight: 800")} , mt.sub), "\n          "), "\n        "))), "\n      "), "\n      ", React.createElement("button", {"onClick": v.mtConfirm, "disabled": v.mtDisabled, "style": style(v.mtStyle)} , v.mtLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isMoveItems ? React.createElement(React.Fragment, null, "\n      ", React.createElement("div", {"style": style("display: flex; gap: 20px; flex-wrap: wrap")} , "\n        ", React.createElement("div", {"style": style("flex: 1 1 300px; display: flex; flex-direction: column; gap: 8px")} , "\n          ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800")} , "1. Tick the items to move"), "\n          ", (v.miItems || []).map((mi, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("button", {"onClick": mi.toggle, "aria-pressed": mi.pressed, "style": style(mi.style)} , "\n              ", React.createElement("span", {"style": style(mi.boxStyle)} , (mi.checked ? React.createElement(React.Fragment, null, React.createElement("svg", {"width": "18", "height": "18", "viewbox": "0 0 24 24", "fill": "none", "stroke": "#FFFFFF", "strokeWidth": "3.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M20 6L9 17l-5-5"}))) : null)), "\n              ", React.createElement("span", {"style": style("flex: 1; text-align: left")} , "\n                ", React.createElement("span", {"style": style("display: block; font-size: 17px; font-weight: 800")} , mi.label), "\n                ", React.createElement("span", {"style": style("display: block; font-size: 13px; font-weight: 700; color: #475569")} , mi.sub), "\n              "), "\n            "), "\n          "))), "\n        "), "\n        ", React.createElement("div", {"style": style("flex: 1 1 300px; display: flex; flex-direction: column; gap: 8px")} , "\n          ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800")} , "2. Pick the table"), "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px")} , "\n            ", (v.miTables || []).map((mt, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": mt.pick, "aria-label": mt.aria, "style": style(mt.style)} , "\n                ", React.createElement("span", {"style": style("font-size: 26px; font-weight: 800; line-height: 1")} , mt.num), "\n                ", React.createElement("span", {"style": style("font-size: 12px; font-weight: 800")} , mt.sub), "\n              "), "\n            "))), "\n          "), "\n        "), "\n      "), "\n      ", React.createElement("button", {"onClick": v.miConfirm, "disabled": v.miDisabled, "style": style(v.miStyle)} , v.miLabel), "\n    ") : null), "\n\n    ", "\n    ", (v.isBill ? React.createElement(React.Fragment, null, "\n      ", (v.bConfirm ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden")} , "\n          ", (v.billLines || []).map((bl, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n            ", React.createElement("div", {"style": style("display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #F1F5F9; align-items: baseline")} , "\n              ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800; width: 40px")} , bl.qty), "\n              ", React.createElement("span", {"style": style("flex: 1")} , "\n                ", React.createElement("span", {"style": style("display: block; font-size: 18px; font-weight: 700")} , bl.name), "\n                ", (bl.hasMods ? React.createElement(React.Fragment, null, React.createElement("span", {"style": style("display: block; font-size: 14px; font-weight: 700; color: #475569")} , bl.mods)) : null), "\n              "), "\n              ", React.createElement("span", {"style": style("font-size: 18px; font-weight: 800")} , bl.amount), "\n            "), "\n          "))), "\n          ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 16px; background: #F8FAFC")} , "\n            ", React.createElement("span", {"style": style("font-size: 20px; font-weight: 800")} , "Total"), "\n            ", React.createElement("span", {"style": style("font-size: 30px; font-weight: 800")} , v.billTotal), "\n          "), "\n        "), "\n        ", (v.billBlocked ? React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"role": "alert", "style": style("padding: 14px 16px; border-radius: 14px; background: #FEF2F2; color: #991B1B; font-size: 17px; font-weight: 800; line-height: 1.4")} , v.billBlockedText), "\n        ") : null), "\n        ", React.createElement("div", {"style": style("display: flex; gap: 10px")} , "\n          ", React.createElement("button", {"onClick": v.closeModal, "style": style("flex: 1; height: 72px; border-radius: 16px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 20px; font-weight: 800")} , "No, go back"), "\n          ", React.createElement("button", {"onClick": v.bYes, "disabled": v.billBlocked, "style": style(v.bYesStyle)} , "Yes, continue"), "\n        "), "\n      ") : null), "\n\n      ", (v.bMethod ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n          ", React.createElement("button", {"onClick": v.bCash, "style": style("min-height: 170px; border-radius: 22px; border: none; background: #16A34A; color: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(22, 163, 74, 0.3)")} , "\n            ", React.createElement("svg", {"width": "48", "height": "48", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "2", "y": "6", "width": "20", "height": "12", "rx": "2"}), React.createElement("circle", {"cx": "12", "cy": "12", "r": "3"}), React.createElement("path", {"d": "M6 12h.01M18 12h.01"})), "\n            ", React.createElement("span", {"style": style("font-size: 32px; font-weight: 800")} , "Cash"), "\n          "), "\n          ", React.createElement("button", {"onClick": v.bCard, "style": style("min-height: 170px; border-radius: 22px; border: none; background: #2563EB; color: #FFFFFF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , "\n            ", React.createElement("svg", {"width": "48", "height": "48", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("rect", {"x": "2", "y": "5", "width": "20", "height": "14", "rx": "2"}), React.createElement("path", {"d": "M2 10h20"}), React.createElement("path", {"d": "M6 15h4"})), "\n            ", React.createElement("span", {"style": style("font-size: 32px; font-weight: 800")} , "Card"), "\n          "), "\n        "), "\n        ", React.createElement("button", {"onClick": v.bBack, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 18px; font-weight: 800")} , "Back"), "\n      ") : null), "\n\n      ", (v.bAccount ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n          ", React.createElement("button", {"onClick": v.bAccA, "style": style("min-height: 170px; border-radius: 22px; border: 3px solid #2563EB; background: #EAF1FF; color: #1E3A8A; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px")} , "\n            ", React.createElement("span", {"style": style("font-size: 34px; font-weight: 800")} , "Account A"), "\n            ", React.createElement("span", {"style": style("font-size: 17px; font-weight: 700")} , "Prints on Printer A"), "\n          "), "\n          ", React.createElement("button", {"onClick": v.bAccB, "style": style("min-height: 170px; border-radius: 22px; border: 3px solid #7E22CE; background: #F3E8FF; color: #581C87; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px")} , "\n            ", React.createElement("span", {"style": style("font-size: 34px; font-weight: 800")} , "Account B"), "\n            ", React.createElement("span", {"style": style("font-size: 17px; font-weight: 700")} , "Prints on Printer B"), "\n          "), "\n        "), "\n        ", React.createElement("button", {"onClick": v.bBack, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 18px; font-weight: 800")} , "Back"), "\n      ") : null), "\n\n      ", (v.bReceipt ? React.createElement(React.Fragment, null, "\n        ", React.createElement("div", {"style": style("display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start")} , "\n          ", React.createElement("div", {"style": style("flex: 1 1 280px; background: #FFFFFF; border: 2px dashed #CBD5E1; border-radius: 12px; padding: 18px; font-family: 'Courier New', ui-monospace, monospace; color: #0F172A; display: flex; flex-direction: column; gap: 6px")} , "\n            ", React.createElement("div", {"style": style("text-align: center; font-size: 22px; font-weight: 800; letter-spacing: 0.2em")} , "ARRA"), "\n            ", React.createElement("div", {"style": style("text-align: center; font-size: 13px")} , v.billNo + " · " + v.billTable), "\n            ", React.createElement("div", {"style": style("text-align: center; font-size: 13px")} , v.billDate + " · " + v.billWaiter), "\n            ", React.createElement("div", {"style": style("border-top: 1px dashed #94A3B8; margin: 6px 0")}), "\n            ", (v.billLines || []).map((bl, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("display: flex; gap: 8px; font-size: 14px")} , "\n                ", React.createElement("span", {"style": style("width: 30px")} , bl.qty), React.createElement("span", {"style": style("flex: 1")} , bl.name), React.createElement("span", {} , bl.amount), "\n              "), "\n            "))), "\n            ", React.createElement("div", {"style": style("border-top: 1px dashed #94A3B8; margin: 6px 0")}), "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; font-size: 18px; font-weight: 800")} , React.createElement("span", {} , "TOTAL"), React.createElement("span", {} , v.billTotal)), "\n            ", React.createElement("div", {"style": style("font-size: 13px; margin-top: 4px")} , v.billMethodLine), "\n          "), "\n          ", React.createElement("div", {"style": style("flex: 1 1 260px; display: flex; flex-direction: column; gap: 10px")} , "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800")} , React.createElement("span", {"style": style("color: #475569")} , "Payment"), React.createElement("span", {} , v.billMethod)), "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800")} , React.createElement("span", {"style": style("color: #475569")} , "Account"), React.createElement("span", {"style": style(v.billAccStyle)} , v.billAccount)), "\n            ", React.createElement("div", {"style": style("display: flex; justify-content: space-between; padding: 14px 16px; border-radius: 14px; background: #F8FAFC; font-size: 17px; font-weight: 800")} , React.createElement("span", {"style": style("color: #475569")} , "Printer"), React.createElement("span", {} , v.billPrinter)), "\n            ", (v.isCard ? React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-radius: 14px; background: #EAF1FF; color: #1E3A8A; font-size: 15px; font-weight: 800; line-height: 1.35")} , "\n                ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.5", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true", "style": style("flex: none")} , React.createElement("rect", {"x": "5", "y": "11", "width": "14", "height": "10", "rx": "2"}), React.createElement("path", {"d": "M8 11V7a4 4 0 0 1 8 0v4"})), "\n                Card is always Account A and Printer A. This can't be changed.\n              "), "\n            ") : null), "\n\n            ", (v.bReview ? React.createElement(React.Fragment, null, "\n              ", React.createElement("button", {"onClick": v.bPrint, "style": style("height: 76px; border-radius: 18px; border: none; background: #2563EB; color: #FFFFFF; font-size: 24px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 12px; box-shadow: 0 10px 24px rgba(37, 99, 235, 0.3)")} , "\n                ", React.createElement("svg", {"width": "26", "height": "26", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 9V3h12v6"}), React.createElement("rect", {"x": "6", "y": "14", "width": "12", "height": "7"}), React.createElement("path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"})), "\n                Print bill\n              "), "\n              ", React.createElement("button", {"onClick": v.bBack, "style": style("height: 56px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 18px; font-weight: 800")} , "Back"), "\n            ") : null), "\n\n            ", (v.bFailed ? React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"role": "alert", "style": style("padding: 14px 16px; border-radius: 14px; background: #DC2626; color: #FFFFFF; font-size: 17px; font-weight: 800; line-height: 1.4")} , v.failText), "\n              ", React.createElement("button", {"onClick": v.bRetry, "style": style("height: 64px; border-radius: 16px; border: none; background: #2563EB; color: #FFFFFF; font-size: 20px; font-weight: 800")} , "Retry printing"), "\n              ", React.createElement("button", {"onClick": v.bBackup, "style": style("height: 56px; border-radius: 14px; border: 2px solid #2563EB; background: #FFFFFF; color: #1D4ED8; font-size: 18px; font-weight: 800")} , "Print on backup printer"), "\n            ") : null), "\n\n            ", (v.bPrinted ? React.createElement(React.Fragment, null, "\n              ", React.createElement("div", {"style": style("padding: 14px 16px; border-radius: 14px; background: #DCFCE7; color: #14532D; font-size: 17px; font-weight: 800; line-height: 1.4; display: flex; gap: 10px; align-items: flex-start")} , "\n                ", React.createElement("svg", {"width": "22", "height": "22", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "3", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true", "style": style("flex: none; margin-top: 1px")} , React.createElement("path", {"d": "M20 6L9 17l-5-5"})), "\n                ", React.createElement("span", {} , v.printedText), "\n              "), "\n              ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 700; color: #475569; line-height: 1.4")} , "Printing is not the payment. When the customer has paid, press the green button."), "\n              ", React.createElement("button", {"onClick": v.bPaid, "style": style("height: 80px; border-radius: 18px; border: none; background: #16A34A; color: #FFFFFF; font-size: 24px; font-weight: 800; box-shadow: 0 10px 24px rgba(22, 163, 74, 0.32)")} , "Paid · close table"), "\n              ", React.createElement("button", {"onClick": v.bReprint, "style": style("height: 52px; border-radius: 14px; border: 2px solid #CBD5E1; background: #FFFFFF; color: #0F172A; font-size: 17px; font-weight: 800")} , "Reprint bill"), "\n            ") : null), "\n          "), "\n        "), "\n      ") : null), "\n    ") : null), "\n  "), "\n"), "\n") : null), "\n\n", "\n", (v.hasToast ? React.createElement(React.Fragment, null, "\n  ", React.createElement("div", {"role": "status", "style": style(v.toastStyle)} , v.toastText), "\n") : null), "\n\n"), "\n");
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(WaiterDemo));
