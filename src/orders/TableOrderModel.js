import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';
import { normalizeItems, tableSnapshot } from './order-snapshots.js';
import { tableView } from './table-view.js';

export class TableOrderModel extends FeatureState {
  constructor({ bridge, demoOrders, nextId, canNavigate = () => true, notify = () => {}, getLanguage = () => 'en', onOrderOpened = () => {}, onDismiss = () => {} }) {
    super({ screen: 'tables', sections: [], orders: {}, items: [], tableId: null, tab: 'order', tableLoad: bridge ? 'loading' : 'ready', ...(!bridge ? demoOrders : {}), activity: null });
    Object.assign(this, { bridge, nextId, canNavigate, notify, getLanguage, onOrderOpened, onDismiss });
    this.generation = 0;
    this.loadGeneration = 0;
    this.openingRequest = null;
    this.writeLease = null;
    this.demoOrderSequence = 0;
  }
  get opening() { return !!this.openingRequest; }
  get writeBusy() { return !!this.writeLease; }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  captureTarget(tableId = this.state.tableId) {
    return Object.freeze({ generation: this.generation, tableId, orderId: this.state.orders[tableId]?.id });
  }
  isCurrent(target) { return !this.disposed && target?.generation === this.generation; }
  tableForOrder(target) {
    if (!this.isCurrent(target) || target.orderId == null) return null;
    const entry = Object.entries(this.state.orders).find(([, order]) => order.id === target.orderId);
    return entry ? Number(entry[0]) : null;
  }
  acquireWrite(kind, target = this.captureTarget()) {
    if (this.opening || this.writeBusy || this.tableForOrder(target) === null) return null;
    const lease = Object.freeze({ ...target, kind });
    this.writeLease = lease;
    this._set({ activity: kind });
    return lease;
  }
  releaseWrite(lease) {
    if (this.writeLease !== lease) return;
    this.writeLease = null;
    this._set({ activity: null });
  }
  clearProtectedData() {
    this.generation++;
    this.loadGeneration++;
    this.openingRequest = null;
    this.writeLease = null;
    if (this.bridge) this._set({ sections: [], orders: {}, items: [], tableId: null, tableLoad: 'loading', activity: null });
  }
  dismissSelectedOrder() {
    this.generation++;
    this.openingRequest = null;
    this.writeLease = null;
    this._set({ tableId: null, screen: 'tables', activity: null });
    this.onDismiss();
  }
  async loadTables() {
    if (!this.bridge || this.disposed) return;
    const target = this.captureTarget(), load = ++this.loadGeneration;
    this._set({ tableLoad: 'loading' });
    try {
      const result = await this.bridge.getTables();
      if (!this.isCurrent(target) || load !== this.loadGeneration) return;
      if (!result.ok) throw Error('Unavailable');
      this._set({ ...tableSnapshot(result.data), tableLoad: 'ready' });
    } catch (_) {
      if (this.isCurrent(target) && load === this.loadGeneration) {
        this._set({ tableLoad: 'error', sections: [], orders: {}, items: [], tableId: null });
        this.onDismiss();
      }
    }
  }
  async openTable(tableId) {
    if (this.disposed || this.opening || this.writeBusy || !this.canNavigate()) return;
    if (!this.bridge) { this._set({ tableId, screen: 'order', tab: 'order' }); this.onOrderOpened(); return; }
    const opening = this.captureTarget(tableId);
    this.openingRequest = opening;
    try {
      const result = await this.bridge.openOrder(tableId);
      if (!this.isCurrent(opening)) return;
      if (!result.ok) { this.notify(this.t('Could not open table. Try again.'), 'err'); return; }
      const old = this.state.orders[tableId];
      this._set({ orders: { ...this.state.orders, [tableId]: { id: result.data.id, openedAt: result.data.openedAt, openedBy: '', rounds: old?.rounds || 0, log: old?.log || [], untouched: result.data.untouched === true, itemsLoaded: old?.id === result.data.id && !!old.itemsLoaded } } });
      const target = this.captureTarget(tableId);
      const resultItems = await this.bridge.orderItems('list', target.orderId);
      if (!this.isCurrent(target) || this.tableForOrder(target) !== tableId) return;
      if (!resultItems.ok) { this.notify(this.t('Could not load order items. Try again.'), 'err'); return; }
      this.applyConfirmedItems(target, resultItems.data.items);
      this._set({ tableId, screen: 'order', tab: 'order' });
      this.onOrderOpened();
    } catch (_) { if (this.isCurrent(opening)) this.notify(this.t('Could not open table. Try again.'), 'err'); }
    finally { if (this.openingRequest === opening) this.openingRequest = null; }
  }
  showTables() {
    if (this.disposed || this.writeBusy || this.opening || !this.canNavigate()) return;
    const { tableId, screen, items } = this.state;
    if (screen === 'order') {
      const count = items.filter(item => item.tableId === tableId && item.status === 'pending').reduce((sum, item) => sum + item.qty, 0);
      if (count) this.notify(this.t(count === 1 ? 'Table {id} still has {count} item not sent to the kitchen or bar.' : 'Table {id} still has {count} items not sent to the kitchen or bar.', { id: tableId, count }), 'warn');
    }
    this._set({ screen: 'tables' });
    this.onDismiss();
  }
  showHistory() {
    if (this.disposed || this.writeBusy || this.opening || !this.canNavigate()) return;
    this._set({ screen: 'history' });
    this.onDismiss();
  }
  selectTab(tab) { if (['order', 'activity'].includes(tab)) this._set({ tab }); }
  applyConfirmedItems(target, items) {
    const tableId = this.tableForOrder(target);
    if (tableId === null) return false;
    this._set({ items: this.state.items.filter(item => item.tableId !== tableId).concat(normalizeItems(tableId, items)), orders: { ...this.state.orders, [tableId]: { ...this.state.orders[tableId], itemsLoaded: true } } });
    return true;
  }
  markAddAttempted(target) { this.setUntouched(target, false); }
  setUntouched(target, untouched) {
    const tableId = this.tableForOrder(target);
    if (tableId !== null) this._set({ orders: { ...this.state.orders, [tableId]: { ...this.state.orders[tableId], untouched } } });
  }
  async refreshAvailability(target) {
    let result;
    try { result = await this.bridge.getTables(); } catch (_) { return; }
    const tableId = this.tableForOrder(target);
    if (tableId === null) return;
    const table = result?.ok && Array.isArray(result.data) ? result.data.find(row => row.id === tableId && row.orderId === target.orderId) : null;
    if (table) this.setUntouched(target, table.untouched === true);
  }
  reconcileOrderLocations(target, tables) {
    if (!this.isCurrent(target)) return false;
    const { orders } = tableSnapshot(tables, this.state.orders);
    this._set({ orders });
    return true;
  }
  applyConfirmedMove(target, destination, untouched = false) {
    const from = this.tableForOrder(target);
    if (from === null) return false;
    const orders = { ...this.state.orders, [destination]: { ...this.state.orders[from], untouched } };
    if (from !== destination) delete orders[from];
    this._set({ orders, items: this.state.items.map(item => item.tableId === from ? { ...item, tableId: destination } : item), tableId: destination });
    return true;
  }
  abandonChangedOrder(target) {
    if (!this.isCurrent(target)) return;
    this._set({ screen: 'tables', tableId: null, items: [] });
    this.onDismiss();
  }
  tableView(options) { return tableView(this.state, { ...options, desktop: !!this.bridge, openTable: id => this.openTable(id) }); }

