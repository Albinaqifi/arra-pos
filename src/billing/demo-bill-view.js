import { waiterTranslate } from '../shared/waiter-ui.js';

const money = value => Math.round(value).toLocaleString('en-US') + ' den';
const hm = time => { const date = new Date(time); return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); };
const bq = item => item.qty - item.cxQty;

export function demoBillView({ state, data, language, actor, commands }) {
  const t = (key, values) => waiterTranslate(language, 'waiter.' + key, values);
  const v = { t, isBill: !!state.dialog, closeModal: () => commands.dismiss() };
  if (!state.dialog) return v;
  const tid = state.dialog.target.tableId, now = Date.now();
  const its = data.items.filter(item => item.tableId === tid), billable = its.filter(item => item.status !== 'pending' && bq(item) > 0);
  const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
  const pc = its.filter(item => item.status === 'pending').reduce((sum, item) => sum + item.qty, 0);
  const b = state.dialog; const st = b.step;
  v.bConfirm = st === 'confirm'; v.bMethod = st === 'method'; v.bAccount = st === 'account';
  v.bReview = st === 'review'; v.bFailed = st === 'failed'; v.bPrinted = st === 'printed';
  v.bReceipt = v.bReview || v.bFailed || v.bPrinted;
  v.billLines = billable.map(i => ({ qty: bq(i) + '×', name: i.name, mods: i.mods, hasMods: !!i.mods, amount: money(bq(i) * i.unit) }));
  v.billTotal = money(billable.reduce((a, i) => a + bq(i) * i.unit, 0));
  v.billTable = t('Table {id}', {id:tid});
  v.billBlocked = pc > 0;
  v.billBlockedText = t(pc === 1 ? '{count} new item is not sent yet. Send or remove it before printing the bill.' : '{count} new items are not sent yet. Send or remove them before printing the bill.', {count:pc});
  v.bYesStyle = 'flex:2; ' + bigBtn(pc === 0, '#2563EB', '#FFFFFF');
  const titles = {
    confirm: [t('Print the bill for Table {id}?', {id:tid}), t("Check the items with the customer. Cancelled items are not on the bill.")],
    method: [t("How is the customer paying?"), t('Table {id} · {total}', {id:tid,total:v.billTotal})],
    account: [t('Cash: which account?'), t('Table {id} · {total} · each account has its own bill printer', {id:tid,total:v.billTotal})],
    review: [t("Check and print"), t('Table {id} · {total}', {id:tid,total:v.billTotal})],
    failed: [t("The bill did not print"), t('Table {id} · nothing was charged', {id:tid})],
    printed: [t("Bill printed"), t('Table {id} · {total}', {id:tid,total:v.billTotal})]
  };
  v.modalTitle = titles[st][0]; v.modalSub = titles[st][1];
  v.isCard = b.method === 'Card';
  const acc = b.method === 'Card' ? 'A' : (b.account || '');
  v.billMethod = b.method ? t(b.method) : ''; v.billAccount = acc ? t('Account {account}', {account:acc}) : '';
  v.billAccStyle = acc === 'B' ? 'color:#6B21A8' : 'color:#1E40AF';
  v.billPrinter = acc ? t(b.backup ? 'Printer {account} (backup)' : 'Printer {account}', {account:acc}) : '';
  v.billMethodLine = t('{method} · Account {account}', {method:v.billMethod,account:acc});
  v.billNo = t('Bill #{number}', {number:state.billNo}); v.billWaiter = t('Waiter: {name}', {name:actor});
  const dd = new Date(now);
  v.billDate = String(dd.getDate()).padStart(2, '0') + '.' + String(dd.getMonth() + 1).padStart(2, '0') + '.' + dd.getFullYear() + ' ' + hm(now);
  v.printedText = t(b.printed > 1 ? 'Printed on {printer} · printed {count} times, still one payment.' : 'Printed on {printer}.', {printer:v.billPrinter,count:b.printed});
  v.failText = t('Printer {account} is not responding. The bill did not print and no payment was recorded. The order is safe.', {account:acc});
  v.bYes = () => commands.continue();
  v.bCash = () => commands.selectMethod('Cash'); v.bCard = () => commands.selectMethod('Card');
  v.bAccA = () => commands.selectAccount('A'); v.bAccB = () => commands.selectAccount('B');
  v.bBack = () => commands.back();
  v.bPrint = () => commands.print(false); v.bRetry = () => commands.print(false);
  v.bBackup = () => commands.print(true); v.bReprint = () => commands.print(false);
  v.bPaid = () => commands.paid();
  return v;
}

export function demoHistoryView(history, language) {
  const v = {}, t = (key, values) => waiterTranslate(language, 'waiter.' + key, values);
  v.t = t;
  const H = history;
  v.hist = H.map(h => ({
  no: '#' + h.no, table: h.table, time: hm(h.closedAt), waiter: h.waiter, items: String(h.count), method: h.method, account: 'Account ' + h.account, total: money(h.total),
  accStyle: 'height:30px; padding:0 12px; border-radius:999px; display:inline-flex; align-items:center; font-size:14px; font-weight:800; ' + (h.account === 'A' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#F3E8FF; color:#6B21A8')
  }));
  const sum = f => money(H.filter(f).reduce((a, h) => a + h.total, 0));
  v.hCount = String(H.length);
  v.hCashA = sum(h => h.method === 'Cash' && h.account === 'A');
  v.hCashB = sum(h => h.method === 'Cash' && h.account === 'B');
  v.hCardA = sum(h => h.method === 'Card');

  return v;
}
