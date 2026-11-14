import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate, style } from '../shared/waiter-ui.js';
import { ModalFrame, modalCardStyle } from '../shared/ModalFrame.js';
import { renderBill } from '../waiter/Bill.js';
import { demoBillView, demoHistoryView } from './demo-bill-view.js';
import { renderBillHistory } from './BillHistory.js';

export class DemoBilling extends FeatureState {
  constructor({ enabled, orders, printing, getLanguage, getActor, notify, completeHandoff }) {
    const now = Date.now(), minute = 60000;
    super({ dialog: null, busy: false, billNo: 1045, history: enabled ? [
      { no: 1044, table: 'Table 1', closedAt: now - 45 * minute, waiter: 'Marko', method: 'Card', account: 'A', total: 2310, count: 9 },
      { no: 1043, table: 'Table 14', closedAt: now - 80 * minute, waiter: 'Dita', method: 'Cash', account: 'B', total: 620, count: 4 },
      { no: 1042, table: 'Table 6', closedAt: now - 110 * minute, waiter: 'Arta', method: 'Cash', account: 'A', total: 940, count: 5 },
      { no: 1041, table: 'Table 2', closedAt: now - 150 * minute, waiter: 'Besnik', method: 'Card', account: 'A', total: 1860, count: 7 },
    ] : [] });
    Object.assign(this, { enabled, orders, printing, getLanguage, getActor, notify, completeHandoff });
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  get locked() { return this.state.busy; }
  current() {
    const dialog = this.state.dialog;
    return !this.disposed && this.enabled && dialog && this.orders.isCurrent(dialog.target) && this.orders.tableForOrder(dialog.target) === dialog.target.tableId;
  }
  open(target) {
    if (!this.enabled || this.disposed || this.locked) return;
    this._set({ dialog: { target, step: 'confirm', method: null, account: null, printed: 0, backup: false } });
  }
  dismiss() { if (this.locked) return false; this._set({ dialog: null }); return true; }
  reset() { this._set({ dialog: null }); }
  continue() {
    if (!this.current() || this.locked) return;
    const { target } = this.state.dialog;
    if (this.orders.snapshot().items.some(item => item.tableId === target.tableId && item.status === 'pending')) return;
    this._set({ dialog: { ...this.state.dialog, step: 'method' } });
  }
  selectMethod(method) {
    if (!this.current() || this.locked || !['Cash', 'Card'].includes(method)) return;
    this._set({ dialog: { ...this.state.dialog, method, account: method === 'Card' ? 'A' : null, step: method === 'Card' ? 'review' : 'account' } });
  }
  selectAccount(account) {
    if (!this.current() || this.locked || !['A', 'B'].includes(account) || (account === 'B' && this.state.dialog.method !== 'Cash')) return;
    this._set({ dialog: { ...this.state.dialog, account, step: 'review' } });
  }
  back() {
    if (!this.current() || this.locked) return;
    const dialog = this.state.dialog;
    const step = dialog.step === 'method' ? 'confirm' : dialog.step === 'account' ? 'method' : dialog.step === 'review' ? (dialog.method === 'Card' ? 'method' : 'account') : dialog.step;
    this._set({ dialog: { ...dialog, step } });
  }
  print(useBackup) {
    if (!this.current() || this.locked) return;
    const bill = this.state.dialog, account = bill.method === 'Card' ? 'A' : bill.account;
    if (!bill.method || !account) return;
    const failed = !useBackup && !this.printing.isOnline(account), where = 'Printer ' + account + (useBackup ? ' (backup)' : '');
    this.orders.appendActivity(bill.target.tableId, failed ? 'Bill did not print on Printer ' + account + '. No payment recorded' : bill.printed > 0 ? 'Reprinted the bill on ' + where + ' (no new payment)' : 'Printed bill on ' + where + ': ' + bill.method + ', Account ' + account, this.getActor());
    this._set({ dialog: { ...bill, account, step: failed ? 'failed' : 'printed', printed: failed ? bill.printed : bill.printed + 1, backup: failed ? bill.backup : !!useBackup } });
    if (!failed && bill.printed > 0) this.notify(this.t('Bill reprinted. Still one payment.'));
  }
  async paid() {
    if (!this.current() || this.locked || !this.state.dialog.printed) return;
    const bill = this.state.dialog, tableId = bill.target.tableId;
    if (bill.method === 'Card' && bill.account !== 'A') { this.notify(this.t('Blocked: card payments can only go to Account A.'), 'err'); return; }
    const lease = this.orders.acquireWrite('demo-payment', bill.target);
    if (!lease) return;
    this._set({ busy: true });
    try {
      try {
        const items = this.orders.snapshot().items.filter(item => item.tableId === tableId);
        const total = items.reduce((sum, item) => sum + (item.qty - item.cxQty) * item.unit, 0), count = items.reduce((sum, item) => sum + item.qty - item.cxQty, 0);
        const record = { no: this.state.billNo, table: 'Table ' + tableId, closedAt: Date.now(), waiter: this.getActor(), method: bill.method, account: bill.account, total, count };
        this.orders.completeDemoOrder(tableId); this.printing.retireOrderJobs(tableId);
        this._set({ dialog: null, billNo: this.state.billNo + 1, history: [record, ...this.state.history] });
        this.notify(this.t('Table {id} is free. Payment saved once: {method}, Account {account}, {total}.', { id: tableId, method: this.t(bill.method), account: bill.account, total: Math.round(total).toLocaleString('en-US') + ' den' }));
      } finally { this.orders.releaseWrite(lease); }
      await this.completeHandoff();
    }
    finally { this._set({ busy: false }); }
  }
  view() {
    return demoBillView({ state: this.state, data: this.orders.snapshot(), language: this.getLanguage(), actor: this.getActor(), commands: {
      dismiss: () => this.dismiss(), continue: () => this.continue(), selectMethod: method => this.selectMethod(method),
      selectAccount: account => this.selectAccount(account), back: () => this.back(), print: backup => this.print(backup), paid: () => this.paid(),
    } });
  }
  historyView() { return demoHistoryView(this.state.history, this.getLanguage()); }
  renderHistory() { return renderBillHistory(this.historyView()); }
  render() {
    if (!this.state.dialog) return null;
    const view = this.view();
    return ModalFrame({ title: view.modalTitle, subtitle: view.modalSub, cardStyle: modalCardStyle('880px'), onClose: () => this.dismiss(), closeLabel: this.t('Close'), children: renderBill(view, style) });
  }
}
