import * as ArraComponents from './admin/index.js';
import { desktopBridge } from './shared/desktop-bridge.js';
import { waiterTranslate, style } from './shared/waiter-ui.js';
import { renderTables } from './waiter/Tables.js';
import { renderOrder } from './waiter/Order.js';
import { renderMoveTable } from './waiter/MoveTable.js';
import { renderBill } from './waiter/Bill.js';
import { DesktopBill } from './waiter/DesktopBill.js';
import { PrintingSession } from './printing/PrintingSession.js';
import { PrintJobs } from './printing/PrintJobs.js';
import { TestPrintJobs } from './printing/TestPrintJobs.js';
import { SessionModel } from './session/SessionModel.js';
import { renderAccountEntry } from './session/AccountEntry.js';
import { demoStaff } from './session/demo-staff.js';
import { LanguageSettings } from './settings/LanguageSettings.js';
import { AdminWorkspace } from './admin/AdminWorkspace.js';
import { CatalogModel } from './catalog/CatalogModel.js';
import { TableOrderModel } from './orders/TableOrderModel.js';
import { demoCatalog } from './demo/catalog.js';
import { demoOrders } from './demo/orders.js';
import { demoSequence } from './demo/sequence.js';
import { PendingItems } from './pending/PendingItems.js';
import { ModalFrame, modalCardStyle } from './shared/ModalFrame.js';

export class WaiterDemo extends React.Component {
  constructor(...a) {
    super(...a);
    this.nextDemoId = demoSequence();
    this.printing = new PrintingSession({ bridge: desktopBridge });
    this.state = this.seed();
    this.settings = new LanguageSettings({ bridge: desktopBridge });
    const catalog = desktopBridge ? undefined : demoCatalog();
    this.catalog = new CatalogModel({ bridge: desktopBridge, demoCatalog: catalog });
    this.tableOrders = new TableOrderModel({
      bridge: desktopBridge, demoOrders: desktopBridge ? undefined : demoOrders(catalog, this.nextDemoId), nextId: this.nextDemoId,
      canNavigate: () => !this._handoffInProgress && !this.state.modal?.unresolved,
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      getLanguage: () => this.settings.state.language,
      onOrderOpened: () => this.catalog.clearSearch(),
      onDismiss: () => { this.pending?.dismiss(); this.setState({ modal: null }); },
    });
    this.pending = new PendingItems({
      bridge: desktopBridge,
      getCatalog: () => this.catalog.state, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canEdit: () => !this._handoffInProgress && !this.state.modal,
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      orders: {
        snapshot: () => this.tableOrders.state, writeBusy: () => this.tableOrders.writeBusy,
        captureTarget: tableId => this.tableOrders.captureTarget(tableId), isCurrent: target => this.tableOrders.isCurrent(target),
        acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
        markAddAttempted: target => this.tableOrders.markAddAttempted(target), applyConfirmedItems: (target, items) => this.tableOrders.applyConfirmedItems(target, items),
        refreshAvailability: target => this.tableOrders.refreshAvailability(target), ensureDemoOrder: (tableId, actor) => this.tableOrders.ensureDemoOrder(tableId, actor),
        appendPending: (tableId, product, modifiers, delta, actor) => this.tableOrders.appendPending(tableId, product, modifiers, delta, actor),
        changeQuantity: (id, delta, actor) => this.tableOrders.changeQuantity(id, delta, actor), removePending: (id, actor) => this.tableOrders.removePending(id, actor),
        saveNote: (id, note, actor) => this.tableOrders.saveNote(id, note, actor),
      },
    });
    this.administration = new AdminWorkspace({ signOut: () => this.session.signOut(), refreshAccess: generation => this.session.refreshAdminAccess(generation) });
    this.session = new SessionModel({
      bridge: desktopBridge,
      canLeave: ({ afterAction }) => !this.tableOrders.opening && !this.tableOrders.writeBusy && (!this._handoffInProgress || afterAction) && !this.state.modal?.unresolved && this.administration.canLeave(),
      clearProtectedData: () => this.clearDesktopData(),
      dismissSelectedOrder: () => this.tableOrders.dismissSelectedOrder(),
      loadProtectedData: () => this.loadDesktopData(),
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      getLanguage: () => this.settings.state.language,
      getDemoStaff: demoStaff,
    });
    const refresh = () => { if (this._mounted) this.forceUpdate?.(); };
    this._subscriptions = [this.session.subscribe(() => { this.administration.setIdentity(this.session.identity()); refresh(); }), this.settings.subscribe(refresh), this.administration.subscribe(refresh), this.catalog.subscribe(refresh), this.tableOrders.subscribe(refresh), this.pending.subscribe(refresh)];
  }
  componentDidMount() {
    this._mounted = true;
    this.settings.load();
    this._tick = setInterval(() => this.forceUpdate(), 20000);
  }
  clearDesktopData() {
    this.catalog.clearProtectedData();
    this.tableOrders.clearProtectedData();
    this.pending.reset();
    this.setState({ modal: null });
  }
  loadDesktopData() { return Promise.all([this.catalog.load(), this.tableOrders.loadTables()]); }
  componentWillUnmount() {
    this._mounted = false;
    this._subscriptions.forEach(unsubscribe => unsubscribe());
    this.session.dispose(); this.settings.dispose(); this.administration.dispose(); this.printing.dispose(); this.catalog.dispose(); this.tableOrders.dispose(); this.pending.dispose();
    clearInterval(this._tick); clearTimeout(this._tt);
  }


