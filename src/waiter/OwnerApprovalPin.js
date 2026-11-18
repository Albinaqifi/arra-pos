import { installCorrectionFocus } from './SentItemCorrection.js';
const h = React.createElement;
export function OwnerApprovalPin({ t, dialog, onChange, onKey, onVerify, onCancel }) {
  const root = React.useRef(null);
  React.useEffect(() => installCorrectionFocus(root.current.closest('[role="dialog"]'), document.activeElement), []);
  const keys = ['1','2','3','4','5','6','7','8','9','Clear','0','Delete'];
  return h('div', { ref: root, className:'correction-flow' },
    h('label', null, t('Owner 6-digit PIN'), h('input', { type:'password', inputMode:'numeric', pattern:'[0-9]*', maxLength:6, autoComplete:'off', value:dialog.pin || '', onChange, disabled:dialog.verifying })),
    h('div', { style:{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8 } }, keys.map(key => h('button', { type:'button', key, disabled:dialog.verifying, onClick:()=>onKey(key), style:{ minHeight:48 }, 'aria-label': key === 'Clear' ? t('Clear PIN') : key === 'Delete' ? t('Delete last digit') : t('Digit {digit}', { digit:key }) }, key === 'Clear' ? t('Clear') : key === 'Delete' ? t('Delete') : key))),
    dialog.error && h('p', { role:'alert', className:'correction-error' }, dialog.error),
    h('div', { className:'correction-actions' }, h('button', { type:'button', disabled:dialog.verifying || dialog.unresolved, onClick:onCancel }, t('Keep item')), h('button', { type:'button', className:'correction-primary', disabled:dialog.verifying || (dialog.pin || '').length !== 6, onClick:onVerify }, dialog.verifying ? t('Checking…') : t('Verify PIN'))));
}
