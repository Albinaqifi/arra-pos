import { accessNotice } from './shared.js';

export class EmployeeConfig extends React.Component {
  constructor(props) { super(props); this.state = { users: [], grants: [], audit: [], credentialAudit: [], accountAudit: [], permissions: [], selected: null, error: '', access: null }; }
  componentDidMount() { this.load(); }
  async load() {
    const r = await window.arra.employeeConfig({ action: 'list' });
    if (r.ok) this.setState({ ...r.data, error: '', access: true }); else this.setState({ error: r.error || 'Employees unavailable', access: false });
  }
  async save(request) {
    const r = await window.arra.employeeConfig(request);
    if (r.ok) {
      if (this.props.onAccessChanged && !(await this.props.onAccessChanged())) return;
      await this.load();
    } else this.setState({ error: r.error || 'Could not save' });
  }
  render() {
    const h = React.createElement, selected = this.state.users.find(u => u.id === this.state.selected);
    if (this.state.access !== true) return accessNotice({ title: 'Employees and permissions', loading: this.state.access === null && 'Loading employees…', error: this.state.error, guidance: ' Sign in with your own administrator account and select your own name.', onBack: this.props.onBack });
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
