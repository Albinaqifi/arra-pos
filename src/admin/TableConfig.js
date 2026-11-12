import { configText, configError } from './config-i18n.js';
import { accessNotice } from './shared.js';

export class TableConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = { areas: [], tables: [], access: null, error: '', notice: '', editor: null, busy: false };
  }
  t(text) { return configText(this.props.language, text); }
  componentDidMount() { this.load(); }
  async load() {
    try {
      const r = await window.arra.tableConfig({ action: 'list' });
      if (r.ok) { this.setState({ ...r.data, access: true }); return true; }
      this.setState({ error: configError(this.props.language, r.error, 'Areas and tables unavailable.'), access: false });
    } catch (_) { this.setState({ error: this.t('Could not load areas and tables.'), access: false }); }
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
      if (!name || name.length > 100) { this.setState({ error: this.t('Enter an area name of 1 to 100 characters.') }); return; }
      request = { action: 'area', id: e.id, name, active: e.active };
    } else {
      const id = Number(e.id), areaId = Number(e.areaId), capacity = Number(e.capacity);
      if (!Number.isSafeInteger(id) || id < 1) { this.setState({ error: this.t('Enter a positive whole table number.') }); return; }
      if (e.create && this.state.tables.some(table => table.id === id)) { this.setState({ error: this.t('Table number already exists. Choose a different number.') }); return; }
      if (!Number.isSafeInteger(areaId) || areaId < 1) { this.setState({ error: this.t('Choose an area for the table.') }); return; }
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) { this.setState({ error: this.t('Capacity must be a whole number from 1 to 1000.') }); return; }
      request = { action: 'table', id, areaId, capacity, active: e.active, create: e.create };
    }
    this.setState({ busy: true, error: '', notice: '' });
    try {
      const r = await window.arra.tableConfig(request);
      if (!r.ok) { this.setState({ error: configError(this.props.language, r.error, 'Could not save configuration.'), busy: false }); return; }
      const loaded = await this.load();
      this.setState({ busy: false, ...(loaded ? { editor: null, notice: e.kind === 'area' ? this.t('Area saved.') : this.t('Table saved.') } : {}) });
    } catch (_) { this.setState({ busy: false, error: this.t('Could not save configuration. Check the list before trying again.') }); }
  }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return accessNotice({ title: this.t('Areas and tables'), loading: s.access === null && this.t('Loading areas and tables…'), error: s.error, guidance: this.t(' Check your access or sign in and select your own name.'), onBack: this.props.onBack, language: this.props.language });
    const e = s.editor;
    const update = patch => this.setState({ editor: { ...this.state.editor, ...patch }, error: '' });
    const field = (label, value, change, props = {}) => h('label', { className: 'floor-field' }, h('span', null, label), h('input', { ...props, disabled: s.busy || !!props.disabled, value, onChange: event => change(event.target.value) }));
    const toggle = () => h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', disabled: s.busy, checked: e.active, onChange: event => update({ active: event.target.checked }) }), this.t(' Active'));
    const status = active => h('span', { className: active ? 'floor-badge' : 'floor-badge floor-badge-muted' }, active ? this.t('Active') : this.t('Inactive'));
    return h('main', { className: 'floor-page' },
      h('button', { onClick: this.props.onBack }, this.t('← Back to administration')),
      h('p', { className: 'admin-eyebrow floor-eyebrow' }, this.t('ADMINISTRATION / FLOOR')),
      h('h1', null, this.t('Areas and tables')),
      h('p', { className: 'admin-intro' }, this.t('Organize the dining floor and set capacity for each table.')),
      h('p', { className: 'admin-access-note' }, this.t('Changes here affect the whole restaurant and are recorded under your account.')),
      h('div', { className: 'floor-note' }, h('strong', null, this.t('Deactivation and open orders')), h('p', null, this.t('An area or table with an open order cannot be deactivated. Inactive areas and tables are hidden from the waiter grid; their history is kept.'))),
      s.notice && h('p', { role: 'status', className: 'floor-success' }, s.notice),
      s.error && h('p', { role: 'alert' }, s.error),
      e && h('section', { className: 'floor-editor', 'aria-label': e.kind === 'area' ? this.t('Area details') : this.t('Table details') },
        h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, e.kind === 'area' ? this.t('AREA DETAILS') : this.t('TABLE DETAILS')), h('h2', null, e.kind === 'area' ? (e.id ? this.t('Edit area') : this.t('New area')) : (e.create ? this.t('New table') : this.t('Edit table ') + e.id))),
          h('button', { disabled: s.busy, onClick: () => this.setState({ editor: null, error: '' }) }, this.t('Cancel'))),
        h('form', { onSubmit: event => { event.preventDefault(); this.save(); } },
          e.kind === 'area' ? field(this.t('Area name'), e.name, value => update({ name: value }), { maxLength: 100, autoFocus: true }) : h('div', { className: 'floor-fields' },
            field(this.t('Table number'), e.id, value => update({ id: value }), { type: 'number', min: 1, step: 1, disabled: !e.create }),
            h('label', { className: 'floor-field' }, h('span', null, this.t('Area')), h('select', { disabled: s.busy, value: e.areaId, onChange: event => update({ areaId: event.target.value }) }, h('option', { value: '' }, this.t('Choose an area')), ...s.areas.filter(a => a.active || a.id === Number(e.areaId)).map(a => h('option', { key: a.id, value: a.id }, a.name + (a.active ? '' : this.t(' (inactive)')))))),
            field(this.t('Capacity'), e.capacity, value => update({ capacity: value }), { type: 'number', min: 1, max: 1000, step: 1 })),
          e.kind === 'table' && h('p', { className: 'floor-help' }, this.t('Table numbers are permanent, so existing orders keep their reference.')),
          toggle(), !e.active && h('p', { className: 'floor-help' }, e.kind === 'area' ? this.t('This area and its tables will be hidden from the waiter grid.') : this.t('This table will be hidden from the waiter grid.')),
          h('div', { className: 'floor-actions' }, h('button', { type: 'submit', className: 'floor-primary', disabled: s.busy }, s.busy ? this.t('Saving…') : this.t('Save ') + this.t(e.kind))))),
      h('section', { className: 'floor-list', 'aria-labelledby': 'floor-areas-heading' },
        h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('YOUR FLOOR')), h('h2', { id: 'floor-areas-heading' }, this.t('Areas and their tables'))), h('div', { className: 'floor-actions' }, h('button', { disabled: s.busy, onClick: () => this.editArea(null) }, this.t('+ Add area')), h('button', { disabled: s.busy || !s.areas.some(a => a.active), onClick: () => this.editTable(null) }, this.t('+ Add table')))),
        !s.areas.length && h('p', { className: 'floor-empty' }, this.t('No areas yet. Add an area to start arranging tables.')),
        s.areas.map(a => {
          const tables = s.tables.filter(t => t.areaId === a.id);
          return h('article', { key: a.id, className: 'floor-area' },
            h('div', { className: 'floor-area-head' }, h('div', null, h('h3', null, a.name), h('p', null, tables.length + (tables.length === 1 ? this.t(' table') : this.t(' tables')))), status(a.active), h('button', { disabled: s.busy, onClick: () => this.editArea(a), 'aria-label': this.t('Edit area ') + a.name }, this.t('Edit area'))),
            tables.length ? h('ul', { className: 'floor-tables' }, ...tables.map(t => h('li', { key: t.id }, h('div', null, h('strong', null, this.t('Table ') + t.id), h('span', { className: 'floor-table-detail' }, this.t('Capacity ') + t.capacity + (t.hasOrder ? this.t(' · Open order') : ''))), status(t.active), h('button', { disabled: s.busy, onClick: () => this.editTable(t), 'aria-label': this.t('Edit table ') + t.id }, this.t('Edit'))))) : h('p', { className: 'floor-empty' }, this.t('No tables in this area.')));
        })));
  }
}
