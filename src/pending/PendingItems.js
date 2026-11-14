import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';
import { pendingDialogView, pendingRowsView } from './pending-view.js';
import { renderPendingDialog } from './PendingDialog.js';

export class PendingItems extends FeatureState {
  constructor({ bridge, orders, getCatalog, getLanguage, getActor, canEdit, notify }) {
    super({ dialog: null });
    Object.assign(this, { bridge, orders, getCatalog, getLanguage, getActor, canEdit, notify });
    this.draftSequence = 0;
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  _canAct() { return !this.disposed && this.canEdit() && !this.orders.writeBusy() && !this.state.dialog?.saving; }
  _sameOrigin(target) {
    const state = this.orders.snapshot();
    return this.orders.isCurrent(target) && target.tableId === state.tableId && target.orderId === state.orders[target.tableId]?.id;
  }
  _open(dialog) {
    this._set({ dialog: { ...dialog, target: this.orders.captureTarget(), draftId: ++this.draftSequence } });
  }
  _sameDraft(dialog) { return !this.disposed && this.state.dialog?.draftId === dialog.draftId && this.orders.isCurrent(dialog.target); }
  dismiss() {
    if (this.state.dialog?.saving) return false;
    this._set({ dialog: null });
    return true;
  }
  reset() { this.draftSequence++; this._set({ dialog: null }); }
  async _request(action, value, target) {
    if (this.disposed || !this.canEdit() || this.orders.writeBusy()) {
      if (!this.disposed) this.notify(this.t('Please wait for the order to save.'), 'warn');
      return;
    }
    const lease = this.orders.acquireWrite(action, target);
    if (!lease) return;
    if (action === 'add') this.orders.markAddAttempted(lease);
    try {
      const result = await this.bridge.orderItems(action, lease.orderId, value);
      if (this.disposed || !this.orders.isCurrent(lease)) return;
      if (!result.ok) { this.notify(this.t('Could not save order items. Try again.'), 'err'); return false; }
      if (!this.orders.applyConfirmedItems(lease, result.data.items)) return;
      if (action === 'add') this.orders.markAddAttempted(lease);
      if ((action === 'remove' || action === 'decrement') && result.data.items.length === 0) await this.orders.refreshAvailability(lease);
      return result.data;
    } catch (_) {
      if (!this.disposed && this.orders.isCurrent(lease)) this.notify(this.t('Could not save order items. Try again.'), 'err');
    } finally { this.orders.releaseWrite(lease); }
  }
  addProduct(id) {
    if (!this._canAct()) return;
    const product = this.getCatalog().byId[id];
    if (!product) return;
    if (product.groups.length) { this._open({ type: 'mods', pid: id, sel: {} }); return; }
    const target = this.orders.captureTarget();
    if (this.bridge) return this._request('add', id, target);
    return this._addDemo(product, '', 0, target);
  }
  _addDemo(product, modifiers, delta, target) {
    if (!this._canAct() || !this._sameOrigin(target)) return false;
    // Opening or cancelling choices must not create a demo order. Create it
    // only after a valid add is submitted, then acquire its stable write lease.
    this.orders.ensureDemoOrder(target.tableId, this.getActor());
    const lease = this.orders.acquireWrite('add', this.orders.captureTarget(target.tableId));
    if (!lease) return false;
    try { this.orders.appendPending(target.tableId, product, modifiers, delta, this.getActor()); return true; }
    finally { this.orders.releaseWrite(lease); }
  }
  chooseModifier(groupId, index) {
    if (!this._canAct()) return;
    const dialog = this.state.dialog, catalog = this.getCatalog();
    if (dialog?.type !== 'mods' || !catalog.byId[dialog.pid]?.groups.includes(groupId)) return;
    const group = catalog.G[groupId];
    if (!group?.opts[index]) return;
    const sel = { ...dialog.sel };
    if (sel[groupId] === index && !group.req) delete sel[groupId]; else sel[groupId] = index;
    this._set({ dialog: { ...dialog, sel } });
  }
  async modAdd() {
    const dialog = this.state.dialog;
    if (!this._canAct() || dialog?.type !== 'mods' || !this._sameOrigin(dialog.target)) return;
    const catalog = this.getCatalog(), product = catalog.byId[dialog.pid];
    if (!product || product.groups.some(id => catalog.G[id].req && dialog.sel[id] == null)) return;
    const selected = product.groups.filter(id => dialog.sel[id] != null).map(id => catalog.G[id].opts[dialog.sel[id]]);
    if (selected.some(option => !option)) return;
    if (!this.bridge) {
      if (this._addDemo(product, selected.map(option => option[0]).join(' · '), selected.reduce((sum, option) => sum + option[1], 0), dialog.target)) this._set({ dialog: null });
      return;
    }
    this._set({ dialog: { ...dialog, saving: true } });
    const saved = await this._request('add', { productId: product.id, optionIds: selected.map(option => option[2]) }, dialog.target);
    if (this._sameDraft(dialog)) this._set({ dialog: saved ? null : { ...this.state.dialog, saving: false } });
  }
  _changeItem(action, id) {
    if (!this._canAct()) return;
    const state = this.orders.snapshot(), item = state.items.find(value => value.id === id && value.tableId === state.tableId && value.status === 'pending');
    if (!item) return;
    const target = this.orders.captureTarget();
    if (this.bridge) return this._request(action, id, target);
    const lease = this.orders.acquireWrite(action, target);
    if (!lease) return;
    try {
      if (action === 'remove') this.orders.removePending(id, this.getActor());
      else this.orders.changeQuantity(id, action === 'increment' ? 1 : -1, this.getActor());
    } finally { this.orders.releaseWrite(lease); }
  }
  incItem(id) { return this._changeItem('increment', id); }
  decItem(id) { return this._changeItem('decrement', id); }
  removeItem(id) { return this._changeItem('remove', id); }
  openNote(id) {
    if (!this._canAct()) return;
    const state = this.orders.snapshot(), item = state.items.find(value => value.id === id && value.tableId === state.tableId && value.status === 'pending');
    if (item) this._open({ type: 'note', itemId: id, text: item.note });
  }
  setNoteText(text) {
    if (this._canAct() && this.state.dialog?.type === 'note') this._set({ dialog: { ...this.state.dialog, text } });
  }
  toggleNoteChip(label) {
    if (!this._canAct() || this.state.dialog?.type !== 'note') return;
    const variants = ['en', 'sq'].map(language => waiterTranslate(language, 'waiter.' + label));
    const parts = this.state.dialog.text.split(',').map(part => part.trim()).filter(Boolean);
    this.setNoteText((parts.some(part => variants.includes(part)) ? parts.filter(part => !variants.includes(part)) : parts.concat(this.t(label))).join(', '));
  }
  async saveNote() {
    const dialog = this.state.dialog;
    if (!this._canAct() || dialog?.type !== 'note' || !this._sameOrigin(dialog.target)) return;
    const item = this.orders.snapshot().items.find(value => value.id === dialog.itemId && value.tableId === dialog.target.tableId && value.status === 'pending');
    if (!item) return;
    const lease = this.orders.acquireWrite('note', dialog.target);
    if (!lease) return;
    this._set({ dialog: { ...dialog, saving: true, error: '' } });
    try {
      if (!this.bridge) {
        this.orders.saveNote(dialog.itemId, dialog.text.trim(), this.getActor());
        this._set({ dialog: null });
        return;
      }
      const result = await this.bridge.orderItems('note', lease.orderId, { itemId: dialog.itemId, note: dialog.text.trim() });
      if (!this._sameDraft(dialog) || !this.orders.isCurrent(lease)) return;
      if (!result.ok) { this._set({ dialog: { ...this.state.dialog, saving: false, error: this.t('Could not save note. Try again.') } }); return; }
      this.orders.applyConfirmedItems(lease, result.data.items);
      this._set({ dialog: null });
    } catch (_) {
      if (this._sameDraft(dialog) && this.orders.isCurrent(lease)) this._set({ dialog: { ...this.state.dialog, saving: false, error: this.t('Could not save note. Try again.') } });
    } finally { this.orders.releaseWrite(lease); }
  }
  rowsView() { return pendingRowsView(this.orders.snapshot(), this); }
  view() { return pendingDialogView(this.state.dialog, this.getCatalog(), this.orders.snapshot(), this); }
  render() { return this.state.dialog ? renderPendingDialog(this.view()) : null; }
}
