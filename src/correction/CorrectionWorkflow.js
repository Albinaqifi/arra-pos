import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';
import { ModalFrame, modalCardStyle } from '../shared/ModalFrame.js';
import { isCancellationOpen, cancellationGuidance } from '../waiter/cancellation-window.js';
import { SentItemCorrection } from '../waiter/SentItemCorrection.js';
import { OwnerApprovalPin } from '../waiter/OwnerApprovalPin.js';

const reasons = ['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'];
const rejections = {
  window_expired: cancellationGuidance,
  access_denied: 'Correction denied. Sign in as a waiter with order access.',
  already_billed: 'This order has already been billed. The item cannot be cancelled here.',
  unavailable: 'The order or item is unavailable, or the remaining quantity changed. Return to the order and check it.',
  invalid_input: 'Correction details are invalid. Check the quantity and explanation.',
};

export class CorrectionWorkflow extends FeatureState {
  constructor({ bridge, orders, getLanguage, getActor, canOpen, notify, jobsChanged = () => {}, requestId = () => crypto.randomUUID() }) {
    super({ dialog: null });
    Object.assign(this, { bridge, orders, getLanguage, getActor, canOpen, notify, jobsChanged, requestId });
    this.draftSequence = 0;
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  get locked() { return !!(this.state.dialog?.saving || this.state.dialog?.verifying || this.state.dialog?.closing || this.state.dialog?.unresolved); }
  open(itemId) {
    if (this.disposed || this.locked || this.orders.writeBusy() || !this.canOpen()) return false;
    const target = this.orders.captureTarget();
    const item = this.orders.snapshot().items.find(value => value.id === itemId && value.tableId === target.tableId);
    if (!item || item.status !== 'sent' || item.qty <= item.cxQty) return false;
    this._set({ dialog: { type: 'cancel', phase: isCancellationOpen(item.sentAt, Date.now()) ? 'correction' : 'pin', pin: '', itemId, qty: 1, reason: '', other: '', confirming: false, target, draftId: ++this.draftSequence } });
    return true;
  }
  async _revoke(token) { try { return !!(token && this.bridge?.revokeCancellationApproval && (await this.bridge.revokeCancellationApproval(token))?.ok); } catch (_) { return false; } }
  _revokeAfterTeardown(token) {
    // The main process independently expires each approval after at most two
    // monotonic minutes. A full two minutes starting here cannot end earlier.
    const start = globalThis.performance?.now?.() ?? Date.now();
    const retry = async () => {
      if (await this._revoke(token)) return;
      if ((globalThis.performance?.now?.() ?? Date.now()) - start < 120000) setTimeout(retry, 1000);
    };
    void retry();
  }
  dismiss() {
    const dialog = this.state.dialog;
    if (dialog?.saving || dialog?.verifying || dialog?.revoking || dialog?.unresolved) return false;
    if (!dialog?.approvalToken) { this._set({ dialog: null }); return true; }
    this._set({ dialog: { ...dialog, closing:true, revoking:true, error:'' } });
    void this._revoke(dialog.approvalToken).then(ok => {
      if (!this._current(dialog)) return;
      if (ok) this._set({ dialog:null });
      else this._set({ dialog: { ...this.state.dialog, revoking:false, error:this.t('Could not close owner approval. Try again.') } });
    });
    // Composition guards are synchronous: do not let another dialog open
    // until the trusted revocation has been acknowledged.
    return false;
  }
  reset() { const token = this.state.dialog?.approvalToken; if (token) this._revokeAfterTeardown(token); this.draftSequence++; this._set({ dialog: null }); }
  _item(dialog = this.state.dialog) { return dialog && this.orders.snapshot().items.find(item => item.id === dialog.itemId && item.tableId === this.orders.tableForOrder(dialog.target)); }
  _edit(update) {
    const dialog = this.state.dialog;
    if (!dialog || dialog.requestId || dialog.closing || this.disposed) return;
    this._set({ dialog: { ...dialog, ...update, confirming: false } });
  }
  changeQuantity(delta) {
    const dialog = this.state.dialog, item = this._item();
    if (!dialog || !item || ![-1, 1].includes(delta)) return;
    this._edit({ qty: Math.max(1, Math.min(item.qty - item.cxQty, dialog.qty + delta)) });
  }
  chooseReason(reason) { if (reasons.includes(reason)) this._edit({ reason }); }
  setOther(other) { this._edit({ other }); }
  setPin(pin) { const d = this.state.dialog; if (d?.phase === 'pin' && !d.verifying && /^\d{0,6}$/.test(pin)) this._set({ dialog: { ...d, pin, error: '' } }); }
  pinKey(key) { const pin = this.state.dialog?.pin || ''; this.setPin(key === 'Clear' ? '' : key === 'Delete' ? pin.slice(0, -1) : (pin + key).slice(0, 6)); }
  async verifyPin() {
    const dialog = this.state.dialog;
    if (!dialog || dialog.phase !== 'pin' || dialog.verifying || !/^\d{6}$/.test(dialog.pin || '') || !this.orders.isCurrent(dialog.target)) return;
    const lease = this.orders.acquireWrite('correct', dialog.target);
    if (!lease) return;
    const pin = dialog.pin;
    this._set({ dialog: { ...dialog, pin: '', verifying: true, error: '' } });
    try {
      const result = this.bridge?.authorizeCancellation ? await this.bridge.authorizeCancellation(dialog.target.orderId, dialog.itemId, pin) : null;
      if (!this._current(dialog)) { if (result?.ok && typeof result.token === 'string') this._revokeAfterTeardown(result.token); return; }
      if (result?.ok && typeof result.token === 'string') this._set({ dialog: { ...this.state.dialog, phase: 'correction', verifying: false, approvalToken: result.token, error: '' } });
      else this._set({ dialog: { ...this.state.dialog, verifying: false, error: this.t('Owner PIN could not be verified. Check the PIN or try again later.') } });
    } catch (_) { if (this._current(dialog)) this._set({ dialog: { ...this.state.dialog, verifying: false, error: this.t('Owner PIN could not be verified. Check the PIN or try again later.') } }); }
    finally { this.orders.releaseWrite(lease); }
  }
  review() {
    const dialog = this.state.dialog;
    if (!dialog || dialog.saving || dialog.closing) return;
    if (dialog.confirming || dialog.unresolved) return this.confirm();
    if (dialog.reason && (dialog.reason !== 'Other' || dialog.other.trim())) this._set({ dialog: { ...dialog, confirming: true } });
  }
  editOrDismiss() {
    const dialog = this.state.dialog;
    if (dialog?.revoking) return false;
    if (dialog?.closing) return this.dismiss();
    if (dialog?.confirming && !dialog.requestId) this._set({ dialog: { ...dialog, confirming: false } });
    else return this.dismiss();
  }
  _current(dialog) { return !this.disposed && this.state.dialog?.draftId === dialog.draftId && this.orders.isCurrent(dialog.target); }
  async confirm() {
    const dialog = this.state.dialog;
    if (!dialog || dialog.saving || dialog.closing || this.disposed || !this.orders.isCurrent(dialog.target)) return;
    if (!dialog.reason || (dialog.reason === 'Other' && !dialog.other.trim())) return;
    const item = this._item(dialog);
    if (!item || (!dialog.requestId && (item.status !== 'sent' || dialog.qty > item.qty - item.cxQty))) return;
    const expired = !isCancellationOpen(item.sentAt, Date.now());
    if (expired && !dialog.approvalToken && !dialog.unresolved) { this._set({ dialog: { ...dialog, phase: 'pin', pin: '', error: '' } }); return; }
    const lease = this.orders.acquireWrite('correct', dialog.target);
    if (!lease) return;
    if (!this.bridge) {
      try {
        if (expired) { this._set({ dialog: { ...dialog, phase: 'pin', pin: '', error: this.t('Owner approval is unavailable in demo mode.') } }); return; }
        this.orders.applyDemoCorrection(dialog.itemId, dialog.qty, dialog.reason === 'Other' ? dialog.other.trim() : dialog.reason, this.getActor());
        this._set({ dialog: null });
        this.notify(this.t('Correction saved.'));
      } finally { this.orders.releaseWrite(lease); }
      return;
    }
    // The first attempt freezes every field. A later rejection cannot prove that
    // an earlier uncertain attempt did not commit, so it must retain this payload.
    const payload = dialog.payload || Object.freeze({ itemId: dialog.itemId, quantity: dialog.qty, reason: dialog.reason === 'Other' ? dialog.other.trim() : dialog.reason, requestId: this.requestId() });
    const request = dialog.approvalToken ? { ...payload, approvalToken: dialog.approvalToken } : payload;
    this._set({ dialog: { ...dialog, payload, requestId: payload.requestId, saving: true, error: '' } });
    try {
      const result = await this.bridge.orderItems('correct', dialog.target.orderId, request);
      if (!this._current(dialog)) return;
      if (result?.ok) {
        await this.orders.refreshAvailability(lease);
        if (!this._current(dialog)) return;
        this.orders.applyConfirmedItems(lease, result.data.items);
        this.jobsChanged();
        this._set({ dialog: null });
        this.notify(this.t(result.data.noticeDeferred
          ? 'Correction saved. Printing is disabled. Check previous output and tell preparation staff in person.'
          : 'Correction saved.'));
      } else if (result?.rejected && result.code === 'window_expired') {
        this._set({ dialog: { ...this.state.dialog, phase: 'pin', pin: '', approvalToken: null, saving: false, error: '' } });
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
      t, modalTitle: t('Cancel a sent item'), modalSub: t('The original item stays in the order history.'),
      cxSentAt: item?.sentAt, cxName: item?.name || '', cxMods: item?.mods || '', cxHasMods: !!item?.mods,
      cxMeta: item ? t('Round {round} · sent {time} to {destination}', { round: item.round, time: time(item.sentAt), destination: t(item.route === 'bar' ? 'Bar' : item.route === 'kitchen2' ? 'Kitchen 2' : 'Kitchen 1') }) : '',
      cxMulti: remaining > 1, cxQty: String(dialog.qty), cxMax: t('of {count}', { count: remaining }), cxMaxNumber: remaining,
      cxInc: () => this.changeQuantity(1), cxDec: () => this.changeQuantity(-1),
      cxReasons: reasons.map(reason => ({ label: t(reason), pressed: String(dialog.reason === reason), pick: () => this.chooseReason(reason) })),
      cxReasonLabel: dialog.reason === 'Other' ? dialog.other.trim() : t(dialog.reason), cxIsOther: dialog.reason === 'Other', cxOther: dialog.other,
      onCxOther: event => this.setOther(event.target.value), cxDisabled: !dialog.reason || (dialog.reason === 'Other' && !dialog.other.trim()),
      cxConfirm: () => this.confirm(), cxReview: () => this.review(), cxEditOrDismiss: () => this.editOrDismiss(), closeModal: () => this.dismiss(),
    };
  }
  render() {
    const v = this.view();
    const dialog = this.state.dialog;
    return v && ModalFrame({ title: dialog.phase === 'pin' ? v.t('Owner approval') : v.modalTitle, subtitle: dialog.phase === 'pin' ? '' : v.modalSub, cardStyle: modalCardStyle(dialog.phase === 'pin' ? '440px' : '760px'), onClose: v.closeModal, closeLabel: v.t('Close'), children: dialog.phase === 'pin' ? React.createElement(OwnerApprovalPin, { t:v.t, dialog, onChange:event=>this.setPin(event.target.value), onKey:key=>this.pinKey(key), onVerify:()=>this.verifyPin(), onCancel:v.closeModal }) : React.createElement(SentItemCorrection, { v, modal: dialog }) });
  }
  dispose() { const token = this.state.dialog?.approvalToken; if (token) this._revokeAfterTeardown(token); this.draftSequence++; super.dispose(); }
}
