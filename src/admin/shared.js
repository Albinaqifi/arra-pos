import { configText } from './config-i18n.js';
// These helpers return the same native elements used by the configuration screens.
export function accessNotice({ title, loading, error, guidance, onBack, language }) {
  const h = React.createElement;
  return h('main', null,
    h('button', { onClick: onBack }, configText(language, 'Back to administration')),
    h('h1', null, title),
    loading ? h('p', { role: 'status' }, loading) : h('p', { role: 'alert' }, error, guidance));
}

export function labeledInput(label, value, change, type = 'text') {
  const h = React.createElement;
  return h('label', null, label, ' ', h('input', { type, value, onChange: e => change(e.target.value) }));
}
