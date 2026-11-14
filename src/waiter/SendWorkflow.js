import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';

// One renderer-lifetime owner: an unacknowledged round keeps its request identity
// when the waiter, selected table, language, or order panel changes.
export class SendWorkflow extends FeatureState {
  #requests = new Map();

  constructor({ bridge, orders, printing, submitDemoRound, completeHandoff, getLanguage, getActor, notify, canSend = () => true, uuid = () => crypto.randomUUID() }) {
    super({ busy: false });
    Object.assign(this, { bridge, orders, printing, submitDemoRound, completeHandoff, getLanguage, getActor, notify, canSend, uuid });
  }

  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  current(target) { return !this.disposed && this.orders.isCurrent(target); }

  async send() {
    if (this.disposed || this.state.busy || this.orders.writeBusy() || !this.canSend()) return;
    const target = this.orders.captureTarget();
    if (this.bridge && !target.orderId) return;
    this._set({ busy: true });
    try {
      if (!this.bridge) {
        const actor = this.getActor();
        const sent = this.orders.markPendingSent(target.tableId, actor);
        if (!sent) return;
        const notice = this.submitDemoRound({ tableId: target.tableId, round: sent.round, items: sent.items, actor });
        await this.completeHandoff(notice);
        return;
      }
      const lease = this.orders.acquireWrite('send', target);
      if (!lease) return;
      let data;
      // The data lease ends after the item response. The wider send lock stays
      // held through print lookup and the complete staff handoff.
      try {
        if (!this.#requests.has(target.orderId)) this.#requests.set(target.orderId, this.uuid());
        let result;
        try { result = await this.bridge.orderItems('send', target.orderId, this.#requests.get(target.orderId)); }
        catch (_) { result = { ok: false }; }
        if (!this.current(target)) return;
        if (!result?.ok) { this.notify(this.t('Could not save order items. Try again.'), 'err'); return; }
        this.#requests.delete(target.orderId);
        if (!this.orders.applyConfirmedItems(target, result.data.items)) return;
        data = result.data;
      } finally { this.orders.releaseWrite(lease); }
      this.printing.jobsChanged();
      const pending = data.items.some(item => item.status === 'pending');
      const printNotice = await this.printing.handoffNotice(this.getLanguage());
      if (!this.current(target)) return;
      const physicalNotice = data.testPrintEnabled
        ? this.t('Test print output is not confirmed. Check the printer and paper.')
        : this.t('No physical ticket was printed.');
      const notice = [pending ? this.t('Table {id} has new items still pending. Select a waiter, reopen the table and send again.', { id: target.tableId }) : '', printNotice, physicalNotice].filter(Boolean).join(' ');
      await this.completeHandoff(notice);
    } finally { this._set({ busy: false }); }
  }

  buttonView() {
    const { tableId, items } = this.orders.snapshot();
    const count = items.filter(item => item.tableId === tableId && item.status === 'pending').reduce((sum, item) => sum + item.qty, 0);
    return {
      sendDisabled: count === 0,
      sendLabel: count ? this.t('Send order · {count}', { count }) : this.t('Nothing new to send'),
      sendStyle: 'flex:2; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (count ? 'background:#16A34A; color:#FFFFFF; box-shadow:0 10px 22px rgba(22,163,74,0.35)' : 'background:#E2E8F0; color:#475569'),
      send: () => this.send(),
    };
  }

  dispose() { this._set({ busy: false }); super.dispose(); }
}
