import { configText, configError } from './config-i18n.js';
import { accessNotice } from './shared.js';

export class TableConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = { areas: [], tables: [], access: null, error: '', notice: '', editor: null, original: null, fieldError: '', query: '', selectedArea: null, selectedTable: null, uncertainArea: false, busy: false };
  }
  t(text) { return configText(this.props.language, text); }
  componentDidMount() { this.load(); }
  async load(keepEditor = false) {
    try {
      const r = await window.arra.tableConfig({ action: 'list' });
      if (r.ok) { this.setState({ ...r.data, access: true }); return true; }
      this.setState({ error: configError(this.props.language, r.error, 'Areas and tables unavailable.'), ...(keepEditor ? {} : { access: false }) });
    } catch (_) { this.setState({ error: this.t('Could not load areas and tables.'), ...(keepEditor ? {} : { access: false }) }); }
    return false;
  }
  leaveEditor() {
    return !this.state.editor || JSON.stringify(this.state.editor) === this.state.original || window.confirm(this.t('Discard unsaved changes?'));
  }
  startEditor(editor, areaId, tableId) {
    if (!this.leaveEditor()) return;
    this.setState({ editor, original: JSON.stringify(editor), selectedArea: areaId, selectedTable: tableId, error: '', fieldError: '', notice: '', uncertainArea: false }, () => {
      const input = document.querySelector('#floor-editor input:not(:disabled)');
      if (input) input.focus();
    });
  }
  editArea(area) {
    this.startEditor({ kind: 'area', id: area ? area.id : null, name: area ? area.name : '', active: area ? !!area.active : true }, area ? area.id : null, null);
  }
  editTable(table, areaId = '') {
    this.startEditor({ kind: 'table', id: table ? String(table.id) : '', create: !table, areaId: table ? String(table.areaId) : String(areaId), capacity: table ? String(table.capacity) : '4', active: table ? !!table.active : true }, table ? table.areaId : areaId, table ? table.id : null);
  }
  closeEditor() {
    if (this.leaveEditor()) this.setState({ editor: null, error: '', fieldError: '' }, () => this.showSelection());
  }
  showSelection() {
    const item = document.querySelector('.floor-tables li.floor-selected') || document.querySelector('.floor-area.floor-selected');
    if (item) item.scrollIntoView({ block: 'nearest' });
    const action = item?.querySelector?.('button.floor-edit-table, button.floor-edit-area') || document.querySelector('#floor-add-area');
    if (action) action.focus({ preventScroll: true });
  }
  async refreshUncertainArea() {
    if (this.state.busy) return;
    this.setState({ busy: true });
    const loaded = await this.load(true);
    this.setState({ busy: false, ...(loaded ? { uncertainArea: false, query: '', error: this.t('Check the refreshed list for the area before saving again.') } : {}) }, () => {
      if (loaded) document.querySelector('#floor-areas-heading')?.scrollIntoView({ block: 'start' });
    });
  }
  async save() {
    if (this.state.busy || this.state.uncertainArea) return;
    const e = this.state.editor;
    if (!e) return;
    let request;
    if (e.kind === 'area') {
      const name = e.name.trim();
      if (!name || name.length > 100) { this.setState({ error: this.t('Enter an area name of 1 to 100 characters.'), fieldError: 'name' }); return; }
      request = { action: 'area', id: e.id, name, active: e.active };
    } else {
      const id = Number(e.id), areaId = Number(e.areaId), capacity = Number(e.capacity);
      if (!Number.isSafeInteger(id) || id < 1) { this.setState({ error: this.t('Enter a positive whole table number.'), fieldError: 'id' }); return; }
      if (e.create && this.state.tables.some(table => table.id === id)) { this.setState({ error: this.t('Table number already exists. Choose a different number.'), fieldError: 'id' }); return; }
      if (!Number.isSafeInteger(areaId) || areaId < 1) { this.setState({ error: this.t('Choose an area for the table.'), fieldError: 'areaId' }); return; }
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) { this.setState({ error: this.t('Capacity must be a whole number from 1 to 1000.'), fieldError: 'capacity' }); return; }
      request = { action: 'table', id, areaId, capacity, active: e.active, create: e.create };
    }
    this.setState({ busy: true, error: '', notice: '' });
    try {
      const r = await window.arra.tableConfig(request);
      if (!r.ok) { this.setState({ error: r.uncertain ? this.t('Could not save configuration. Check the list before trying again.') : configError(this.props.language, r.error, 'Could not save configuration.'), uncertainArea: !!r.uncertain && e.kind === 'area' && !e.id, fieldError: r.error === 'Table number already exists. Choose a different number.' ? 'id' : '', busy: false }); return; }
      const loaded = await this.load(true);
      if (!loaded && e.kind === 'area' && !e.id) { this.setState({ busy: false, uncertainArea: true }); return; }
      this.setState({ busy: false, ...(loaded ? { editor: null, selectedArea: e.kind === 'table' ? Number(e.areaId) : (e.id || r.id), selectedTable: e.kind === 'table' ? Number(e.id) : null, notice: e.kind === 'area' ? this.t('Area saved.') : this.t('Table saved.') } : {}) }, () => { if (loaded) this.showSelection(); });
    } catch (_) { this.setState({ busy: false, uncertainArea: e.kind === 'area' && !e.id, error: this.t('Could not save configuration. Check the list before trying again.') }); }
  }
  render() {
    const h = React.createElement, s = this.state;
    if (s.access !== true) return accessNotice({ title: this.t('Areas and tables'), loading: s.access === null && this.t('Loading areas and tables…'), error: s.error, guidance: this.t(' Check your access or sign in and select your own name.'), onBack: this.props.onBack, language: this.props.language });
    const e = s.editor;
    const update = patch => this.setState({ editor: { ...this.state.editor, ...patch }, error: '', fieldError: '' });
    const field = (label, value, change, props = {}, key = '') => h('label', { className: 'floor-field' }, h('span', null, label), h('input', { ...props, 'aria-invalid': s.fieldError === key || undefined, 'aria-describedby': s.fieldError === key ? 'floor-error' : undefined, disabled: s.busy || !!props.disabled, value, onChange: event => change(event.target.value) }));
    const toggle = () => h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', disabled: s.busy, checked: e.active, onChange: event => update({ active: event.target.checked }) }), this.t(' Active'));
    const status = active => h('span', { className: active ? 'floor-badge' : 'floor-badge floor-badge-muted' }, active ? this.t('Active') : this.t('Inactive'));
    const visibleAreas = s.areas.filter(a => !s.query.trim() || a.name.toLocaleLowerCase().includes(s.query.trim().toLocaleLowerCase()) || s.tables.some(t => t.areaId === a.id && String(t.id).includes(s.query.trim())) || a.id === s.selectedArea);
    return h('main', { className: 'floor-page' },
      h('button', { disabled: s.busy, onClick: () => { if (this.leaveEditor()) this.props.onBack(); } }, this.t('← Back to administration')),
      h('header', { className: 'floor-hero' },
        h('div', null, h('p', { className: 'floor-kicker' }, this.t('ADMINISTRATION / FLOOR')),
          h('h1', null, this.t('Areas and tables')),
          h('p', null, this.t('Organize the dining floor and set capacity for each table.'))),
        h('button', { id: 'floor-add-area', className: 'floor-primary', disabled: s.busy, onClick: () => this.editArea(null) }, this.t('+ Add area'))),
      h('div', { className: 'floor-overview', 'aria-label': this.t('Floor overview') },
        h('div', null, h('span', null, this.t('Areas')), h('strong', null, s.areas.length)),
        h('div', null, h('span', null, this.t('Tables')), h('strong', null, s.tables.length)),
        h('div', null, h('span', null, this.t('Open orders')), h('strong', null, s.tables.filter(table => table.hasOrder).length))),
      h('details', { className: 'floor-note' }, h('summary', null, this.t('Deactivation and open orders')), h('p', null, this.t('An area or table with an open order cannot be deactivated. Inactive areas and tables are hidden from the waiter grid; their history is kept.')), h('p', null, this.t('Changes here affect the whole restaurant and are recorded under your account.'))),
      s.notice && h('p', { role: 'status', className: 'floor-success' }, s.notice),
      !e && s.error && h('p', { role: 'alert', id: 'floor-error' }, s.error),
      e && h('section', { id: 'floor-editor', className: 'floor-editor', 'aria-label': e.kind === 'area' ? this.t('Area details') : this.t('Table details') },
        h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, e.kind === 'area' ? this.t('AREA DETAILS') : this.t('TABLE DETAILS')), h('h2', null, e.kind === 'area' ? (e.id ? this.t('Edit area') : this.t('New area')) : (e.create ? this.t('New table') : this.t('Edit table ') + e.id))),
          h('button', { disabled: s.busy, onClick: () => this.closeEditor() }, this.t('Cancel'))),
        h('form', { noValidate: true, onSubmit: event => { event.preventDefault(); this.save(); } },
          s.error && h('p', { role: 'alert', id: 'floor-error' }, s.error),
          s.uncertainArea && h('button', { type: 'button', disabled: s.busy, onClick: () => this.refreshUncertainArea() }, this.t('Refresh floor before retrying')),
          e.kind === 'area' ? field(this.t('Area name'), e.name, value => update({ name: value }), { maxLength: 100, autoFocus: true }, 'name') : h('div', { className: 'floor-fields' },
            field(this.t('Table number'), e.id, value => update({ id: value }), { type: 'number', min: 1, step: 1, disabled: !e.create }, 'id'),
            h('label', { className: 'floor-field' }, h('span', null, this.t('Area')), h('select', { 'aria-invalid': s.fieldError === 'areaId' || undefined, 'aria-describedby': s.fieldError === 'areaId' ? 'floor-error' : undefined, disabled: s.busy, value: e.areaId, onChange: event => update({ areaId: event.target.value }) }, h('option', { value: '' }, this.t('Choose an area')), ...s.areas.filter(a => a.active || a.id === Number(e.areaId)).map(a => h('option', { key: a.id, value: a.id }, a.name + (a.active ? '' : this.t(' (inactive)')))))),
            field(this.t('Capacity'), e.capacity, value => update({ capacity: value }), { type: 'number', min: 1, max: 1000, step: 1 }, 'capacity')),
          e.kind === 'table' && h('p', { className: 'floor-help' }, this.t('Table numbers are permanent, so existing orders keep their reference.')),
          toggle(), !e.active && h('p', { className: 'floor-help' }, this.t('An open order must be completed before deactivation.')), !e.active && h('p', { className: 'floor-help' }, e.kind === 'area' ? this.t('This area and its tables will be hidden from the waiter grid.') : this.t('This table will be hidden from the waiter grid.')),
          h('div', { className: 'floor-actions' }, h('button', { type: 'submit', className: 'floor-primary', disabled: s.busy || s.uncertainArea }, s.busy ? this.t('Saving…') : this.t('Save ') + this.t(e.kind))))),
      h('section', { className: 'floor-list', 'aria-labelledby': 'floor-areas-heading' },
        h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, this.t('YOUR FLOOR')), h('h2', { id: 'floor-areas-heading' }, this.t('Areas and their tables')), h('p', { className: 'floor-list-intro' }, this.t('Select an area or table to make changes.'))), h('button', { disabled: s.busy || !s.areas.some(a => a.active), onClick: () => this.editTable(null) }, this.t('+ Add table'))),
        s.areas.length > 0 && h('label', { className: 'floor-field' }, h('span', null, this.t('Find an area or table')), h('input', { type: 'search', disabled: s.busy, value: s.query, onChange: event => this.setState({ query: event.target.value }) })),
        !s.areas.length && h('p', { className: 'floor-empty' }, this.t('No areas yet. Add an area to start arranging tables.')),
        s.areas.length > 0 && !visibleAreas.length && h('p', { className: 'floor-empty' }, this.t('No matching areas or tables.')),
        visibleAreas.map(a => {
          const tables = s.tables.filter(t => t.areaId === a.id);
          const query = s.query.trim().toLocaleLowerCase();
          const shownTables = !query || a.name.toLocaleLowerCase().includes(query) ? tables : tables.filter(t => String(t.id).includes(query) || t.id === s.selectedTable);
          return h('article', { key: a.id, className: 'floor-area' + (s.selectedArea === a.id ? ' floor-selected' : '') },
            h('div', { className: 'floor-area-head' }, h('div', { className: 'floor-area-title' }, h('span', { className: 'floor-area-icon', 'aria-hidden': 'true' }, '▦'), h('div', null, h('h3', null, a.name), h('p', null, tables.length + (tables.length === 1 ? this.t(' table') : this.t(' tables'))))), status(a.active), h('div', { className: 'floor-actions' }, h('button', { disabled: s.busy || !a.active, onClick: () => this.editTable(null, a.id), 'aria-label': this.t('Add table to ') + a.name }, this.t('+ Add table')), h('button', { className: 'floor-edit-area', disabled: s.busy, onClick: () => this.editArea(a), 'aria-label': this.t('Edit area ') + a.name }, this.t('Edit area')))),
            s.notice && s.selectedArea === a.id && h('p', { className: 'floor-success' }, s.notice),
            shownTables.length ? h('ul', { className: 'floor-tables' }, ...shownTables.map(t => h('li', { key: t.id, className: s.selectedTable === t.id ? 'floor-selected' : '' }, h('div', { className: 'floor-table-main' }, h('strong', null, this.t('Table ') + t.id), h('span', { className: 'floor-table-detail' }, this.t('Capacity ') + t.capacity + (t.hasOrder ? this.t(' · Open order') : ''))), h('div', { className: 'floor-table-footer' }, status(t.active), h('button', { className: 'floor-edit-table', disabled: s.busy, onClick: () => this.editTable(t), 'aria-label': this.t('Edit table ') + t.id }, this.t('Edit')))))) : h('p', { className: 'floor-empty' }, this.t(tables.length ? 'No matching tables in this area.' : 'No tables in this area.')));
        })));
  }
}
