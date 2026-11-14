import { FeatureState } from '../shared/FeatureState.js';
import { DesktopBill } from '../waiter/DesktopBill.js';

// Owns dialog identity and the cross-feature navigation lock, not bill amounts
// or payment selection. DesktopBill retains the complete desktop bill workflow.
export class BillingBoundary extends FeatureState {
  constructor({ bridge, orders, printing, getLanguage, canOpen, dismissOtherDialogs, openDemo, dismissDemo, isDemoOpen, isDemoLocked, completeHandoff }) {
    super({ desktop: null, handoff: false });
    Object.assign(this, { bridge, orders, printing, getLanguage, canOpen, dismissOtherDialogs, openDemo, dismissDemo, isDemoOpen, isDemoLocked, completeHandoff });
    this.sequence = 0;
  }
  get openDialog() { return !!this.state.desktop || this.isDemoOpen(); }
  get locked() { return !!(this.state.handoff || this.state.desktop?.busy || this.state.desktop?.uncertain || this.state.desktop?.confirmed || this.isDemoLocked()); }
  current(dialog) { return !this.disposed && this.state.desktop?.key === dialog.key && this.orders.isCurrent(dialog.target); }
  open() {
    if (this.disposed || this.locked || this.orders.writeBusy() || !this.canOpen()) return;
    const target = this.orders.captureTarget();
    if (target.orderId == null || !this.dismissOtherDialogs()) return;
    if (!this.bridge) { this.openDemo(target); return; }
    this._set({ desktop: { key: ++this.sequence, target, orderId: target.orderId, busy: false, uncertain: false } });
  }
  dismiss() {
    if (this.locked) return false;
    this._set({ desktop: null });
    return this.dismissDemo();
  }
  reset() { this.sequence++; this._set({ desktop: null }); }
  beginOperation(dialog, kind) {
    if (!this.current(dialog) || this.state.desktop.busy || this.state.handoff) return null;
    const lease = this.orders.acquireWrite(kind, dialog.target);
    if (!lease) return null;
    this._set({ desktop: { ...this.state.desktop, busy: true } });
    return lease;
  }
  endOperation(dialog, lease) {
    this.orders.releaseWrite(lease);
    if (this.current(dialog)) this._set({ desktop: { ...this.state.desktop, busy: false } });
  }
  markUncertain(dialog, uncertain) {
    if (this.current(dialog)) this._set({ desktop: { ...this.state.desktop, uncertain } });
  }
  markConfirmed(dialog) {
    if (this.current(dialog)) this._set({ desktop: { ...this.state.desktop, confirmed: true } });
  }
  async paymentConfirmed(dialog) {
    if (!this.current(dialog)) return;
    this._set({ desktop: null, handoff: true });
    try { await this.completeHandoff(); }
    finally { this._set({ handoff: false }); }
  }
  async finishHandoff() {
    if (this.disposed || this.state.handoff) return;
    this._set({ handoff: true });
    try { await this.completeHandoff(); }
    finally { this._set({ handoff: false }); }
  }
  buttonView() {
    const { tableId, orders, items } = this.orders.snapshot();
    const disabled = !orders[tableId] || (!this.bridge && !items.some(item => item.tableId === tableId && item.status !== 'pending' && item.qty > item.cxQty));
    return {
      billDisabled: disabled,
      billStyle: 'flex:1; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (disabled ? 'background:#E2E8F0; color:#475569' : 'background:#2563EB; color:#FFFFFF; box-shadow:0 10px 22px rgba(37,99,235,0.3)'),
      openBill: () => this.open(),
    };
  }
  render() {
    const dialog = this.state.desktop;
    return dialog ? React.createElement(DesktopBill, {
      key: dialog.key, orderId: dialog.orderId, language: this.getLanguage(), printing: this.printing,
      isCurrent: () => this.current(dialog), beginOperation: kind => this.beginOperation(dialog, kind), endOperation: lease => this.endOperation(dialog, lease),
      onUncertain: uncertain => this.markUncertain(dialog, uncertain), onConfirmed: () => this.markConfirmed(dialog), onClose: () => { if (this.current(dialog)) this.dismiss(); }, onPaid: () => this.paymentConfirmed(dialog),
    }) : null;
  }
  dispose() { this.sequence++; super.dispose(); }
}