  // Demo-only record changes; dialogs, retry policy, printing and payment stay
  // with their workflow owners. These commands never call the desktop bridge.
  ensureDemoOrder(tableId, actor, at = Date.now()) {
    if (this.bridge || this.disposed) return;
    if (!this.state.orders[tableId]) this._set({ orders: { ...this.state.orders, [tableId]: { id: 'demo-order-' + tableId + '-' + ++this.demoOrderSequence, openedAt: at, openedBy: actor, rounds: 0, log: [{ t: at, who: actor, text: 'Opened table' }] } } });
  }
  appendActivity(tableId, text, actor, at = Date.now()) {
    const order = this.state.orders[tableId];
    if (!order || this.bridge) return;
    this._set({ orders: { ...this.state.orders, [tableId]: { ...order, log: order.log.concat({ t: at, who: actor, text }) } } });
  }
  appendPending(tableId, product, mods, delta, actor) {
    if (this.bridge || this.disposed) return;
    this.ensureDemoOrder(tableId, actor);
    const same = this.state.items.find(item => item.tableId === tableId && item.status === 'pending' && item.pid === product.id && item.mods === mods && !item.note);
    const items = same ? this.state.items.map(item => item === same ? { ...item, qty: item.qty + 1 } : item) : this.state.items.concat({ id: this.nextId('i'), tableId, pid: product.id, name: product.name, unit: product.price + delta, qty: 1, mods, note: '', route: product.route, status: 'pending', round: 0, cxQty: 0, cx: [] });
    this._set({ items });
    this.appendActivity(tableId, 'Added ' + product.name + (mods ? ' (' + mods + ')' : ''), actor);
  }
  changeQuantity(id, delta, actor) {
    if (this.bridge || this.disposed || ![-1, 1].includes(delta)) return;
    const item = this.state.items.find(value => value.id === id && value.status === 'pending');
    if (!item) return;
    if (item.qty + delta <= 0) return this.removePending(id, actor);
    this._set({ items: this.state.items.map(value => value === item ? { ...item, qty: item.qty + delta } : value) });
  }
  removePending(id, actor) {
    if (this.bridge || this.disposed) return;
    const item = this.state.items.find(value => value.id === id && value.status === 'pending');
    if (!item) return;
    const items = this.state.items.filter(value => value !== item);
    this._set({ items });
    this.appendActivity(item.tableId, 'Removed ' + item.name + ' (was not sent yet)', actor);
    if (this.state.orders[item.tableId]?.rounds === 0 && !items.some(value => value.tableId === item.tableId)) {
      const orders = { ...this.state.orders }; delete orders[item.tableId]; this._set({ orders });
    }
  }
  saveNote(id, note, actor) {
    if (this.bridge || this.disposed) return;
    const item = this.state.items.find(value => value.id === id);
    if (!item) return;
    this._set({ items: this.state.items.map(value => value === item ? { ...item, note } : value) });
    this.appendActivity(item.tableId, note ? 'Note added to ' + item.name : 'Removed note from ' + item.name, actor);
  }
  markPendingSent(tableId, actor, at = Date.now()) {
    if (this.bridge || this.disposed) return null;
    const order = this.state.orders[tableId], pending = this.state.items.filter(item => item.tableId === tableId && item.status === 'pending');
    if (!order || !pending.length) return null;
    const round = order.rounds + 1;
    const sent = pending.map(item => ({ ...item, status: 'sent', round, sentAt: at, sentBy: actor }));
    this._set({ orders: { ...this.state.orders, [tableId]: { ...order, rounds: round } }, items: this.state.items.map(item => sent.find(value => value.id === item.id) || item) });
    return { round, items: sent };
  }
  applyDemoCorrection(id, quantity, reason, actor, at = Date.now()) {
    if (this.bridge || this.disposed) return;
    const item = this.state.items.find(value => value.id === id);
    if (!item) return;
    const qty = Math.min(quantity, item.qty - item.cxQty), cxQty = item.cxQty + qty;
    this._set({ items: this.state.items.map(value => value === item ? { ...item, cxQty, cx: item.cx.concat({ qty, reason, who: actor, t: at }), status: cxQty >= item.qty ? 'cancelled' : item.status } : value) });
    this.appendActivity(item.tableId, 'Cancelled ' + qty + '× ' + item.name + '. Reason: ' + reason + '.', actor, at);
  }
  moveDemoOrder(from, to, actor) {
    if (this.bridge || this.disposed || to == null || to === from || this.state.orders[to] || !this.state.orders[from]) return false;
    this.applyConfirmedMove(this.captureTarget(from), to);
    this.appendActivity(to, 'Moved the whole order from Table ' + from + ' to Table ' + to, actor);
    return true;
  }
  completeDemoOrder(tableId) {
    if (this.bridge || this.disposed) return;
    const orders = { ...this.state.orders }; delete orders[tableId];
    this._set({ orders, items: this.state.items.filter(item => item.tableId !== tableId), screen: 'tables', tableId: null });
  }
  dispose() { this.generation++; this.openingRequest = null; this.writeLease = null; super.dispose(); }
}