  seed() {
    const now = Date.now(), m = 60000;
    const st = { modal: null, toast: null, printers: { kitchen: true, bar: true, A: true, B: true }, jobs: [], history: [], billNo: 1045 };
    st.history = [
      { no: 1044, table: 'Table 1', closedAt: now - 45 * m, waiter: 'Marko', method: 'Card', account: 'A', total: 2310, count: 9 },
      { no: 1043, table: 'Table 14', closedAt: now - 80 * m, waiter: 'Dita', method: 'Cash', account: 'B', total: 620, count: 4 },
      { no: 1042, table: 'Table 6', closedAt: now - 110 * m, waiter: 'Arta', method: 'Cash', account: 'A', total: 940, count: 5 },
      { no: 1041, table: 'Table 2', closedAt: now - 150 * m, waiter: 'Besnik', method: 'Card', account: 'A', total: 1860, count: 7 }
    ];
    if (desktopBridge) st.history = [];
    return st;
  }
  fmt(v) { return Math.round(v).toLocaleString('en-US') + ' den'; }
  who() { return this.session.state.waiter?.name || ''; }
  mut(fn, callback) { this.setState(s => { const n = JSON.parse(JSON.stringify(s)); fn(n); return n; }, callback); }
  toast(n, msg, kind) {
    n.toast = { msg, kind: kind || 'ok' };
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.setState({ toast: null }), 4200);
  }
  log(tableId, text) { this.tableOrders.appendActivity(tableId, text, this.who()); }

  rlabel(k) { return k === 'bar' ? 'Bar' : 'Kitchen'; }



  togglePrinter(k) {
    const names = { kitchen: 'Kitchen', bar: 'Bar', A: 'Bill A', B: 'Bill B' };
    this.mut(n => {
      n.printers[k] = !n.printers[k];
      this.toast(n, 'Demo: ' + names[k] + ' printer is now ' + (n.printers[k] ? 'online.' : 'offline.'), n.printers[k] ? 'ok' : 'warn');
    });
  }

  // ---------- order entry ----------

  async submitSend(value) {
    if (this.tableOrders.writeBusy) { this.mut(n => this.toast(n, waiterTranslate(this.settings.state.language, "waiter.Please wait for the order to save."), 'warn')); return; }
    const target = this.tableOrders.captureTarget();
    const lease = this.tableOrders.acquireWrite('send', target);
    if (!lease) return;
    try {
      const result = await desktopBridge.orderItems('send', lease.orderId, value);
      if (!this._mounted || !this.tableOrders.isCurrent(lease)) return;
      if (!result.ok) { this.mut(n => this.toast(n, waiterTranslate(this.settings.state.language, "waiter.Could not save order items. Try again."), 'err')); return false; }
      if (!this.tableOrders.applyConfirmedItems(lease, result.data.items)) return;
      return result.data;
    } catch (_) { if (this._mounted && this.tableOrders.isCurrent(lease)) this.mut(n => this.toast(n, waiterTranslate(this.settings.state.language, "waiter.Could not save order items. Try again."), 'err')); }
    finally { this.tableOrders.releaseWrite(lease); }
  }
  send() {
    if (desktopBridge) {
      if (this.tableOrders.writeBusy || this._handoffInProgress) return;
      const target = this.tableOrders.captureTarget(), { tableId, orderId } = target;
      if (!orderId) return;
      this._handoffInProgress = true;
      this._sendRequests = this._sendRequests || {};
      const token = this._sendRequests[orderId] || (this._sendRequests[orderId] = crypto.randomUUID());
      return this.submitSend(token).then(async data => {
        if (!data) return;
        delete this._sendRequests[orderId];
        this.printing.jobsChanged();
        const pending = data.items.some(i => i.status === 'pending');
        const printNotice = await this.printing.handoffNotice(this.settings.state.language);
        if (!this._mounted || !this.tableOrders.isCurrent(target)) return;
        const physicalNotice = data.testPrintEnabled ? waiterTranslate(this.settings.state.language, "waiter.Test print output is not confirmed. Check the printer and paper.") : waiterTranslate(this.settings.state.language, "waiter.No physical ticket was printed.");
        const notice = [pending ? waiterTranslate(this.settings.state.language, 'waiter.Table {id} has new items still pending. Select a waiter, reopen the table and send again.', {id:tableId}) : '', printNotice, physicalNotice].filter(Boolean).join(' ');
        await this.session.completeHandoff(notice);
      }).finally(() => { this._handoffInProgress = false; });
    }
    const tid = this.tableOrders.state.tableId;
    const sent = this.tableOrders.markPendingSent(tid, this.who());
    if (!sent) return;
    const pend = sent.items, r = sent.round, jobs = [], parts = [], bad = [], displayParts = [];
    ['kitchen', 'bar'].forEach(k => {
      const items = pend.filter(item => item.route === k); if (!items.length) return;
      const count = items.reduce((sum, item) => sum + item.qty, 0), ok = this.state.printers[k];
      jobs.push({ id: this.nextDemoId('j'), tableId: tid, round: r, printer: k, count, status: ok ? 'ok' : 'failed', attempts: 1 });
      parts.push(this.rlabel(k) + ' got ' + count + (count === 1 ? ' item' : ' items'));
      displayParts.push(waiterTranslate(this.settings.state.language, count === 1 ? 'waiter.{destination} got {count} item' : 'waiter.{destination} got {count} items', {destination:waiterTranslate(this.settings.state.language, 'waiter.' + this.rlabel(k)), count}));
      if (!ok) bad.push(this.rlabel(k));
    });
    this.log(tid, 'Sent round ' + r + ': ' + parts.join(', ') + (bad.length ? ' (' + bad.join(' and ') + ' ticket did not print)' : ''));
    const notice = bad.length
      ? waiterTranslate(this.settings.state.language, 'waiter.Round {round} is saved, but the {destinations} ticket did not print. Select a waiter to retry using the red bar.', {round:r,destinations:bad.map(value => waiterTranslate(this.settings.state.language, 'waiter.' + value)).join(this.settings.state.language === 'sq' ? ' dhe ' : ' and ')})
      : waiterTranslate(this.settings.state.language, 'waiter.Round {round} sent. {details}.', {round:r,details:displayParts.join(', ')});
    this.mut(n => { n.jobs.push(...jobs); }, () => this.session.switchWaiter(notice));
  }
  retryJob(id) {
    const job = this.state.jobs.find(value => value.id === id); if (!job) return;
    const destination = this.rlabel(job.printer), ok = this.state.printers[job.printer];
    this.log(job.tableId, ok ? 'Reprinted ' + destination + ' ticket for round ' + job.round + ' (same items, nothing added twice)' : 'Retry of ' + destination + ' ticket failed');
    this.mut(n => {
      const current = n.jobs.find(value => value.id === id); if (!current) return;
      current.attempts++;
      if (ok) {
        current.status = 'ok';
        this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.{destination} ticket printed. Nothing was added to the order twice.', {destination:waiterTranslate(this.settings.state.language, 'waiter.' + destination)}));
      } else this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.{destination} printer is still not responding. Try the backup printer.', {destination:waiterTranslate(this.settings.state.language, 'waiter.' + destination)}), 'err');
    });
  }
  backupJob(id) {
    const job = this.state.jobs.find(value => value.id === id); if (!job) return;
    const destination = this.rlabel(job.printer);
    this.log(job.tableId, 'Printed ' + destination + ' ticket for round ' + job.round + ' on the backup printer');
    this.mut(n => {
      const current = n.jobs.find(value => value.id === id); if (!current) return;
      current.status = 'ok'; current.attempts++;
      this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.{destination} ticket printed on the backup printer.', {destination:waiterTranslate(this.settings.state.language, 'waiter.' + destination)}));
    });
  }
  openCancel(id) { if (this._handoffInProgress || !this.pending.dismiss()) return; this.mut(n => { n.modal = { type: 'cancel', itemId: id, qty: 1, reason: '', other: '' }; }); }
  async confirmCancel() {
    if (desktopBridge) {
      const m = this.state.modal;
      if (!m || !m.reason || (m.reason === 'Other' && !m.other.trim())) return;
      const lease = this.tableOrders.acquireWrite('correct');
      if (!lease) return;
      const reason = m.reason === 'Other' ? m.other.trim() : m.reason;
      const requestId = m.requestId || crypto.randomUUID();
      this.mut(n => { n.modal.requestId = requestId; n.modal.saving = true; n.modal.error = ''; });
      try {
        const result = await desktopBridge.orderItems('correct', lease.orderId, { itemId: m.itemId, quantity: m.qty, reason, requestId });
        if (!this._mounted || !this.tableOrders.isCurrent(lease)) return;
        if (result.ok) await this.tableOrders.refreshAvailability(lease);
        if (!this._mounted || !this.tableOrders.isCurrent(lease)) return;
        if (result.ok) this.tableOrders.applyConfirmedItems(lease, result.data.items);
        this.mut(n => {
          if (result.ok) { n.modal = null; this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.Correction saved. Tell preparation staff in person.')); }
          else if (result.rejected && !n.modal.unresolved) { n.modal.saving = false; n.modal.unresolved = false; n.modal.requestId = null; const messages = { access_denied:'waiter.Correction denied. Sign in as a waiter with order access.', already_billed:'waiter.This order has already been billed. The item cannot be cancelled here.', unavailable:'waiter.The order or item is unavailable, or the remaining quantity changed. Return to the order and check it.', invalid_input:'waiter.Correction details are invalid. Check the quantity and explanation.' }; n.modal.error = waiterTranslate(this.settings.state.language, messages[result.code] || 'waiter.Correction rejected. Check authorization and quantity.'); }
          else { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = waiterTranslate(this.settings.state.language, "waiter.Correction status unknown. Retry before leaving."); }
        });
      } catch (_) { if (this._mounted && this.tableOrders.isCurrent(lease)) this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = waiterTranslate(this.settings.state.language, "waiter.Correction status unknown. Retry before leaving."); }); }
      finally { this.tableOrders.releaseWrite(lease); }
      return;
    }
    const m = this.state.modal;
    const item = this.tableOrders.state.items.find(value => value.id === m.itemId);
    if (!item || !m.reason || (m.reason === 'Other' && !m.other.trim())) return;
    this.tableOrders.applyDemoCorrection(m.itemId, m.qty, m.reason === 'Other' ? m.other.trim() : m.reason, this.who());
    this.mut(n => { this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.Correction saved. Tell preparation staff in person.')); n.modal = null; });
  }
  async confirmMoveTable() {
    if (desktopBridge) {
      if (this._handoffInProgress || this.state.modal?.saving) return;
      const target = this.tableOrders.captureTarget(), from = target.tableId, orderId = target.orderId, to = this.state.modal?.dest;
      const destination = this.tableOrders.state.orders[to];
      if (!orderId || !to || to === from || (destination && !destination.untouched)) return;
      const lease = this.tableOrders.acquireWrite('move', target);
      if (!lease) return;
      this._moveRequests = this._moveRequests || {};
      const key = [orderId, from, to].join(':');
      const token = this._moveRequests[key] || (this._moveRequests[key] = crypto.randomUUID());
      this.mut(n => { n.modal.saving = true; n.modal.error = ''; });
      try {
        let result, reconciledTable;
        try { result = await desktopBridge.moveOrder(orderId, from, to, token); } catch (_) { result = { ok: false }; }
        if (!this._mounted || !this.tableOrders.isCurrent(lease)) return;
        if (!result.ok) {
          let tables;
          try { tables = await desktopBridge.getTables(); } catch (_) { tables = { ok: false }; }
          if (!this._mounted || !this.tableOrders.isCurrent(lease)) return;
          if (!tables?.ok || !Array.isArray(tables.data)) {
            this.mut(n => { n.modal.saving = false; n.modal.unresolved = true; n.modal.error = waiterTranslate(this.settings.state.language, "waiter.Move status is unknown. Retry to check it before leaving."); });
            return;
          }
          const current = tables.data.find(table => table.orderId === orderId);
          reconciledTable = current;
          if (current?.id !== to) {
            this.tableOrders.reconcileOrderLocations(lease, tables.data);
            if (current?.id === from) {
              this.mut(n => { n.modal.saving = false; n.modal.unresolved = false; n.modal.dest = null; n.modal.error = waiterTranslate(this.settings.state.language, "waiter.Order was not moved. Check the destination and try again."); });
            } else {
              this.tableOrders.abandonChangedOrder(lease);
              this.mut(n => this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.Order location changed. Select a table to continue.'), 'warn'));
            }
            return;
          }
        }
        delete this._moveRequests[key];
        this.tableOrders.applyConfirmedMove(lease, to, reconciledTable ? reconciledTable.untouched === true : false);
        this.mut(n => { n.modal = null; this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.Everything moved to Table {to}. Table {from} is free now.', {to, from})); });
        if (!reconciledTable) await this.tableOrders.refreshAvailability(lease);
      } finally { this.tableOrders.releaseWrite(lease); }
      return;
    }
    const from = this.tableOrders.state.tableId, to = this.state.modal.dest;
    if (!this.tableOrders.moveDemoOrder(from, to, this.who())) return;
    this.mut(n => {
      n.jobs.forEach(job => { if (job.tableId === from) job.tableId = to; });
      this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.Everything moved to Table {to}. Table {from} is free now.', {to, from}));
      n.modal = null;
    });
  }
  bSet(fn) { this.mut(n => { if (n.modal && n.modal.type === 'bill') fn(n.modal, n); }); }
  printBill(useBackup) {
    const bill = this.state.modal;
    if (!bill || bill.type !== 'bill') return;
    const account = bill.method === 'Card' ? 'A' : bill.account;
    const failed = !useBackup && !this.state.printers[account];
    const where = 'Printer ' + account + (useBackup ? ' (backup)' : '');
    this.log(this.tableOrders.state.tableId, failed
      ? 'Bill did not print on Printer ' + account + '. No payment recorded'
      : bill.printed > 0 ? 'Reprinted the bill on ' + where + ' (no new payment)' : 'Printed bill on ' + where + ': ' + bill.method + ', Account ' + account);
    this.mut(n => {
      const current = n.modal;
      current.account = account;
      if (failed) { current.step = 'failed'; return; }
      current.printed++; current.backup = !!useBackup; current.step = 'printed';
      if (current.printed > 1) this.toast(n, waiterTranslate(this.settings.state.language, "waiter.Bill reprinted. Still one payment."));
    });
  }
  paid() {
    if (desktopBridge) { this.mut(n => this.toast(n, waiterTranslate(this.settings.state.language, "waiter.Closing orders is not available yet."), 'warn')); return; }
    const bill = this.state.modal, tid = this.tableOrders.state.tableId;
    if (!bill || !bill.printed || tid == null || !this.tableOrders.state.orders[tid]) return;
    if (bill.method === 'Card' && bill.account !== 'A') { this.mut(n => this.toast(n, waiterTranslate(this.settings.state.language, "waiter.Blocked: card payments can only go to Account A."), 'err')); return; }
    const items = this.tableOrders.state.items.filter(item => item.tableId === tid);
    const total = items.reduce((sum, item) => sum + (item.qty - item.cxQty) * item.unit, 0);
    const count = items.reduce((sum, item) => sum + (item.qty - item.cxQty), 0);
    const at = Date.now(), actor = this.who();
    this.tableOrders.completeDemoOrder(tid);
    this.mut(n => {
      n.history.unshift({ no: n.billNo++, table: 'Table ' + tid, closedAt: at, waiter: actor, method: bill.method, account: bill.account, total, count });
      n.jobs = n.jobs.filter(job => job.tableId !== tid);
      n.modal = null;
      this.toast(n, waiterTranslate(this.settings.state.language, 'waiter.Table {id} is free. Payment saved once: {method}, Account {account}, {total}.', {id:tid,method:waiterTranslate(this.settings.state.language, 'waiter.' + bill.method),account:bill.account,total:this.fmt(total)}));
    }, () => this.session.switchWaiter());
  }
  renderVals() {
    const s = this.state, d = this.tableOrders.state, M = this.catalog.state, now = Date.now();
    const money = x => this.fmt(x);
    const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const bq = i => i.qty - i.cxQty;
    const av = (c, z) => 'width:' + z + 'px; height:' + z + 'px; border-radius:999px; background:' + c + '; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:' + Math.round(z * 0.42) + 'px; flex:none';
    const scr = d.screen;
    const v = {};
    const t = (key, values) => waiterTranslate(this.settings.state.language, 'waiter.' + key, values);
    v.t = t;


    v.isApp = this.session.state.screen === 'waiter';
    v.isTables = scr === 'tables'; v.isOrder = scr === 'order'; v.isHistory = scr === 'history';

    // top bar
    const w = this.session.state.waiter || { name: '', color: '#475569' };
    v.canAdmin = this.session.state.adminAccess; v.openAdmin = () => this.session.openAdministration();
    v.waiterName = w.name; v.waiterInitial = w.name ? w.name[0] : ''; v.waiterAv = av(w.color, 44);
    v.clock = hm(now);
    const tab = on => 'height:48px; padding:0 18px; border-radius:12px; border:none; font-size:17px; font-weight:800; background:' + (on ? '#0F172A' : 'transparent') + '; color:' + (on ? '#FFFFFF' : '#334155');
    v.tabTablesStyle = tab(scr !== 'history'); v.tabHistoryStyle = tab(scr === 'history');
    v.goTables = () => this.tableOrders.showTables();
    v.goHistory = () => this.tableOrders.showHistory();
    v.switchWaiter = () => this.session.switchWaiter();
    v.printers = [['kitchen', 'Kitchen'], ['bar', 'Bar'], ['A', 'Bill A'], ['B', 'Bill B']].map(([k, l]) => {
      const on = s.printers[k];
      return {
        label: l, state: on ? '' : ' offline',
        aria: l + ' printer ' + (on ? 'online' : 'offline') + '. Demo: click to switch',
        style: 'height:44px; padding:0 14px; border-radius:999px; font-size:15px; font-weight:800; display:inline-flex; align-items:center; gap:8px; border:2px solid ' + (on ? '#BBF7D0' : '#DC2626') + '; background:' + (on ? '#F0FDF4' : '#FEF2F2') + '; color:' + (on ? '#14532D' : '#991B1B'),
        dot: 'width:11px; height:11px; border-radius:999px; background:' + (on ? '#16A34A' : '#DC2626'),
        toggle: () => this.togglePrinter(k)
      };
    });

    // failed print jobs
    const failed = s.jobs.filter(j => j.status === 'failed');
    v.hasFailed = failed.length > 0;
    v.failed = failed.map(j => ({
      text: t(j.count === 1 ? '{destination} ticket for Table {table} (round {round}, {count} item) did not print. The order is saved.' : '{destination} ticket for Table {table} (round {round}, {count} items) did not print. The order is saved.', {destination:t(this.rlabel(j.printer)), table:j.tableId, round:j.round, count:j.count}),
      attempts: t('Tried {count}×', {count:j.attempts}),
      retry: () => this.retryJob(j.id), backup: () => this.backupJob(j.id)
    }));

    // order screen
    const tid = d.tableId; const o = tid ? d.orders[tid] : null;
    v.tableName = tid ? t('Table {id}', {id: tid}) : '';
    v.orderMeta = o ? t(o.openedBy ? 'Opened {time} by {name} · {minutes} min' : 'Opened {time} · {minutes} min', {time:hm(o.openedAt), name:o.openedBy, minutes:Math.max(0, Math.round((now - o.openedAt) / 60000))}) : t("Free. Add products to open it.");
    v.statusLabel = o ? t("Taken") : t("Free");
    v.statusStyle = 'height:36px; padding:0 14px; border-radius:999px; display:inline-flex; align-items:center; font-size:15px; font-weight:800; ' + (o ? 'background:#F97316; color:#1A0B00' : 'background:#DCFCE7; color:#14532D');
    Object.assign(v, this.catalog.view({ language: this.settings.state.language, pendingItems: d.items.filter(item => item.tableId === tid && item.status === 'pending'), addProduct: id => this.pending.addProduct(id) }));

    const its = tid ? d.items.filter(i => i.tableId === tid) : [];
    const pend = its.filter(i => i.status === 'pending');
    const pc = pend.reduce((a, i) => a + i.qty, 0);
    const tb = on => 'flex:1; height:48px; border:none; border-bottom:4px solid ' + (on ? '#F97316' : 'transparent') + '; background:transparent; font-size:16px; font-weight:800; color:' + (on ? '#0F172A' : '#475569');
    v.tabOrder = d.tab === 'order'; v.tabAct = d.tab === 'activity';
    v.tabOrderSel = String(v.tabOrder); v.tabActSel = String(v.tabAct);
    v.tabOrderStyle = tb(v.tabOrder); v.tabActStyle = tb(v.tabAct);
    v.setTabOrder = () => this.tableOrders.selectTab('order');
    v.setTabAct = () => this.tableOrders.selectTab('activity');
    v.isEmpty = its.length === 0;
    Object.assign(v, this.pending.rowsView());
    const sent = its.filter(i => i.status !== 'pending');
    const byRound = {};
    sent.forEach(i => { (byRound[i.round] = byRound[i.round] || []).push(i); });
    v.rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a).map(r => {
      const L = byRound[r]; const first = L.reduce((a, i) => (i.sentAt < a.sentAt ? i : a), L[0]);
      return {
        title: t('Round {round}', {round: r}), meta: t('Sent {time} by {name}', {time: hm(first.sentAt), name: first.sentBy}),
        items: L.map(i => {
          const qq = bq(i); const all = qq === 0; const c = i.cx[i.cx.length - 1];
          return {
            name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note,
            hasMoved: !!i.movedFrom, moved: t('From Table {id}', {id:i.movedFrom}),
            qtyLabel: (all ? i.qty : qq) + '×',
            qtyStyle: 'min-width:40px; height:36px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:17px; font-weight:800; ' + (all ? 'background:#F1F5F9; color:#64748B; text-decoration:line-through' : 'background:#0F172A; color:#FFFFFF'),
            nameStyle: 'font-size:17px; font-weight:800; ' + (all ? 'text-decoration:line-through; color:#64748B' : 'color:#0F172A'),
            amount: all ? t('Cancelled') : money(qq * i.unit),
            amountStyle: 'font-size:17px; font-weight:800; white-space:nowrap; color:' + (all ? '#B91C1C' : '#0F172A'),
            routeLabel: i.route === 'bar' ? 'Bar' : t('Kitchen'),
            routeStyle: 'height:24px; padding:0 8px; border-radius:6px; display:inline-flex; align-items:center; font-size:12px; font-weight:800; ' + (i.route === 'bar' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#FFEDD5; color:#9A3412'),
            hasCx: i.cxQty > 0,
            cxText: c ? t('{count} cancelled total · latest: {qty} · {reason} · {who} {time}', {count:i.cxQty, qty:c.qty, reason:['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].includes(c.reason) ? t(c.reason) : c.reason, who:c.who, time:hm(c.t)}) + (desktopBridge ? '' : t(' · waiting for owner review')) : '',
            canCancel: qq > 0, cancel: () => this.openCancel(i.id), cancelAria: t('Cancel {name}', {name: i.name})
          };
        })
      };
    });
    const total = its.reduce((a, i) => a + bq(i) * i.unit, 0);
    v.total = money(total);
    v.sendDisabled = pc === 0;
    v.sendLabel = pc ? t('Send order · {count}', {count: pc}) : t("Nothing new to send");
    v.sendStyle = 'flex:2; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (pc ? 'background:#16A34A; color:#FFFFFF; box-shadow:0 10px 22px rgba(22,163,74,0.35)' : 'background:#E2E8F0; color:#475569');
    const billable = sent.filter(i => bq(i) > 0);
    v.billDisabled = !o || (!desktopBridge && billable.length === 0);
    v.billStyle = 'flex:1; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (v.billDisabled ? 'background:#E2E8F0; color:#475569' : 'background:#2563EB; color:#FFFFFF; box-shadow:0 10px 22px rgba(37,99,235,0.3)');
    v.moveDisabled = !o;
    v.moveStyle = 'flex:1; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:800; ' + (o ? 'border:2px solid #C4B5FD; background:#F5F3FF; color:#5B21B6' : 'border:2px solid #E2E8F0; background:#F8FAFC; color:#64748B');
    v.send = () => this.send();
    v.openBill = () => { if (!this._handoffInProgress && this.pending.dismiss()) this.mut(n => { n.modal = { type: desktopBridge ? 'desktopBill' : 'bill', step: 'confirm', method: null, account: null, printed: 0, backup: false }; }); };
    v.openMoveTable = () => { if (!this._handoffInProgress && this.pending.dismiss()) this.mut(n => { n.modal = { type: 'moveTable', dest: null }; }); };
    v.activity = o ? o.log.slice().reverse().map(e => ({ time: hm(e.t), who: e.who, text: e.text })) : [];
    v.noActivity = v.activity.length === 0;

    // history
    const H = s.history;
    v.hist = H.map(h => ({
      no: '#' + h.no, table: h.table, time: hm(h.closedAt), waiter: h.waiter, items: String(h.count), method: h.method, account: 'Account ' + h.account, total: money(h.total),
      accStyle: 'height:30px; padding:0 12px; border-radius:999px; display:inline-flex; align-items:center; font-size:14px; font-weight:800; ' + (h.account === 'A' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#F3E8FF; color:#6B21A8')
    }));
    const sum = f => money(H.filter(f).reduce((a, h) => a + h.total, 0));
    v.hCount = String(H.length);
    v.hCashA = sum(h => h.method === 'Cash' && h.account === 'A');
    v.hCashB = sum(h => h.method === 'Cash' && h.account === 'B');
    v.hCardA = sum(h => h.method === 'Card');

    // modals: defaults
    const md = s.modal; const ty = md ? md.type : '';
    v.hasModal = !!md && ty !== 'desktopBill';
    v.isCancel = ty === 'cancel';
    v.isMoveTable = ty === 'moveTable'; v.isBill = ty === 'bill';
    v.closeModal = () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.setState({ modal: null }); };
    v.modalTitle = ''; v.modalSub = '';
    v.modalCardStyle = modalCardStyle(ty === 'bill' ? '880px' : '760px');
    v.cxReasons = []; v.mtTables = []; v.miItems = []; v.miTables = []; v.billLines = [];
    const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
    const chip = on => 'min-height:60px; border-radius:16px; padding:10px 14px; font-size:17px; font-weight:800; text-align:center; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1');

    if (ty === 'cancel') {
      const it = d.items.find(i => i.id === md.itemId);
      const mx = it ? bq(it) : 1; const l = it ? t(this.rlabel(it.route)) : '';
      v.modalTitle = t("Cancel a sent item");
      v.modalSub = t("It was already sent, so it stays on record, crossed out.");
      v.cxName = it ? it.name : ''; v.cxMods = it ? it.mods : ''; v.cxHasMods = !!(it && it.mods);
      v.cxMeta = it ? t('Round {round} · sent {time} to {destination}', {round:it.round,time:hm(it.sentAt),destination:l}) : '';
      v.cxMulti = mx > 1; v.cxQty = String(md.qty); v.cxMax = t('of {count}', {count: mx}); v.cxMaxNumber = mx;
      v.cxInc = () => this.mut(n => { if (!n.modal.requestId) n.modal.qty = Math.min(mx, n.modal.qty + 1); });
      v.cxDec = () => this.mut(n => { if (!n.modal.requestId) n.modal.qty = Math.max(1, n.modal.qty - 1); });
      v.cxReasons = ['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].map(r => ({
        label: t(r), pressed: String(md.reason === r), style: chip(md.reason === r),
        pick: () => this.mut(n => { if (!n.modal.requestId) n.modal.reason = r; })
      }));
      v.cxReasonLabel = md.reason === 'Other' ? md.other.trim() : t(md.reason);
      v.cxIsOther = md.reason === 'Other'; v.cxOther = md.other;
      v.onCxOther = e => { const val = e.target.value; this.setState(st => st.modal.requestId ? null : ({ modal: Object.assign({}, st.modal, { other: val }) })); };
      const ok = !!md.reason && (md.reason !== 'Other' || md.other.trim().length > 0);
      v.cxDisabled = !ok;
      v.cxStyle = 'flex:2; ' + bigBtn(ok, '#DC2626', '#FFFFFF').replace('height:72px', 'height:64px');
      v.cxInfo = t('Tell preparation staff in person; no cancellation notice is printed and earlier output may still arrive.');
      v.cxConfirm = () => this.confirmCancel();
    }

    if (ty === 'moveTable') {
      v.modalTitle = t("Move the whole table");
      v.modalSub = md.error || t('Everything on Table {id} moves to the table you pick. Table {id} becomes free. Only free tables can be picked, so no order gets overwritten.', {id: tid});
      v.mtTables = d.sections.flatMap(sec => sec.ids).filter(id => id !== tid).map(id => {
        const tk = !!d.orders[id] && !d.orders[id].untouched; const on = md.dest === id;
        return {
          num: String(id), sub: tk ? t("Taken") : t("Free"), disabled: tk,
          aria: t(tk ? 'Table {id}, taken, not available' : 'Table {id}, free', {id}),
          style: 'min-height:84px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (tk ? 'background:#F1F5F9; color:#64748B; border:2px dashed #CBD5E1' : (on ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
          pick: () => { if (!this.state.modal?.saving && !this.state.modal?.unresolved) this.mut(n => { n.modal.dest = id; n.modal.error = ''; }); }
        };
      });
      v.mtDisabled = md.dest == null || !!md.saving;
      v.mtLabel = md.dest != null ? t('Move everything to Table {id}', {id: md.dest}) : t("Pick a free table");
      v.mtStyle = bigBtn(md.dest != null, '#7C3AED', '#FFFFFF');
      v.mtConfirm = () => this.confirmMoveTable();
    }

    if (ty === 'bill') {
      const b = md; const st = b.step;
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
      v.billNo = t('Bill #{number}', {number:s.billNo}); v.billWaiter = t('Waiter: {name}', {name:w.name});
      const dd = new Date(now);
      v.billDate = String(dd.getDate()).padStart(2, '0') + '.' + String(dd.getMonth() + 1).padStart(2, '0') + '.' + dd.getFullYear() + ' ' + hm(now);
      v.printedText = t(b.printed > 1 ? 'Printed on {printer} · printed {count} times, still one payment.' : 'Printed on {printer}.', {printer:v.billPrinter,count:b.printed});
      v.failText = t('Printer {account} is not responding. The bill did not print and no payment was recorded. The order is safe.', {account:acc});
      v.bYes = () => this.bSet(m => { if (!pc) m.step = 'method'; });
      v.bCash = () => this.bSet(m => { m.method = 'Cash'; m.account = null; m.step = 'account'; });
      v.bCard = () => this.bSet(m => { m.method = 'Card'; m.account = 'A'; m.step = 'review'; });
      v.bAccA = () => this.bSet(m => { m.account = 'A'; m.step = 'review'; });
      v.bAccB = () => this.bSet(m => { if (m.method === 'Cash') { m.account = 'B'; m.step = 'review'; } });
      v.bBack = () => this.bSet(m => {
        if (m.step === 'method') m.step = 'confirm';
        else if (m.step === 'account') m.step = 'method';
        else if (m.step === 'review') m.step = m.method === 'Card' ? 'method' : 'account';
      });
      v.bPrint = () => this.printBill(false);
      v.bRetry = () => this.printBill(false);
      v.bBackup = () => this.printBill(true);
      v.bReprint = () => this.printBill(false);
      v.bPaid = () => this.paid();
    }

    // toast
    const toast = s.toast;
    v.hasToast = !!toast; v.toastText = toast ? toast.msg : '';
    const tc = toast && toast.kind === 'err' ? 'background:#DC2626; color:#FFFFFF' : (toast && toast.kind === 'warn' ? 'background:#FDE047; color:#1A1400' : 'background:#0F172A; color:#FFFFFF');
    v.toastStyle = 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); max-width:min(720px, calc(100vw - 32px)); padding:16px 24px; border-radius:16px; font-size:18px; font-weight:800; line-height:1.35; z-index:80; box-shadow:0 18px 40px rgba(15,23,42,0.3); ' + tc;

    return v;
  }
  render() {
    const identity = this.session.identity(), language = this.settings.state.language;
    if (this.session.state.screen === 'transferCorrection') return React.createElement(ArraComponents.TransferCorrection, { language, onBack: () => this.session.switchWaiter() });
    if (this.session.state.screen === 'admin' && identity.adminAccess) return this.administration.render({ identity, language, settings: this.settings.render(), printing: desktopBridge ? React.createElement(TestPrintJobs, { key: identity.generation, language, printing: this.printing }) : null });
    const v = this.renderVals();
    const t = v.t;
    return React.createElement(React.Fragment, null, (desktopBridge && this.state.modal?.type === 'desktopBill' ? React.createElement(DesktopBill, { language: this.settings.state.language, orderId: this.tableOrders.state.orders[this.tableOrders.state.tableId]?.id, onClose: () => this.setState({ modal: null }), onPaid: () => this.session.switchWaiter() }) : null), "\n", React.createElement("div", {"style": style("height: 100vh; min-height: 820px; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden")} , "\n\n", "\n", renderAccountEntry(this.session.accountView()), "\n\n", "\n", null, "\n\n", "\n", null, "\n\n", "\n", (v.isApp ? React.createElement(React.Fragment, null, "\n", React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , v.clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , t("Switch waiter")), "\n  "), "\n"), "\n\n", (desktopBridge ? React.createElement(PrintJobs, { language: this.settings.state.language, printing: this.printing }) : null), (v.hasFailed ? React.createElement(React.Fragment, null, "\n", React.createElement("div", {"role": "alert", "style": style("flex: none; background: #DC2626; color: #FFFFFF; padding: 12px 20px; display: flex; flex-direction: column; gap: 10px")} , "\n  ", (v.failed || []).map((f, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n    ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 14px; flex-wrap: wrap")} , "\n      ", React.createElement("svg", {"width": "26", "height": "26", "viewbox": "0 0 24 24", "fill": "none", "stroke": "currentColor", "strokeWidth": "2.4", "strokeLinecap": "round", "strokeLinejoin": "round", "aria-hidden": "true"} , React.createElement("path", {"d": "M6 9V3h12v6"}), React.createElement("rect", {"x": "6", "y": "14", "width": "12", "height": "7"}), React.createElement("path", {"d": "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"})), "\n      ", React.createElement("div", {"style": style("flex: 1 1 320px; font-size: 18px; font-weight: 700; line-height: 1.3")} , f.text), "\n      ", React.createElement("span", {"style": style("font-size: 14px; font-weight: 700")} , f.attempts), "\n      ", React.createElement("button", {"onClick": f.retry, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: none; background: #FFFFFF; color: #B91C1C; font-size: 17px; font-weight: 800")} , t("Retry")), "\n      ", React.createElement("button", {"onClick": f.backup, "style": style("height: 48px; padding: 0 20px; border-radius: 12px; border: 2px solid #FFFFFF; background: transparent; color: #FFFFFF; font-size: 17px; font-weight: 800")} , t("Print on backup printer")), "\n    "), "\n  "))), "\n"), "\n") : null), "\n\n", "\n", (v.isTables ? renderTables(this.tableOrders.tableView({ language: this.settings.state.language, failedTables: this.state.jobs.filter(job => job.status === 'failed').map(job => job.tableId), canAdmin: this.session.state.adminAccess, openAdmin: () => this.session.openAdministration() }), style) : null), "\n\n", "\n", (v.isOrder ? renderOrder(v, style) : null), "\n\n", "\n", (v.isHistory ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px")} , "\n    ", React.createElement("div", {} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , t("Today's bills")), "\n      ", React.createElement("p", {"style": style("margin: 6px 0 0; font-size: 17px; color: #475569; max-width: 760px; line-height: 1.45")} , t("Every closed table, paid once. If a bill went to the wrong account, the owner moves it later from the admin side. That never creates a second payment.")), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n      ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; padding: 20px; border: 1px solid #E2E8F0")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , t("Bills closed")), "\n        ", React.createElement("div", {"style": style("font-size: 36px; font-weight: 800; margin-top: 6px")} , v.hCount), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #EAF1FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #1E40AF")} , t("Cash · Account A")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashA), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #F3E8FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #6B21A8")} , t("Cash · Account B")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashB), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #DCFCE7; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #166534")} , t("Card · Account A")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCardA), "\n      "), "\n    "), "\n    ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; overflow-x: auto")} , "\n      ", React.createElement("div", {"style": style("min-width: 820px")} , "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E2E8F0")} , "\n          ", React.createElement("span", {} , t("Bill")), React.createElement("span", {} , t("Table")), React.createElement("span", {} , t("Closed")), React.createElement("span", {} , t("Waiter")), React.createElement("span", {} , t("Items")), React.createElement("span", {} , t("Payment")), React.createElement("span", {} , t("Account")), React.createElement("span", {"style": style("text-align: right")} , t("Total")), "\n        "), "\n        ", (v.hist || []).map((h, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; align-items: center; font-size: 17px; font-weight: 700; border-bottom: 1px solid #F1F5F9")} , "\n            ", React.createElement("span", {"style": style("color: #475569")} , h.no), "\n            ", React.createElement("span", {"style": style("font-weight: 800")} , h.table), "\n            ", React.createElement("span", {} , h.time), "\n            ", React.createElement("span", {} , h.waiter), "\n            ", React.createElement("span", {} , h.items), "\n            ", React.createElement("span", {} , h.method), "\n            ", React.createElement("span", {} , React.createElement("span", {"style": style(h.accStyle)} , h.account)), "\n            ", React.createElement("span", {"style": style("text-align: right; font-weight: 800")} , h.total), "\n          "), "\n        "))), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n") : null), "\n\n", "\n", this.pending.render(), (v.hasModal ? ModalFrame({ title: v.modalTitle, subtitle: v.modalSub, cardStyle: v.modalCardStyle, onClose: v.closeModal, closeLabel: t('Close'), children: React.createElement(React.Fragment, null,
      v.isCancel ? React.createElement(ArraComponents.SentItemCorrection, { v, modal: this.state.modal }) : null,
      v.isMoveTable ? renderMoveTable(v, style) : null, renderBill(v, style)) }) : null), "\n\n", "\n", (v.hasToast ? React.createElement(React.Fragment, null, "\n  ", React.createElement("div", {"role": "status", "style": style(v.toastStyle)} , v.toastText), "\n") : null), "\n\n"), "\n");
  }
}
