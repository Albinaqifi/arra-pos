import { TransferCorrection } from './TransferCorrection.js';
import { desktopBridge } from './shared/desktop-bridge.js';
import { style } from './shared/waiter-ui.js';
import { ShellModel } from './shell/ShellModel.js';
import { renderShellFrame, renderShellHeader } from './shell/ShellFrame.js';
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
    this.shell = new ShellModel();
    this.settings = new LanguageSettings({ bridge: desktopBridge });
    const catalog = desktopBridge ? undefined : demoCatalog();
    this.catalog = new CatalogModel({ bridge: desktopBridge, demoCatalog: catalog });
    this.tableOrders = new TableOrderModel({
      bridge: desktopBridge, demoOrders: desktopBridge ? undefined : demoOrders(catalog, this.nextDemoId), nextId: this.nextDemoId,
      canNavigate: () => !this.sendWorkflow?.state.busy && !this.correction?.locked && !this.moveWorkflow?.locked && !this.billing?.locked,
      notify: (message, kind) => this.shell.notify(message, kind),
      getLanguage: () => this.settings.state.language,
      onOrderOpened: () => this.catalog.clearSearch(),
      onDismiss: () => { this.pending?.dismiss(); this.moveWorkflow?.dismiss(); this.correction?.dismiss(); this.billing?.dismiss(); },
    });
    this.pending = new PendingItems({
      bridge: desktopBridge,
      getCatalog: () => this.catalog.state, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canEdit: () => !this.sendWorkflow?.state.busy && !this.billing?.openDialog && !this.billing?.locked && !this.moveWorkflow?.state.dialog && !this.correction?.state.dialog,
      notify: (message, kind) => this.shell.notify(message, kind),
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
      notify: (message, kind) => this.shell.notify(message, kind),
    });
    this.sendWorkflow = new SendWorkflow({
      bridge: desktopBridge, getLanguage: () => this.settings.state.language, getActor: () => this.session.state.waiter?.name || '',
      canSend: () => !this.correction?.locked && !this.moveWorkflow?.locked && !this.billing?.locked,
      notify: (message, kind) => this.shell.notify(message, kind),
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
      notify: (message, kind) => this.shell.notify(message, kind),
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
      notify: (message, kind) => this.shell.notify(message, kind),
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
      notify: (message, kind) => this.shell.notify(message, kind),
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
      notify: (message, kind) => this.shell.notify(message, kind),
      getLanguage: () => this.settings.state.language,
      getDemoStaff: demoStaff,
    });
    const refresh = () => { if (this._mounted) this.forceUpdate?.(); };
    this._subscriptions = [this.session.subscribe(() => { this.administration.setIdentity(this.session.identity()); refresh(); }), this.settings.subscribe(refresh), this.administration.subscribe(refresh), this.catalog.subscribe(refresh), this.tableOrders.subscribe(refresh), this.pending.subscribe(refresh), this.sendWorkflow.subscribe(refresh), this.demoPrinting.subscribe(refresh), this.moveWorkflow.subscribe(refresh), this.correction.subscribe(refresh), this.billing.subscribe(refresh), this.demoBilling.subscribe(refresh), this.shell.subscribe(refresh)];
  }
  componentDidMount() {
    this._mounted = true;
    this.settings.load();
    this.shell.start();
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
    this.shell.dispose();
  }


  render() {
    const identity = this.session.identity(), language = this.settings.state.language, screen = this.session.state.screen;
    if (screen === 'transferCorrection') return React.createElement(TransferCorrection, { language, onBack: () => this.session.switchWaiter() });
    if (screen === 'admin' && identity.adminAccess) return this.administration.render({ identity, language, settings: this.settings.render(), printing: desktopBridge ? React.createElement(TestPrintJobs, { key: identity.generation, language, printing: this.printing }) : null });
    const shell = this.shell.view();
    let content = null;
    if (screen === 'waiter') {
      if (this.tableOrders.state.screen === 'tables') content = renderTables(this.tableOrders.tableView({ language, now: shell.now, failedTables: this.demoPrinting.failedTableIds(), canAdmin: identity.adminAccess, openAdmin: () => this.session.openAdministration() }), style);
      else if (this.tableOrders.state.screen === 'order') content = renderOrder({
        catalog: this.catalog.view({ language, pendingItems: this.tableOrders.selectedPendingItems(), addProduct: id => this.pending.addProduct(id) }),
        order: this.tableOrders.orderView({ language, now: shell.now, onCorrect: id => this.correction.open(id) }),
        pending: this.pending.rowsView(), send: this.sendWorkflow.buttonView(), move: this.moveWorkflow.buttonView(), bill: this.billing.buttonView(),
      }, style);
      else if (this.tableOrders.state.screen === 'history') content = this.demoBilling.renderHistory();
    }
    return renderShellFrame({
      desktopBill: this.billing.render(), account: renderAccountEntry(this.session.accountView()),
      header: screen === 'waiter' ? renderShellHeader(this.session.headerView(), shell.clock) : null,
      printing: screen === 'waiter' ? React.createElement(React.Fragment, null, desktopBridge ? React.createElement(PrintJobs, { language, printing: this.printing }) : null, renderDemoPrintStatus(this.demoPrinting.failedView())) : null,
      content, dialogs: React.createElement(React.Fragment, null, this.pending.render(), this.moveWorkflow.render(), this.correction.render(), this.demoBilling.render()), toast: shell,
    });
  }
}
