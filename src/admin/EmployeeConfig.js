import { accessNotice } from './shared.js';

const permissionGroups = [
  ['Tables', [['tables.view', 'View areas and tables'], ['tables.change', 'Change areas and tables']]],
  ['Menu', [['menu.view', 'View the menu setup'], ['menu.change', 'Change the menu setup']]],
  ['Orders', [['orders.view', 'View order history'], ['orders.change', 'Change orders'], ['orders.correct_sent', 'Correct sent items']]],
  ['Employees', [['employees.view', 'View employees and permissions'], ['employees.change', 'Change employees and permissions']]]
];
const validName = name => name === name.trim() && name.length > 0 && name.length <= 128;
const validPassword = password => password.length > 0 && new TextEncoder().encode(password).length <= 1024;
const permissionLabel = permission => permissionGroups.flatMap(group => group[1]).find(item => item[0] === permission)?.[1] || permission;

export class EmployeeConfig extends React.Component {
  constructor(props) { super(props); this.state = { users: [], grants: [], audit: [], credentialAudit: [], accountAudit: [], financialAudit: [], actorId: null, actorScope: null, permissions: [], selected: null, error: '', notice: '', access: null, busy: false, creating: false, revision: 0 }; }
  componentDidMount() { this.load(); }
  async load() {
    try {
      const r = await window.arra.employeeConfig({ action: 'list' });
      if (r.ok) { this.setState(s => ({ ...r.data, access: true, revision: s.revision + 1 })); return true; }
      this.setState({ error: r.error || 'Employees unavailable.', access: false });
    } catch (_) { this.setState({ error: 'Could not load employees.', access: false }); }
    return false;
  }
  async save(request, success) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: '', notice: '' });
    try {
      const r = await window.arra.employeeConfig(request);
      if (!r.ok) {
        if (!r.error || r.error === 'Configuration unavailable') throw new Error('Unconfirmed');
        this.setState({ error: r.error, busy: false }); return;
      }
      if (this.props.onAccessChanged && !(await this.props.onAccessChanged())) return;
      const loaded = await this.load();
      this.setState({ busy: false, creating: false, ...(loaded ? { notice: success, error: '' } : { error: 'The change was saved, but employees could not be refreshed. Reopen this page to check it.' }) });
    } catch (_) {
      const loaded = await this.load();
      this.setState({ busy: false, creating: false, ...(loaded ? { notice: 'The save could not be confirmed and may have succeeded. Check the refreshed information and history before trying again.', error: '' } : { error: 'The save could not be confirmed. Reopen this page and check the information and history before trying again.' }) });
    }
  }
  render() {
    const h = React.createElement, s = this.state, selected = s.users.find(u => u.id === s.selected);
    if (s.access !== true) return accessNotice({ title: 'Employees and permissions', loading: s.access === null && 'Loading employees…', error: s.error, guidance: ' Sign in with your own administrator account and select your own name.', onBack: this.props.onBack });
    const granted = selected ? s.grants.filter(g => g.userId === selected.id).map(g => g.permission) : [];
    const submit = fn => e => { e.preventDefault(); if (!s.busy) fn(e.currentTarget); };
    const field = (label, props) => h('label', { className: 'floor-field' }, h('span', null, label), h('input', { ...props, disabled: s.busy }));
    const badge = active => h('span', { className: active ? 'floor-badge' : 'floor-badge floor-badge-muted' }, active ? 'Active' : 'Inactive');
    const person = id => (s.users.find(u => u.id === id)?.username || 'Unknown') + ' #' + id;
    const history = (title, entries, empty, describe) => h('section', { className: 'floor-list' }, h('h2', null, title), entries.length ? h('ul', null, entries.map((a, i) => h('li', { key: i }, new Date(a.occurredAt).toLocaleString() + ' · ' + person(a.actorId) + ' → ' + person(a.targetId) + ' · ' + describe(a)))) : h('p', { className: 'floor-empty' }, empty));
    return h('main', { className: 'floor-page' },
      h('button', { type: 'button', onClick: this.props.onBack, disabled: s.busy }, '← Back to administration'),
      h('p', { className: 'admin-eyebrow floor-eyebrow' }, 'ADMINISTRATION / EMPLOYEES'), h('h1', null, 'Employees and permissions'),
      h('p', { className: 'admin-intro' }, 'Manage staff accounts and the actions each person can use.'),
      h('div', { className: 'floor-note' }, h('strong', null, 'Managing access'), h('p', null, 'Sign in with your own administrator password and select your own name. You can only manage eligible accounts and permissions you hold. Changes affect the whole restaurant. Only Combined can create usable credentials, reset passwords or PINs, grant operational permissions, or change owner accounts and financial access. Owners A and B can create inactive staff records for Combined to provision.')),
      s.notice && h('p', { role: 'status', className: 'floor-success' }, s.notice), s.error && h('p', { role: 'alert' }, s.error),
      h('section', { className: 'floor-list' }, h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, 'STAFF'), h('h2', null, 'Choose an employee')), s.actorScope !== 'waiter' && h('button', { type: 'button', disabled: s.busy, onClick: () => this.setState({ creating: !s.creating, error: '', notice: '' }) }, s.creating ? 'Cancel' : '+ Create employee')),
        h('label', { className: 'floor-field' }, h('span', null, 'Employee'), h('select', { value: s.selected || '', disabled: s.busy, onChange: e => this.setState({ selected: Number(e.target.value) || null, error: '', notice: '' }) }, h('option', { value: '' }, 'Choose an employee'), s.users.map(u => h('option', { key: u.id, value: u.id }, u.username + (u.scope === 'waiter' ? ' (staff)' : ' (owner)') + (u.active ? '' : ' (inactive)'))))),
        s.creating && h('div', { className: 'floor-editor' }, h('h3', null, 'Create employee'), h('p', { className: 'floor-help' }, s.actorScope === 'combined' ? 'New employees start without operational permissions. Add the permissions they need after creating their account.' : 'This creates an inactive staff record. Combined must set credentials, permissions and activate the account.'),
          h('form', { onSubmit: submit(form => { const request = s.actorScope === 'combined' ? { action: 'create', username: form.elements.username.value, password: form.elements.password.value, pin: form.elements.pin.value } : { action: 'createPending', username: form.elements.username.value }; if (s.actorScope === 'combined') { form.elements.password.value = ''; form.elements.pin.value = ''; } if (!validName(request.username)) { this.setState({ error: 'Enter a name of 1 to 128 characters with no leading or trailing spaces. Re-enter the password and PIN.' }); return; } if (s.actorScope === 'combined' && !validPassword(request.password)) { this.setState({ error: 'Enter a password of 1 to 1024 UTF-8 bytes. Re-enter the PIN if needed.' }); return; } form.reset(); this.save(request, s.actorScope === 'combined' ? 'Employee created. Select the employee to set permissions.' : 'Inactive staff record created. Combined must provision it.'); }) }, h('div', { className: 'floor-fields' }, field('Name', { name: 'username', required: true, maxLength: 128 }), s.actorScope === 'combined' && field('Password', { name: 'password', type: 'password', required: true, autoComplete: 'new-password' }), s.actorScope === 'combined' && field('Optional 4-digit PIN', { name: 'pin', type: 'password', pattern: '[0-9]{4}', maxLength: 4, autoComplete: 'new-password' })), h('div', { className: 'floor-actions' }, h('button', { className: 'floor-primary', disabled: s.busy }, s.busy ? 'Saving…' : 'Create employee'))))),
      selected && selected.pending && h('p', { className: 'floor-note' }, 'Awaiting Combined to set a password. This staff record cannot be activated or selected until credentials are provisioned.'),
      selected && (selected.scope === 'waiter' || (s.actorScope === 'combined' && selected.id !== s.actorId)) && h('div', { key: selected.id },
        h('section', { className: 'floor-list' }, h('div', { className: 'floor-section-head' }, h('div', null, h('p', { className: 'floor-kicker' }, 'ACCOUNT'), h('h2', null, selected.username)), badge(selected.active)),
          h('form', { key: 'account:' + s.revision, onSubmit: submit(form => { const active = form.elements.active.checked; if (!validName(form.elements.username.value)) { this.setState({ error: 'Enter a name of 1 to 128 characters with no leading or trailing spaces.' }); return; } if (selected.active && !active && !window.confirm('Deactivate ' + selected.username + '? Their access will end.')) return; this.save({ action: 'account', id: selected.id, username: form.elements.username.value, active }, 'Account saved.'); }) }, h('div', { className: 'floor-fields' }, field('Name', { name: 'username', defaultValue: selected.username, required: true, maxLength: 128 })), h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', name: 'active', defaultChecked: !!selected.active, disabled: s.busy }), ' Active — inactive employees cannot access the system'), h('button', { className: 'floor-primary', disabled: s.busy }, s.busy ? 'Saving…' : 'Save account'))),
        s.actorScope === 'combined' && h('section', { className: 'floor-list' }, h('p', { className: 'floor-kicker' }, 'SECURITY'), h('h2', null, 'Reset credentials'), h('p', { className: 'floor-help' }, 'Leave a field blank to keep it. Removing the PIN allows selection without one. Resetting credentials ends the employee’s current session.'), h('p', null, selected.hasPin ? 'A PIN is set.' : 'No PIN is set.'),
          h('form', { key: 'credential:' + s.revision, onSubmit: submit(form => { const password = form.elements.password.value || null, pin = form.elements.removePin.checked ? '' : form.elements.pin.value || null; if (password !== null && !validPassword(password)) { form.elements.password.value = ''; form.elements.pin.value = ''; this.setState({ error: 'Enter a password of 1 to 1024 UTF-8 bytes. Re-enter the PIN if needed.' }); return; } if (password === null && pin === null) { this.setState({ error: 'Enter a new password or PIN, or choose Remove PIN.' }); return; } if (form.elements.removePin.checked && form.elements.pin.value) { this.setState({ error: 'Enter a new PIN or select Remove PIN, not both.' }); return; } if (!window.confirm('Reset credentials for ' + selected.username + '? Their current session will end.')) return; form.reset(); this.save({ action: 'credential', id: selected.id, password, pin }, 'Credentials updated.'); }) }, h('div', { className: 'floor-fields' }, field('New password', { type: 'password', name: 'password', autoComplete: 'new-password' }), field('New 4-digit PIN', { type: 'password', name: 'pin', pattern: '[0-9]{4}', maxLength: 4, autoComplete: 'new-password' })), h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', name: 'removePin', disabled: s.busy }), ' Remove PIN'), h('button', { disabled: s.busy }, s.busy ? 'Saving…' : 'Reset credentials'))),
        s.actorScope === 'combined' && h('section', { className: 'floor-list' }, h('p', { className: 'floor-kicker' }, 'ACCESS'), h('h2', null, 'Operational permissions'), h('p', { className: 'floor-help' }, 'Viewing and changing are separate permissions. Changes are checked against your own access.'),
          h('form', { key: 'permissions:' + s.revision, onSubmit: submit(form => this.save({ action: 'permissions', id: selected.id, permissions: s.permissions.filter(p => form.elements[p].checked) }, 'Permissions saved.')) }, permissionGroups.map(([name, permissions]) => h('fieldset', { key: name, disabled: s.busy }, h('legend', null, name), permissions.filter(([p]) => s.permissions.includes(p)).map(([p, label]) => h('label', { key: p, className: 'floor-toggle' }, h('input', { type: 'checkbox', name: p, defaultChecked: granted.includes(p) }), ' ' + label)))), h('button', { className: 'floor-primary', disabled: s.busy }, s.busy ? 'Saving…' : 'Save permissions')))),
      selected && s.actorScope === 'combined' && selected.id !== s.actorId && h('section', { className: 'floor-list' }, h('h2', null, 'Financial access'), h('p', { className: 'floor-help' }, 'Only Combined can change owner scope or the day-close grant. Changing access ends the selected account session. Shared configuration permissions are managed above.'),
        h('form', { key: 'financial:' + s.revision, onSubmit: submit(form => this.save({ action: 'financialAccess', id: selected.id, scope: form.elements.scope.value, close: form.elements.close.checked }, 'Financial access saved.')) }, h('label', { className: 'floor-field' }, h('span', null, 'Financial scope'), h('select', { name: 'scope', defaultValue: selected.scope, disabled: s.busy }, [['waiter','Staff (no financial access)'],['A','Owner A'],['B','Owner B'],['combined','Combined']].map(([value,label]) => h('option', { key:value, value }, label)))), h('label', { className: 'floor-toggle' }, h('input', { type: 'checkbox', name: 'close', defaultChecked: s.grants.some(g => g.userId === selected.id && g.permission === 'business_days.close'), disabled: s.busy }), ' Allow combined account to close the day'), h('button', { className: 'floor-primary', disabled: s.busy }, 'Save financial access'))),
      history('Recent financial access changes', s.financialAudit, 'No financial access changes recorded.', a => a.context.before.scope + ' → ' + a.context.after.scope + ' · day-close grant ' + (a.context.after.close ? 'on' : 'off')),
      history('Recent permission changes', s.audit, 'No permission changes recorded.', a => permissionLabel(a.permission) + (a.granted ? ' granted' : ' revoked')),
      history('Recent credential resets', s.credentialAudit, 'No credential resets recorded.', a => [a.passwordChanged && 'Password', a.pinChanged && 'PIN'].filter(Boolean).join(' and ') + ' changed'),
      history('Recent account changes', s.accountAudit, 'No account changes recorded.', a => a.oldUsername + ' → ' + a.newUsername + ' · ' + (a.oldActive ? 'active' : 'inactive') + ' → ' + (a.newActive ? 'active' : 'inactive')));
  }
}
