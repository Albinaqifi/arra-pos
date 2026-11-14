import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';
import { moveView } from './move-view.js';
import { renderMoveDialog } from './MoveDialog.js';

export class MoveWorkflow extends FeatureState {
  constructor({ bridge, orders, getLanguage, getActor, isHandoffPending, canOpen, dismissOtherDialogs, notify, onDemoMoved, createRequestId }) {
    super({ dialog: null });
    Object.assign(this, { bridge, orders, getLanguage, getActor, isHandoffPending, canOpen, dismissOtherDialogs, notify, onDemoMoved, createRequestId });
    this.requests = new Map();
    this.draftSequence = 0;
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  get locked() { return !!(this.state.dialog?.saving || this.state.dialog?.unresolved); }
  _sameDraft(dialog) { return !this.disposed && this.state.dialog?.draftId === dialog.draftId && this.orders.isCurrent(dialog.target); }
  _sameOrigin(target) {
    const state = this.orders.snapshot();
    return this.orders.isCurrent(target) && state.tableId === target.tableId && state.orders[target.tableId]?.id === target.orderId;
  }
  _available(tableId, from) {
    const state = this.orders.snapshot(), destination = state.orders[tableId];
    return tableId !== from && state.sections.some(section => section.ids.includes(tableId)) && (!destination || (!!this.bridge && destination.untouched));
  }
  open() {
    if (this.disposed || this.locked || this.orders.writeBusy() || this.isHandoffPending() || !this.canOpen()) return;
    const target = this.orders.captureTarget();
    if (target.orderId == null || !this._sameOrigin(target) || !this.dismissOtherDialogs()) return;
    this._set({ dialog: { target, draftId: ++this.draftSequence, dest: null, saving: false, unresolved: false, error: '', request: null } });
  }
  chooseDestination(tableId) {
    const dialog = this.state.dialog;
    if (this.disposed || !dialog || this.locked || this.isHandoffPending() || !this._available(tableId, dialog.target.tableId)) return;
    this._set({ dialog: { ...dialog, dest: tableId, error: '' } });
  }
  dismiss() {
    if (this.locked) return false;
    this._set({ dialog: null });
    return true;
  }
  reset() { this.draftSequence++; this._set({ dialog: null }); }
  async confirm() {
    const dialog = this.state.dialog;
    if (this.disposed || !dialog || dialog.saving || this.isHandoffPending() || this.orders.writeBusy() || !this._sameOrigin(dialog.target)) return;
    const from = dialog.target.tableId, to = dialog.request?.to ?? dialog.dest;
    if (to == null || (!dialog.unresolved && !this._available(to, from))) return;
    const lease = this.orders.acquireWrite('move', dialog.target);
    if (!lease) return;
    if (!this.bridge) {
      try {
        if (!this.orders.moveDemoOrder(from, to, this.getActor())) return;
        this.onDemoMoved(from, to);
        this._set({ dialog: null });
        this.notify(this.t('Everything moved to Table {to}. Table {from} is free now.', { to, from }));
      } finally { this.orders.releaseWrite(lease); }
      return;
    }
    const key = [dialog.target.orderId, from, to].join(':');
    if (!this.requests.has(key)) this.requests.set(key, this.createRequestId());
    const request = dialog.request || Object.freeze({ ...dialog.target, from, to, token: this.requests.get(key) });
    this._set({ dialog: { ...dialog, request, saving: true, error: '' } });
    try {
      let result, reconciledTable;
      try { result = await this.bridge.moveOrder(request.orderId, request.from, request.to, request.token); } catch (_) { result = { ok: false }; }
      if (!this._sameDraft(dialog)) return;
      if (!result.ok) {
        let tables;
        try { tables = await this.bridge.getTables(); } catch (_) { tables = { ok: false }; }
        if (!this._sameDraft(dialog)) return;
        if (!tables?.ok || !Array.isArray(tables.data)) {
          this._set({ dialog: { ...this.state.dialog, saving: false, unresolved: true, error: this.t('Move status is unknown. Retry to check it before leaving.') } });
          return;
        }
        reconciledTable = tables.data.find(table => table.orderId === request.orderId);
        if (reconciledTable?.id !== request.to) {
          this.orders.reconcileOrderLocations(lease, tables.data);
          if (reconciledTable?.id === request.from) {
            this._set({ dialog: { ...this.state.dialog, saving: false, unresolved: false, dest: null, request: null, error: this.t('Order was not moved. Check the destination and try again.') } });
          } else {
            this._set({ dialog: null });
            this.orders.abandonChangedOrder(lease);
            this.notify(this.t('Order location changed. Select a table to continue.'), 'warn');
          }
          return;
        }
      }
      if (!this.orders.applyConfirmedMove(lease, request.to, reconciledTable ? reconciledTable.untouched === true : false)) return;
      this.requests.delete(key);
      this._set({ dialog: null });
      this.notify(this.t('Everything moved to Table {to}. Table {from} is free now.', { to: request.to, from: request.from }));
      if (!reconciledTable) await this.orders.refreshAvailability(lease);
    } finally { this.orders.releaseWrite(lease); }
  }
  buttonView() {
    const state = this.orders.snapshot(), available = !!state.orders[state.tableId];
    return {
      moveDisabled: !available,
      moveStyle: 'flex:1; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:800; ' + (available ? 'border:2px solid #C4B5FD; background:#F5F3FF; color:#5B21B6' : 'border:2px solid #E2E8F0; background:#F8FAFC; color:#64748B'),
      openMoveTable: () => this.open(),
    };
  }
  view() { return moveView(this.state.dialog, this.orders.snapshot(), this); }
  render() { return this.state.dialog ? renderMoveDialog(this.view()) : null; }
}
