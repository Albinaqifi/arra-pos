import { accessNotice } from './shared.js';

export class TableConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = { areas: [], tables: [], access: null, error: '', notice: '', editor: null, busy: false };
  }
  componentDidMount() { this.load(); }
  async load() {
    try {
      const r = await window.arra.tableConfig({ action: 'list' });
      if (r.ok) { this.setState({ ...r.data, access: true }); return true; }
      this.setState({ error: r.error || 'Areas and tables unavailable.', access: false });
    } catch (_) { this.setState({ error: 'Could not load areas and tables.', access: false }); }
    return false;
  }
  editArea(area) {
    this.setState({ editor: { kind: 'area', id: area ? area.id : null, name: area ? area.name : '', active: area ? !!area.active : true }, error: '', notice: '' });
  }
  editTable(table) {
    this.setState({ editor: { kind: 'table', id: table ? String(table.id) : '', create: !table, areaId: table ? String(table.areaId) : '', capacity: table ? String(table.capacity) : '4', active: table ? !!table.active : true }, error: '', notice: '' });
  }
  async save() {
    if (this.state.busy) return;
    const e = this.state.editor;
    if (!e) return;
    let request;
    if (e.kind === 'area') {
      const name = e.name.trim();
      if (!name || name.length > 100) { this.setState({ error: 'Enter an area name of 1 to 100 characters.' }); return; }
      request = { action: 'area', id: e.id, name, active: e.active };
    } else {
      const id = Number(e.id), areaId = Number(e.areaId), capacity = Number(e.capacity);
      if (!Number.isSafeInteger(id) || id < 1) { this.setState({ error: 'Enter a positive whole table number.' }); return; }
      if (e.create && this.state.tables.some(table => table.id === id)) { this.setState({ error: 'Table number already exists. Choose a different number.' }); return; }
      if (!Number.isSafeInteger(areaId) || areaId < 1) { this.setState({ error: 'Choose an area for the table.' }); return; }
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) { this.setState({ error: 'Capacity must be a whole number from 1 to 1000.' }); return; }
      request = { action: 'table', id, areaId, capacity, active: e.active, create: e.create };
    }
    this.setState({ busy: true, error: '', notice: '' });
    try {
      const r = await window.arra.tableConfig(request);
      if (!r.ok) { this.setState({ error: r.error || 'Could not save configuration.', busy: false }); return; }
      const loaded = await this.load();
      this.setState({ busy: false, ...(loaded ? { editor: null, notice: e.kind === 'area' ? 'Area saved.' : 'Table saved.' } : {}) });
    } catch (_) { this.setState({ busy: false, error: 'Could not save configuration. Check the list before trying again.' }); }
  }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return accessNotice({ title: 'Areas and tables', loading: s.access === null && 'Loading areas and tables…', error: s.error, guidance: ' Check your access or sign in and select your own name.', onBack: this.props.onBack });
    const e = s.editor;
    const update = patch => this.setState({ editor: { ...this.state.editor, ...patch }, error: '' });
    const field = (label, value, change, props = {}) => h('label', { className: 'floor-field' }, h('span', null, label), h('input', { ...props, disabled: s.busy || !!props.disabled, value, onChange: event => change(event.target.value) }));
    const toggle = () => h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', disabled: s.busy, checked: e.active, onChange: event => update({ active: event.target.checked }) }), ' Active');
    const status = active => h('span', { className: active ? 'floor-badge' : 'floor-badge floor-badge-muted' }, active ? 'Active' : 'Inactive');
    return h('main', { className: 'floor-page' },
      h('button', { onClick: this.props.onBack }, '← Back to administration'),
      h('p', { className: 'admin-eyebrow floor-eyebrow' }, 'ADMINISTRATION / FLOOR'),
      h('h1', null, 'Areas and tables'),
      h('p', { className: 'admin-intro' }, 'Organize the dining floor and set capacity for each table.'),
      h('div', { className: 'floor-note' }, h('strong', null, 'Deactivation and open orders'), h('p', null, 'An area or table with an open order cannot be deactivated. Inactive areas and tables are hidden from the waiter grid; their history is kept.')),
      s.notice && h('p', { role: 'status', className: 'floor-success' }, s.notice),
      s.error && h('p', { role: 'alert' }, s.error),
      e && h('section', { className: 'floor-editor', 'aria-label': e.kind === 'area' ? 'Area details' : 'Table details' },
        h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, e.kind === 'area' ? 'AREA DETAILS' : 'TABLE DETAILS'), h('h2', null, e.kind === 'area' ? (e.id ? 'Edit area' : 'New area') : (e.create ? 'New table' : 'Edit table ' + e.id))),
          h('button', { disabled: s.busy, onClick: () => this.setState({ editor: null, error: '' }) }, 'Cancel')),
        h('form', { onSubmit: event => { event.preventDefault(); this.save(); } },
          e.kind === 'area' ? field('Area name', e.name, value => update({ name: value }), { maxLength: 100, autoFocus: true }) : h('div', { className: 'floor-fields' },
            field('Table number', e.id, value => update({ id: value }), { type: 'number', min: 1, step: 1, disabled: !e.create }),
            h('label', { className: 'floor-field' }, h('span', null, 'Area'), h('select', { disabled: s.busy, value: e.areaId, onChange: event => update({ areaId: event.target.value }) }, h('option', { value: '' }, 'Choose an area'), ...s.areas.filter(a => a.active || a.id === Number(e.areaId)).map(a => h('option', { key: a.id, value: a.id }, a.name + (a.active ? '' : ' (inactive)'))))),
            field('Capacity', e.capacity, value => update({ capacity: value }), { type: 'number', min: 1, max: 1000, step: 1 })),
          e.kind === 'table' && h('p', { className: 'floor-help' }, 'Table numbers are permanent, so existing orders keep their reference.'),
          toggle(), !e.active && h('p', { className: 'floor-help' }, e.kind === 'area' ? 'This area and its tables will be hidden from the waiter grid.' : 'This table will be hidden from the waiter grid.'),
          h('div', { className: 'floor-actions' }, h('button', { type: 'submit', className: 'floor-primary', disabled: s.busy }, s.busy ? 'Saving…' : 'Save ' + e.kind)))),
      h('section', { className: 'floor-list', 'aria-labelledby': 'floor-areas-heading' },
        h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, 'YOUR FLOOR'), h('h2', { id: 'floor-areas-heading' }, 'Areas and their tables')), h('div', { className: 'floor-actions' }, h('button', { disabled: s.busy, onClick: () => this.editArea(null) }, '+ Add area'), h('button', { disabled: s.busy || !s.areas.some(a => a.active), onClick: () => this.editTable(null) }, '+ Add table'))),
        !s.areas.length && h('p', { className: 'floor-empty' }, 'No areas yet. Add an area to start arranging tables.'),
        s.areas.map(a => {
          const tables = s.tables.filter(t => t.areaId === a.id);
          return h('article', { key: a.id, className: 'floor-area' },
            h('div', { className: 'floor-area-head' }, h('div', null, h('h3', null, a.name), h('p', null, tables.length + (tables.length === 1 ? ' table' : ' tables'))), status(a.active), h('button', { disabled: s.busy, onClick: () => this.editArea(a), 'aria-label': 'Edit area ' + a.name }, 'Edit area')),
            tables.length ? h('ul', { className: 'floor-tables' }, ...tables.map(t => h('li', { key: t.id }, h('div', null, h('strong', null, 'Table ' + t.id), h('span', { className: 'floor-table-detail' }, 'Capacity ' + t.capacity + (t.hasOrder ? ' · Open order' : ''))), status(t.active), h('button', { disabled: s.busy, onClick: () => this.editTable(t), 'aria-label': 'Edit table ' + t.id }, 'Edit')))) : h('p', { className: 'floor-empty' }, 'No tables in this area.'));
        })));
  }
}
