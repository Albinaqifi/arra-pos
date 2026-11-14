import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';
import { ModalFrame, modalCardStyle } from '../shared/ModalFrame.js';
import { SentItemCorrection } from '../waiter/SentItemCorrection.js';

const reasons = ['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'];
const rejections = {
  access_denied: 'Correction denied. Sign in as a waiter with order access.',
  already_billed: 'This order has already been billed. The item cannot be cancelled here.',
  unavailable: 'The order or item is unavailable, or the remaining quantity changed. Return to the order and check it.',
  invalid_input: 'Correction details are invalid. Check the quantity and explanation.',
};

export class CorrectionWorkflow extends FeatureState {
  constructor({ bridge, orders, getLanguage, getActor, canOpen, notify, requestId = () => crypto.randomUUID() }) {
    super({ dialog: null });
    Object.assign(this, { bridge, orders, getLanguage, getActor, canOpen, notify, requestId });
    this.draftSequence = 0;
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  get locked() { return !!(this.state.dialog?.saving || this.state.dialog?.unresolved); }
  open(itemId) {
    if (this.disposed || this.locked || this.orders.writeBusy() || !this.canOpen()) return false;
    const target = this.orders.captureTarget();
    const item = this.orders.snapshot().items.find(value => value.id === itemId && value.tableId === target.tableId);
    if (!item || item.status !== 'sent' || item.qty <= item.cxQty) return false;
    this._set({ dialog: { type: 'cancel', itemId, qty: 1, reason: '', other: '', confirming: false, target, draftId: ++this.draftSequence } });
    return true;
  }
  dismiss() { if (this.locked) return false; this._set({ dialog: null }); return true; }
  reset() { this.draftSequence++; this._set({ dialog: null }); }
  _item(dialog = this.state.dialog) { return dialog && this.orders.snapshot().items.find(item => item.id === dialog.itemId && item.tableId === this.orders.tableForOrder(dialog.target)); }
  _edit(update) {
    const dialog = this.state.dialog;
    if (!dialog || dialog.requestId || this.disposed) return;
    this._set({ dialog: { ...dialog, ...update, confirming: false } });
  }
  changeQuantity(delta) {
    const dialog = this.state.dialog, item = this._item();
    if (!dialog || !item || ![-1, 1].includes(delta)) return;
    this._edit({ qty: Math.max(1, Math.min(item.qty - item.cxQty, dialog.qty + delta)) });
  }
  chooseReason(reason) { if (reasons.includes(reason)) this._edit({ reason }); }
  setOther(other) { this._edit({ other }); }
  review() {
    const dialog = this.state.dialog;
    if (!dialog || dialog.saving) return;
    if (dialog.confirming || dialog.unresolved) return this.confirm();
    if (dialog.reason && (dialog.reason !== 'Other' || dialog.other.trim())) this._set({ dialog: { ...dialog, confirming: true } });
  }
  editOrDismiss() {
    const dialog = this.state.dialog;
    if (dialog?.confirming && !dialog.requestId) this._set({ dialog: { ...dialog, confirming: false } });
    else return this.dismiss();
  }
  _current(dialog) { return !this.disposed && this.state.dialog?.draftId === dialog.draftId && this.orders.isCurrent(dialog.target); }
  async confirm() {
    const dialog = this.state.dialog;
    if (!dialog || dialog.saving || this.disposed || !this.orders.isCurrent(dialog.target)) return;
    if (!dialog.reason || (dialog.reason === 'Other' && !dialog.other.trim())) return;
    const item = this._item(dialog);
    if (!item || (!dialog.requestId && (item.status !== 'sent' || dialog.qty > item.qty - item.cxQty))) return;
    const lease = this.orders.acquireWrite('correct', dialog.target);
    if (!lease) return;
    if (!this.bridge) {
      try {
        this.orders.applyDemoCorrection(dialog.itemId, dialog.qty, dialog.reason === 'Other' ? dialog.other.trim() : dialog.reason, this.getActor());
        this._set({ dialog: null });
        this.notify(this.t('Correction saved. Tell preparation staff in person.'));
      } finally { this.orders.releaseWrite(lease); }
      return;
    }
    // The first attempt freezes every field. A later rejection cannot prove that
    // an earlier uncertain attempt did not commit, so it must retain this payload.
    const payload = dialog.payload || Object.freeze({ itemId: dialog.itemId, quantity: dialog.qty, reason: dialog.reason === 'Other' ? dialog.other.trim() : dialog.reason, requestId: this.requestId() });
    this._set({ dialog: { ...dialog, payload, requestId: payload.requestId, saving: true, error: '' } });
    try {
      const result = await this.bridge.orderItems('correct', dialog.target.orderId, payload);
      if (!this._current(dialog)) return;
      if (result?.ok) {
        await this.orders.refreshAvailability(lease);
        if (!this._current(dialog)) return;
        this.orders.applyConfirmedItems(lease, result.data.items);
        this._set({ dialog: null });
        this.notify(this.t('Correction saved. Tell preparation staff in person.'));
      } else if (result?.rejected && !dialog.unresolved) {
        this._set({ dialog: { ...this.state.dialog, saving: false, unresolved: false, payload: null, requestId: null, error: this.t(rejections[result.code] || 'Correction rejected. Check authorization and quantity.') } });
      } else this._unknown(dialog);
    } catch (_) { if (this._current(dialog)) this._unknown(dialog); }
    finally { this.orders.releaseWrite(lease); }
  }
  _unknown(dialog) {
    if (this._current(dialog)) this._set({ dialog: { ...this.state.dialog, saving: false, unresolved: true, error: this.t('Correction status unknown. Retry before leaving.') } });
  }
  view() {
    const dialog = this.state.dialog;
    if (!dialog) return null;
    const item = this._item(dialog), remaining = item ? item.qty - item.cxQty : 1;
    const t = (key, values) => this.t(key, values);
    const time = value => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return {
      t, modalTitle: t('Cancel a sent item'), modalSub: t('It was already sent, so it stays on record, crossed out.'),
      cxName: item?.name || '', cxMods: item?.mods || '', cxHasMods: !!item?.mods,
      cxMeta: item ? t('Round {round} · sent {time} to {destination}', { round: item.round, time: time(item.sentAt), destination: t(item.route === 'bar' ? 'Bar' : 'Kitchen') }) : '',
      cxMulti: remaining > 1, cxQty: String(dialog.qty), cxMax: t('of {count}', { count: remaining }), cxMaxNumber: remaining,
      cxInc: () => this.changeQuantity(1), cxDec: () => this.changeQuantity(-1),
      cxReasons: reasons.map(reason => ({ label: t(reason), pressed: String(dialog.reason === reason), pick: () => this.chooseReason(reason) })),
      cxReasonLabel: dialog.reason === 'Other' ? dialog.other.trim() : t(dialog.reason), cxIsOther: dialog.reason === 'Other', cxOther: dialog.other,
      onCxOther: event => this.setOther(event.target.value), cxDisabled: !dialog.reason || (dialog.reason === 'Other' && !dialog.other.trim()),
      cxInfo: t('Tell preparation staff in person; no cancellation notice is printed and earlier output may still arrive.'),
      cxConfirm: () => this.confirm(), cxReview: () => this.review(), cxEditOrDismiss: () => this.editOrDismiss(), closeModal: () => this.dismiss(),
    };
  }
  render() {
    const v = this.view();
    return v && ModalFrame({ title: v.modalTitle, subtitle: v.modalSub, cardStyle: modalCardStyle('760px'), onClose: v.closeModal, closeLabel: v.t('Close'), children: React.createElement(SentItemCorrection, { v, modal: this.state.dialog }) });
  }
  dispose() { this.draftSequence++; super.dispose(); }
}
