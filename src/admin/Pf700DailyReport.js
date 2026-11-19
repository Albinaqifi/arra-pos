import { financeText } from './finance-i18n.js';

const h = React.createElement;
const blockedReasons = {
  empty: 'This day has no Account A fiscal receipts.',
  coverage: 'The Account A payments and corrections for this day do not match its registered PF700 receipts.',
  period: 'The PF700 fiscal period includes activity from another Arra business day.',
  unresolved: 'Resolve the outstanding PF700 operation before issuing a daily report.',
  unavailable: 'Reopen the fiscal profile and printer used for this day.'
};

export function Pf700DailyReport({ day, language, busy, operation, confirming, onReview, onCancel, onConfirm, onCheck }) {
  const t = (key, values) => financeText(language, key, values);
  const { mode, status, reason, reportNumber, canReconcile } = day.fiscal;
  const simulated = mode === 'simulation';
  const heading = simulated ? 'Simulated PF700 daily report' : 'Official PF700 daily report (Z)';
  const review = simulated ? 'Review simulated Z report' : 'Review official Z report';
  const confirm = simulated ? 'Simulate Z report' : 'Issue official Z report';
  let content;
  if (operation) {
    const message = operation === 'check' ? 'Checking report status…'
      : simulated ? 'Simulating the Z report…' : 'Requesting the official Z report…';
    content = h('p', { role: 'status' }, t(message));
  } else if (status === 'complete' && reportNumber) {
    content = h('p', { role: 'status' }, simulated
      ? t('Simulated report SIM-Z-{number} recorded.', { number: reportNumber })
      : t('PF700 acknowledged official Z report #{number}. Check the printed report.', { number: reportNumber }));
  } else if (status === 'uncertain') {
    content = h(React.Fragment, null,
      h('p', { role: 'alert' }, t(simulated
        ? 'The simulated report outcome is unknown. Another close is blocked.'
        : 'The PF700 may have issued the report. Check the paper. Another close is blocked.')),
      canReconcile === true && h('button', { type: 'button', disabled: busy, onClick: onCheck },
        t(simulated ? 'Check simulated report status' : 'Check PF700 report status (read only)')));
  } else if (status === 'pending') {
    content = h('p', { role: 'status' }, t('A report request is in progress. Refresh to see its saved status.'));
  } else if (status === 'ready' && (simulated || mode === 'device')) {
    content = confirming
      ? h('div', { className: 'finance-confirm', role: 'group', 'aria-label': t(confirm) },
          h('p', null, t(simulated
            ? 'Simulate a fiscal day close for business day #{id}? This uses the training ledger. The physical printer is untouched.'
            : 'Issue the official Z report for business day #{id}? This prints the report and closes the fiscal day on the PF700. This cannot be undone.', { id: day.id })),
          h('div', { className: 'floor-actions' },
            h('button', { type: 'button', className: 'floor-primary', disabled: busy, onClick: onConfirm }, t(confirm)),
            h('button', { type: 'button', autoFocus: true, disabled: busy, onClick: onCancel }, t('Cancel'))))
      : h('button', { type: 'button', disabled: busy, onClick: onReview }, t(review));
  } else {
    content = h('p', { role: 'alert' }, t(blockedReasons[reason] || 'The fiscal daily report is unavailable for this day.'));
  }
  return h('section', null, h('h4', null, t(heading)), content);
}
