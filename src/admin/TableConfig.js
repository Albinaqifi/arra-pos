import { accessNotice, labeledInput } from './shared.js';

export class TableConfig extends React.Component {
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
    if (s.access !== true) return accessNotice({ title: 'Areas and tables', loading: s.access === null && 'Loading areas and tables…', error: s.error, guidance: ' Check your access or sign in and select your own name.', onBack: this.props.onBack });
    const input = labeledInput;
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
