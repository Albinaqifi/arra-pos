import * as ArraComponents from './admin/index.js';
import { desktopBridge } from './shared/desktop-bridge.js';
import { waiterTranslate, style } from './shared/waiter-ui.js';
import { renderTables } from './waiter/Tables.js';
import { renderOrder } from './waiter/Order.js';
import { CorrectionWorkflow } from './correction/CorrectionWorkflow.js';
import { MoveWorkflow } from './movement/MoveWorkflow.js';
import { renderBill } from './waiter/Bill.js';
import { DesktopBill } from './waiter/DesktopBill.js';
import { SendWorkflow } from './waiter/SendWorkflow.js';
import { DemoPrinting } from './printing/DemoPrinting.js';
import { renderDemoPrintStatus } from './printing/DemoPrintStatus.js';
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
      canNavigate: () => !this.sendWorkflow?.state.busy && !this.correction?.locked && !this.moveWorkflow?.locked,
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      getLanguage: () => this.settings.state.language,
      onOrderOpened: () => this.catalog.clearSearch(),
      onDismiss: () => { this.pending?.dismiss(); this.moveWorkflow?.dismiss(); this.correction?.dismiss(); this.setState({ modal: null }); },
    });
    this.pending = new PendingItems({
      bridge: desktopBridge,
      getCatalog: () => this.catalog.state, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canEdit: () => !this.sendWorkflow?.state.busy && !this.state.modal && !this.moveWorkflow?.state.dialog && !this.correction?.state.dialog,
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
    this.demoPrinting = new DemoPrinting({
      nextId: this.nextDemoId, getLanguage: () => this.settings.state.language,
      getActor: () => this.session.state.waiter?.name || '',
      appendActivity: (tableId, text, actor) => this.tableOrders.appendActivity(tableId, text, actor),
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
    });
    this.sendWorkflow = new SendWorkflow({
      bridge: desktopBridge, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canSend: () => !this.correction?.locked && !this.moveWorkflow?.locked,
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      completeHandoff: notice => this.session.completeHandoff(notice),
      submitDemoRound: round => this.demoPrinting.submitRound(round),
      printing: { jobsChanged: () => this.printing.jobsChanged(), handoffNotice: language => this.printing.handoffNotice(language) },
      orders: {
        snapshot: () => this.tableOrders.state, writeBusy: () => this.tableOrders.writeBusy,
        captureTarget: () => this.tableOrders.captureTarget(), isCurrent: target => this.tableOrders.isCurrent(target),
        acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
        applyConfirmedItems: (target, items) => this.tableOrders.applyConfirmedItems(target, items),
        markPendingSent: (tableId, actor) => this.tableOrders.markPendingSent(tableId, actor),
      },
    });
    this.moveWorkflow = new MoveWorkflow({
      bridge: desktopBridge, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      isHandoffPending: () => this.sendWorkflow.state.busy, canOpen: () => !this.correction?.locked,
      dismissOtherDialogs: () => { if (!this.pending.dismiss() || !this.correction.dismiss()) return false; this.setState({ modal: null }); return true; },
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      onDemoMoved: (from, to) => this.demoPrinting.moveJobs(from, to), createRequestId: () => crypto.randomUUID(),
      orders: {
        snapshot: () => this.tableOrders.state, writeBusy: () => this.tableOrders.writeBusy,
        captureTarget: () => this.tableOrders.captureTarget(), isCurrent: target => this.tableOrders.isCurrent(target),
        acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
        applyConfirmedMove: (target, destination, untouched) => this.tableOrders.applyConfirmedMove(target, destination, untouched),
        reconcileOrderLocations: (target, tables) => this.tableOrders.reconcileOrderLocations(target, tables),
        abandonChangedOrder: target => this.tableOrders.abandonChangedOrder(target), refreshAvailability: target => this.tableOrders.refreshAvailability(target),
        moveDemoOrder: (from, to, actor) => this.tableOrders.moveDemoOrder(from, to, actor),
      },
    });
    this.correction = new CorrectionWorkflow({
      bridge: desktopBridge, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canOpen: () => !this.sendWorkflow.state.busy && !this.state.modal && this.pending.dismiss() && this.moveWorkflow.dismiss(),
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      orders: {
        snapshot: () => this.tableOrders.state, captureTarget: () => this.tableOrders.captureTarget(), tableForOrder: target => this.tableOrders.tableForOrder(target),
        writeBusy: () => this.tableOrders.writeBusy, isCurrent: target => this.tableOrders.isCurrent(target),
        acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
        applyConfirmedItems: (target, items) => this.tableOrders.applyConfirmedItems(target, items), refreshAvailability: target => this.tableOrders.refreshAvailability(target),
        applyDemoCorrection: (id, quantity, reason, actor) => this.tableOrders.applyDemoCorrection(id, quantity, reason, actor),
      },
    });
    this.administration = new AdminWorkspace({ signOut: () => this.session.signOut(), refreshAccess: generation => this.session.refreshAdminAccess(generation) });
    this.session = new SessionModel({
      bridge: desktopBridge,
      canLeave: ({ afterAction }) => !this.tableOrders.opening && !this.tableOrders.writeBusy && (!this.sendWorkflow?.state.busy || afterAction) && !this.correction?.locked && !this.moveWorkflow.locked && this.administration.canLeave(),
      clearProtectedData: () => this.clearDesktopData(),
      dismissSelectedOrder: () => this.tableOrders.dismissSelectedOrder(),
      loadProtectedData: () => this.loadDesktopData(),
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      getLanguage: () => this.settings.state.language,
      getDemoStaff: demoStaff,
    });
    const refresh = () => { if (this._mounted) this.forceUpdate?.(); };
    this._subscriptions = [this.session.subscribe(() => { this.administration.setIdentity(this.session.identity()); refresh(); }), this.settings.subscribe(refresh), this.administration.subscribe(refresh), this.catalog.subscribe(refresh), this.tableOrders.subscribe(refresh), this.pending.subscribe(refresh), this.sendWorkflow.subscribe(refresh), this.demoPrinting.subscribe(refresh), this.moveWorkflow.subscribe(refresh), this.correction.subscribe(refresh)];
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
    this.moveWorkflow.reset(); this.correction.reset();
    this.setState({ modal: null });
  }
  loadDesktopData() { return Promise.all([this.catalog.load(), this.tableOrders.loadTables()]); }
  componentWillUnmount() {
    this._mounted = false;
    this._subscriptions.forEach(unsubscribe => unsubscribe());
    this.session.dispose(); this.settings.dispose(); this.administration.dispose(); this.printing.dispose(); this.catalog.dispose(); this.tableOrders.dispose(); this.pending.dispose(); this.sendWorkflow.dispose(); this.demoPrinting.dispose(); this.moveWorkflow.dispose(); this.correction.dispose();
    clearInterval(this._tick); clearTimeout(this._tt);
  }


  seed() {
    const now = Date.now(), m = 60000;
    const st = { modal: null, toast: null, history: [], billNo: 1045 };
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



  bSet(fn) { this.mut(n => { if (n.modal && n.modal.type === 'bill') fn(n.modal, n); }); }
  printBill(useBackup) {
    const bill = this.state.modal;
    if (!bill || bill.type !== 'bill') return;
    const account = bill.method === 'Card' ? 'A' : bill.account;
    const failed = !useBackup && !this.demoPrinting.isOnline(account);
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
    this.demoPrinting.retireOrderJobs(tid);
    this.mut(n => {
      n.history.unshift({ no: n.billNo++, table: 'Table ' + tid, closedAt: at, waiter: actor, method: bill.method, account: bill.account, total, count });
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
    // order screen
    const tid = d.tableId; const o = tid ? d.orders[tid] : null;
    v.tableName = tid ? t('Table {id}', {id: tid}) : '';
    v.orderMeta = o ? t(o.openedBy ? 'Opened {time} by {name} · {minutes} min' : 'Opened {time} · {minutes} min', {time:hm(o.openedAt), name:o.openedBy, minutes:Math.max(0, Math.round((now - o.openedAt) / 60000))}) : t("Free. Add products to open it.");
    v.statusLabel = o ? t("Taken") : t("Free");
    v.statusStyle = 'height:36px; padding:0 14px; border-radius:999px; display:inline-flex; align-items:center; font-size:15px; font-weight:800; ' + (o ? 'background:#F97316; color:#1A0B00' : 'background:#DCFCE7; color:#14532D');
    Object.assign(v, this.catalog.view({ language: this.settings.state.language, pendingItems: d.items.filter(item => item.tableId === tid && item.status === 'pending'), addProduct: id => this.pending.addProduct(id) }));

    const its = tid ? d.items.filter(i => i.tableId === tid) : [];
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
            canCancel: qq > 0, cancel: () => this.correction.open(i.id), cancelAria: t('Cancel {name}', {name: i.name})
          };
        })
      };
    });
    const total = its.reduce((a, i) => a + bq(i) * i.unit, 0);
    v.total = money(total);
    Object.assign(v, this.sendWorkflow.buttonView());
    const billable = sent.filter(i => bq(i) > 0);
    v.billDisabled = !o || (!desktopBridge && billable.length === 0);
    v.billStyle = 'flex:1; height:72px; border-radius:18px; border:none; display:flex; align-items:center; justify-content:center; gap:10px; font-size:21px; font-weight:800; ' + (v.billDisabled ? 'background:#E2E8F0; color:#475569' : 'background:#2563EB; color:#FFFFFF; box-shadow:0 10px 22px rgba(37,99,235,0.3)');
    Object.assign(v, this.moveWorkflow.buttonView());
    v.openBill = () => { if (!this.sendWorkflow?.state.busy && this.pending.dismiss() && this.moveWorkflow.dismiss() && this.correction.dismiss()) this.mut(n => { n.modal = { type: desktopBridge ? 'desktopBill' : 'bill', step: 'confirm', method: null, account: null, printed: 0, backup: false }; }); };
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
    v.isBill = ty === 'bill';
    v.closeModal = () => { if (!this.state.modal?.saving && !this.correction?.locked) this.setState({ modal: null }); };
    v.modalTitle = ''; v.modalSub = '';
    v.modalCardStyle = modalCardStyle(ty === 'bill' ? '880px' : '760px');
    v.cxReasons = []; v.billLines = [];
    const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
    const chip = on => 'min-height:60px; border-radius:16px; padding:10px 14px; font-size:17px; font-weight:800; text-align:center; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1');

    if (ty === 'bill') {
      const pc = its.filter(item => item.status === 'pending').reduce((sum, item) => sum + item.qty, 0);
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
    return React.createElement(React.Fragment, null, (desktopBridge && this.state.modal?.type === 'desktopBill' ? React.createElement(DesktopBill, { language: this.settings.state.language, orderId: this.tableOrders.state.orders[this.tableOrders.state.tableId]?.id, onClose: () => this.setState({ modal: null }), onPaid: () => this.session.switchWaiter() }) : null), "\n", React.createElement("div", {"style": style("height: 100vh; min-height: 820px; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden")} , "\n\n", "\n", renderAccountEntry(this.session.accountView()), "\n\n", "\n", null, "\n\n", "\n", null, "\n\n", "\n", (v.isApp ? React.createElement(React.Fragment, null, "\n", React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , v.clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , t("Switch waiter")), "\n  "), "\n"), "\n\n", (desktopBridge ? React.createElement(PrintJobs, { language: this.settings.state.language, printing: this.printing }) : null), renderDemoPrintStatus(this.demoPrinting.failedView()), "\n\n", "\n", (v.isTables ? renderTables(this.tableOrders.tableView({ language: this.settings.state.language, failedTables: this.demoPrinting.failedTableIds(), canAdmin: this.session.state.adminAccess, openAdmin: () => this.session.openAdministration() }), style) : null), "\n\n", "\n", (v.isOrder ? renderOrder(v, style) : null), "\n\n", "\n", (v.isHistory ? React.createElement(React.Fragment, null, "\n", React.createElement("main", {"style": style("flex: 1; min-height: 0; overflow: auto; padding: 24px; box-sizing: border-box")} , "\n  ", React.createElement("div", {"style": style("max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px")} , "\n    ", React.createElement("div", {} , "\n      ", React.createElement("h1", {"style": style("margin: 0; font-size: 34px; font-weight: 800")} , t("Today's bills")), "\n      ", React.createElement("p", {"style": style("margin: 6px 0 0; font-size: 17px; color: #475569; max-width: 760px; line-height: 1.45")} , t("Every closed table, paid once. If a bill went to the wrong account, the owner moves it later from the admin side. That never creates a second payment.")), "\n    "), "\n    ", React.createElement("div", {"style": style("display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px")} , "\n      ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; padding: 20px; border: 1px solid #E2E8F0")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #475569")} , t("Bills closed")), "\n        ", React.createElement("div", {"style": style("font-size: 36px; font-weight: 800; margin-top: 6px")} , v.hCount), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #EAF1FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #1E40AF")} , t("Cash · Account A")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashA), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #F3E8FF; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #6B21A8")} , t("Cash · Account B")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCashB), "\n      "), "\n      ", React.createElement("div", {"style": style("background: #DCFCE7; border-radius: 20px; padding: 20px")} , "\n        ", React.createElement("div", {"style": style("font-size: 15px; font-weight: 800; color: #166534")} , t("Card · Account A")), "\n        ", React.createElement("div", {"style": style("font-size: 32px; font-weight: 800; margin-top: 6px")} , v.hCardA), "\n      "), "\n    "), "\n    ", React.createElement("div", {"style": style("background: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; overflow-x: auto")} , "\n      ", React.createElement("div", {"style": style("min-width: 820px")} , "\n        ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; font-size: 13px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #E2E8F0")} , "\n          ", React.createElement("span", {} , t("Bill")), React.createElement("span", {} , t("Table")), React.createElement("span", {} , t("Closed")), React.createElement("span", {} , t("Waiter")), React.createElement("span", {} , t("Items")), React.createElement("span", {} , t("Payment")), React.createElement("span", {} , t("Account")), React.createElement("span", {"style": style("text-align: right")} , t("Total")), "\n        "), "\n        ", (v.hist || []).map((h, index) => React.createElement(React.Fragment, {key: index}, React.createElement(React.Fragment, null, "\n          ", React.createElement("div", {"style": style("display: grid; grid-template-columns: 90px 110px 90px 120px 80px 110px 130px 1fr; gap: 12px; padding: 14px 20px; align-items: center; font-size: 17px; font-weight: 700; border-bottom: 1px solid #F1F5F9")} , "\n            ", React.createElement("span", {"style": style("color: #475569")} , h.no), "\n            ", React.createElement("span", {"style": style("font-weight: 800")} , h.table), "\n            ", React.createElement("span", {} , h.time), "\n            ", React.createElement("span", {} , h.waiter), "\n            ", React.createElement("span", {} , h.items), "\n            ", React.createElement("span", {} , h.method), "\n            ", React.createElement("span", {} , React.createElement("span", {"style": style(h.accStyle)} , h.account)), "\n            ", React.createElement("span", {"style": style("text-align: right; font-weight: 800")} , h.total), "\n          "), "\n        "))), "\n      "), "\n    "), "\n  "), "\n"), "\n") : null), "\n") : null), "\n\n", "\n", this.pending.render(), this.moveWorkflow.render(), this.correction.render(), (v.hasModal ? ModalFrame({ title: v.modalTitle, subtitle: v.modalSub, cardStyle: v.modalCardStyle, onClose: v.closeModal, closeLabel: t('Close'), children: React.createElement(React.Fragment, null,
      renderBill(v, style)) }) : null), "\n\n", "\n", (v.hasToast ? React.createElement(React.Fragment, null, "\n  ", React.createElement("div", {"role": "status", "style": style(v.toastStyle)} , v.toastText), "\n") : null), "\n\n"), "\n");
  }
}
