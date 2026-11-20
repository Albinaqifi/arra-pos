import { financeText } from './finance-i18n.js';

const h = React.createElement;
const blockedReasons = {
  empty: 'This day has no Account A fiscal receipts.',
  coverage: 'The Account A payments and corrections for this day do not match its registered PF700 receipts.',
  period: 'The PF700 fiscal period includes activity from another Arra business day.',
  'receipt-evidence': 'A registered Account A receipt is missing its close counters. Reconcile the original receipt before closing.',
  unresolved: 'Resolve the outstanding PF700 operation before issuing a daily report.',
  unavailable: 'Reopen the fiscal profile and printer used for this day.'
};

const checkReasons = {
  read: 'Could not read the printer reply to command {command}. Check the connection.',
  format: 'The printer reply to command {command} has an unrecognized format.',
  status: 'The printer reported a problem during command {command}. Check the printer display and paper.',
  fields: 'Command {command} returned {actual} fields. Arra expected {expected}.',
  identity: 'The connected printer or firmware does not match the enrolled PF700.',
  'receipt-open': 'The printer has an open receipt. Resolve that receipt before closing.',
  'last-close-date': 'The previous fiscal close must be earlier than the printer’s current date.',
  clock: 'The printer date and the POS date differ. Check both clocks.',
  limit: 'A printer counter has reached its supported limit.',
  busy: 'The printer is busy. Wait for the current operation to finish, then check again.'
};
const registerNames = {
  total: 'Total', unpaid: 'Unpaid amount', cash: 'Cash', credit: 'Credit', card: 'Card',
  cheque: 'Cheque', receipts: 'Fiscal receipt count', reversals: 'Reversal count',
  closure: 'Fiscal close number', nextReceipt: 'Next receipt number'
};

function checkFailure(check, t) {
  const unavailable = 'The printer check could not be completed. Check the connection and try again.';
  if (check.error === 'review') return t('The previous check is no longer valid. Check again before closing.');
  if (Object.hasOwn(blockedReasons, check.error)) return t(blockedReasons[check.error]);
  const detail = check.detail;
  if (detail && Object.hasOwn(checkReasons, detail.code)) return t(checkReasons[detail.code], detail);
  if (detail && ['amount', 'count'].includes(detail.code) && Number.isSafeInteger(detail.expected) && Number.isSafeInteger(detail.actual)) {
    if (detail.field === 'vat' ? ![0,1,2,3].includes(detail.group) : !Object.hasOwn(registerNames, detail.field)) return t(unavailable);
    const field = detail.field === 'vat' ? t('VAT group {group}', { group: ['А','Б','В','Г'][detail.group] }) : t(registerNames[detail.field]);
    const money = detail.code === 'amount';
    return t(money ? '{field}: Arra expects {expected} MKD, the printer reports {actual} MKD.'
      : '{field}: Arra expects {expected}, the printer reports {actual}.', {
      field, expected: money ? (detail.expected / 100).toFixed(2) : detail.expected,
      actual: money ? (detail.actual / 100).toFixed(2) : detail.actual
    });
  }
  return t(unavailable);
}

export function Pf700DailyReport({ day, language, busy, operation, check, onPreview, onCancel, onConfirm, onReconcile }) {
  const t = (key, values) => financeText(language, key, values);
  const { mode, status, reason, reportNumber, canReconcile } = day.fiscal;
  const simulated = mode === 'simulation';
  const heading = simulated ? 'Simulated PF700 daily report' : 'Official PF700 daily report (Z)';
  const confirm = simulated ? 'Simulate Z report' : 'Issue official Z report';
  let content;
  if (operation) {
    const message = operation === 'preview' ? 'Checking before closing…' : operation === 'reconcile' ? 'Checking report status…'
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
      canReconcile === true && h('button', { type: 'button', disabled: busy, onClick: onReconcile },
        t(simulated ? 'Check simulated report status' : 'Check PF700 report status (read only)')));
  } else if (status === 'checking') {
    content = h('p', { role: 'status' }, t('A read-only check is in progress. Refresh to check this day again.'));
  } else if (status === 'pending') {
    content = h('p', { role: 'status' }, t('A report request is in progress. Refresh to see its saved status.'));
  } else if (status === 'ready' && (simulated || mode === 'device')) {
    content = check?.checkId
      ? h('div', { className: 'finance-confirm', role: 'group', 'aria-label': t(confirm) },
          h('p', { role: 'status' }, t(check.printerDocument !== undefined
            ? 'Fiscal totals match. Review the document numbers before closing.'
            : 'Ready to close. The printer check passed.')),
          check.printerDocument !== undefined && h('div', { role: 'alert' },
            h('span', { className: 'fiscal-document-warning-icon', 'aria-hidden': true }, '⚠'),
            h('p', null, t('Arra’s last sale receipt is #{sale}. The printer’s last document is #{printer}. A Daily control report may explain the difference. Please ask the person responsible for the fiscal printer to review these numbers. You can continue closing.',
              { sale: String(Number(check.saleDocument)), printer: String(Number(check.printerDocument)) }))),
          h('p', null, t(simulated
            ? 'Simulate a fiscal day close for business day #{id}? This uses the training ledger. The physical printer is untouched.'
            : 'Issue the official Z report for business day #{id}? This prints the report and closes the fiscal day on the PF700. This cannot be undone.', { id: day.id })),
          h('div', { className: 'floor-actions' },
            h('button', { type: 'button', className: 'floor-primary', disabled: busy, onClick: onConfirm }, t(confirm)),
            h('button', { type: 'button', autoFocus: true, disabled: busy, onClick: onCancel }, t('Cancel'))))
      : h(React.Fragment, null,
          check?.error && h('p', { role: 'alert' }, checkFailure(check, t)),
          h('p', null, t(check?.error ? 'No Z report was issued by this request.'
            : 'Checking reads the printer without printing or closing the fiscal day.')),
          h('button', { type: 'button', disabled: busy, onClick: onPreview }, t('Check before closing')));
  } else {
    content = h('p', { role: 'alert' }, t(blockedReasons[reason] || 'The fiscal daily report is unavailable for this day.'));
  }
  return h('section', null, h('h4', null, t(heading)), content);
}
