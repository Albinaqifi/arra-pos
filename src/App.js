import * as ArraComponents from './admin/index.js';
import { desktopBridge } from './shared/desktop-bridge.js';
import { waiterTranslate, style } from './shared/waiter-ui.js';
import { renderTables } from './waiter/Tables.js';
import { renderOrder } from './waiter/Order.js';
import { CorrectionWorkflow } from './correction/CorrectionWorkflow.js';
import { MoveWorkflow } from './movement/MoveWorkflow.js';
import { BillingBoundary } from './billing/BillingBoundary.js';
import { DemoBilling } from './billing/DemoBilling.js';
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

export class WaiterDemo extends React.Component {
  constructor(...a) {
    super(...a);
    this.nextDemoId = demoSequence();
    this.printing = new PrintingSession({ bridge: desktopBridge });
    this.state = { toast: null };
    this.settings = new LanguageSettings({ bridge: desktopBridge });
    const catalog = desktopBridge ? undefined : demoCatalog();
    this.catalog = new CatalogModel({ bridge: desktopBridge, demoCatalog: catalog });
    this.tableOrders = new TableOrderModel({
      bridge: desktopBridge, demoOrders: desktopBridge ? undefined : demoOrders(catalog, this.nextDemoId), nextId: this.nextDemoId,
      canNavigate: () => !this.sendWorkflow?.state.busy && !this.correction?.locked && !this.moveWorkflow?.locked && !this.billing?.locked,
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      getLanguage: () => this.settings.state.language,
      onOrderOpened: () => this.catalog.clearSearch(),
      onDismiss: () => { this.pending?.dismiss(); this.moveWorkflow?.dismiss(); this.correction?.dismiss(); this.billing?.dismiss(); },
    });
    this.pending = new PendingItems({
      bridge: desktopBridge,
      getCatalog: () => this.catalog.state, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canEdit: () => !this.sendWorkflow?.state.busy && !this.billing?.openDialog && !this.billing?.locked && !this.moveWorkflow?.state.dialog && !this.correction?.state.dialog,
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
      canSend: () => !this.correction?.locked && !this.moveWorkflow?.locked && !this.billing?.locked,
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
      isHandoffPending: () => this.sendWorkflow.state.busy, canOpen: () => !this.correction?.locked && !this.billing?.locked,
      dismissOtherDialogs: () => { if (!this.pending.dismiss() || !this.correction.dismiss() || !this.billing.dismiss()) return false; return true; },
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
      canOpen: () => !this.sendWorkflow.state.busy && !this.billing?.openDialog && !this.billing?.locked && this.pending.dismiss() && this.moveWorkflow.dismiss(),
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      orders: {
        snapshot: () => this.tableOrders.state, captureTarget: () => this.tableOrders.captureTarget(), tableForOrder: target => this.tableOrders.tableForOrder(target),
        writeBusy: () => this.tableOrders.writeBusy, isCurrent: target => this.tableOrders.isCurrent(target),
        acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
        applyConfirmedItems: (target, items) => this.tableOrders.applyConfirmedItems(target, items), refreshAvailability: target => this.tableOrders.refreshAvailability(target),
        applyDemoCorrection: (id, quantity, reason, actor) => this.tableOrders.applyDemoCorrection(id, quantity, reason, actor),
      },
    });
    this.demoBilling = new DemoBilling({
      enabled: !desktopBridge, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      completeHandoff: () => this.billing.finishHandoff(),
      printing: { isOnline: account => this.demoPrinting.isOnline(account), retireOrderJobs: tableId => this.demoPrinting.retireOrderJobs(tableId) },
      orders: {
        snapshot: () => this.tableOrders.state, isCurrent: target => this.tableOrders.isCurrent(target), tableForOrder: target => this.tableOrders.tableForOrder(target),
        acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
        appendActivity: (tableId, text, actor) => this.tableOrders.appendActivity(tableId, text, actor), completeDemoOrder: tableId => this.tableOrders.completeDemoOrder(tableId),
      },
    });
    this.billing = new BillingBoundary({
      bridge: desktopBridge, getLanguage: () => this.settings.state.language,
      printing: { submitTestBill: billId => this.printing.submitTestBill(billId) },
      canOpen: () => !this.sendWorkflow.state.busy && !this.correction.locked && !this.moveWorkflow.locked,
      dismissOtherDialogs: () => this.pending.dismiss() && this.moveWorkflow.dismiss() && this.correction.dismiss(),
      openDemo: target => this.demoBilling.open(target), dismissDemo: () => this.demoBilling.dismiss(),
      isDemoOpen: () => !!this.demoBilling.state.dialog, isDemoLocked: () => this.demoBilling.locked,
      completeHandoff: () => this.session.completeHandoff(),
      orders: {
        snapshot: () => this.tableOrders.state, captureTarget: () => this.tableOrders.captureTarget(), isCurrent: target => this.tableOrders.isCurrent(target),
        writeBusy: () => this.tableOrders.writeBusy, acquireWrite: (kind, target) => this.tableOrders.acquireWrite(kind, target), releaseWrite: lease => this.tableOrders.releaseWrite(lease),
      },
    });
    this.administration = new AdminWorkspace({ signOut: () => this.session.signOut(), refreshAccess: generation => this.session.refreshAdminAccess(generation) });
    this.session = new SessionModel({
      bridge: desktopBridge,
      canLeave: ({ afterAction }) => !this.tableOrders.opening && !this.tableOrders.writeBusy && (!this.sendWorkflow?.state.busy || afterAction) && !this.correction?.locked && !this.moveWorkflow.locked && (!this.billing.locked || afterAction) && this.administration.canLeave(),
      clearProtectedData: () => this.clearDesktopData(),
      dismissSelectedOrder: () => this.tableOrders.dismissSelectedOrder(),
      loadProtectedData: () => this.loadDesktopData(),
      notify: (message, kind) => this.mut(state => this.toast(state, message, kind)),
      getLanguage: () => this.settings.state.language,
      getDemoStaff: demoStaff,
    });
    const refresh = () => { if (this._mounted) this.forceUpdate?.(); };
    this._subscriptions = [this.session.subscribe(() => { this.administration.setIdentity(this.session.identity()); refresh(); }), this.settings.subscribe(refresh), this.administration.subscribe(refresh), this.catalog.subscribe(refresh), this.tableOrders.subscribe(refresh), this.pending.subscribe(refresh), this.sendWorkflow.subscribe(refresh), this.demoPrinting.subscribe(refresh), this.moveWorkflow.subscribe(refresh), this.correction.subscribe(refresh), this.billing.subscribe(refresh), this.demoBilling.subscribe(refresh)];
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
    this.billing.reset(); this.demoBilling.reset();
  }
  loadDesktopData() { return Promise.all([this.catalog.load(), this.tableOrders.loadTables()]); }
  componentWillUnmount() {
    this._mounted = false;
    this._subscriptions.forEach(unsubscribe => unsubscribe());
    this.session.dispose(); this.settings.dispose(); this.administration.dispose(); this.printing.dispose(); this.catalog.dispose(); this.tableOrders.dispose(); this.pending.dispose(); this.sendWorkflow.dispose(); this.demoPrinting.dispose(); this.moveWorkflow.dispose(); this.correction.dispose(); this.billing.dispose(); this.demoBilling.dispose();
    clearInterval(this._tick); clearTimeout(this._tt);
  }


