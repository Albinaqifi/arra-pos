import * as Pages from './index.js';
import { FeatureState } from '../shared/FeatureState.js';

const pages = { operationalReports: Pages.OperationalReports, financialVisibility: Pages.FinancialVisibility, orderHistory: Pages.OrderHistory, adminSentCorrections: Pages.AdminSentCorrections, employeeConfig: Pages.EmployeeConfig, menuConfig: Pages.MenuConfig, tableConfig: Pages.TableConfig };
const editors = new Set(['tableConfig', 'menuConfig', 'employeeConfig', 'adminSentCorrections']);

export class AdminWorkspace extends FeatureState {
  constructor({ signOut, refreshAccess }) {
    super({ page: 'admin' });
    Object.assign(this, { signOut, refreshAccess });
    this.identity = { generation: 0 };
  }
  setIdentity(identity) {
    if (identity.generation !== this.identity.generation) { this.editor = null; this._set({ page: 'admin' }); }
    this.identity = identity;
  }
  canLeave() { return !editors.has(this.state.page) || !this.editor || (!this.editor.state.busy && this.editor.leaveEditor()); }
  navigate(page) {
    if (page !== 'admin' && !pages[page]) return;
    if (page !== this.state.page && !this.canLeave()) return;
    this.editor = null;
    this._set({ page });
  }
  returnToOverview() {
    // The page's own Back control has already accepted its editor leave guard.
    this.editor = null;
    this._set({ page: 'admin' });
  }
  render({ identity, language, settings, printing }) {
    const page = this.state.page, Page = pages[page], generation = identity.generation;
    return React.createElement(Pages.AdminShell, {
      screen: page, user: identity.name, language, directOwner: true,
      navigate: next => this.navigate(next), back: () => this.signOut(), switchUser: () => this.signOut(),
    }, Page ? React.createElement(Page, {
      ref: editors.has(page) ? instance => { this.editor = instance; } : undefined,
      language, onBack: () => this.returnToOverview(), onAccessChanged: () => this.refreshAccess(generation),
    }) : React.createElement(React.Fragment, null, settings, printing));
  }
}