  fmt(v) { return Math.round(v).toLocaleString('en-US') + ' den'; }
  mut(fn, callback) { this.setState(s => { const n = JSON.parse(JSON.stringify(s)); fn(n); return n; }, callback); }
  toast(n, msg, kind) {
    n.toast = { msg, kind: kind || 'ok' };
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.setState({ toast: null }), 4200);
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
    Object.assign(v, this.billing.buttonView(), this.moveWorkflow.buttonView());
    v.activity = o ? o.log.slice().reverse().map(e => ({ time: hm(e.t), who: e.who, text: e.text })) : [];
    v.noActivity = v.activity.length === 0;

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
    return React.createElement(React.Fragment, null, this.billing.render(), "\n", React.createElement("div", {"style": style("height: 100vh; min-height: 820px; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden")} , "\n\n", "\n", renderAccountEntry(this.session.accountView()), "\n\n", "\n", null, "\n\n", "\n", null, "\n\n", "\n", (v.isApp ? React.createElement(React.Fragment, null, "\n", React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , v.clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , t("Switch waiter")), "\n  "), "\n"), "\n\n", (desktopBridge ? React.createElement(PrintJobs, { language: this.settings.state.language, printing: this.printing }) : null), renderDemoPrintStatus(this.demoPrinting.failedView()), "\n\n", "\n", (v.isTables ? renderTables(this.tableOrders.tableView({ language: this.settings.state.language, failedTables: this.demoPrinting.failedTableIds(), canAdmin: this.session.state.adminAccess, openAdmin: () => this.session.openAdministration() }), style) : null), "\n\n", "\n", (v.isOrder ? renderOrder(v, style) : null), "\n\n", "\n", (v.isHistory ? this.demoBilling.renderHistory() : null), "\n") : null), "\n\n", "\n", this.pending.render(), this.moveWorkflow.render(), this.correction.render(), this.demoBilling.render(), "\n\n", "\n", (v.hasToast ? React.createElement(React.Fragment, null, "\n  ", React.createElement("div", {"role": "status", "style": style(v.toastStyle)} , v.toastText), "\n") : null), "\n\n"), "\n");
  }
}
