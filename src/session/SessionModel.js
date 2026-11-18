import { FeatureState } from '../shared/FeatureState.js';
import { desktopBridge } from '../shared/desktop-bridge.js';
import { waiterTranslate } from '../shared/waiter-ui.js';

const avatar = (color, size) => 'width:' + size + 'px; height:' + size + 'px; border-radius:999px; background:' + color + '; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:' + Math.round(size * 0.42) + 'px; flex:none';

export class SessionModel extends FeatureState {
  constructor({ bridge = desktopBridge, canLeave, clearProtectedData, dismissSelectedOrder, loadProtectedData, loadEntryTables, openSelectedTable, notify, getLanguage, getDemoStaff }) {
    super({ screen: 'login', user: '', pass: '', waiter: null, pinFor: null, pin: '', waiterMessage: '', switching: false, recoveryRequired: false, handoffNotice: '', adminAccess: false, identityGeneration: 0 });
    Object.assign(this, { bridge, canLeave, clearProtectedData, dismissSelectedOrder, loadProtectedData, loadEntryTables, openSelectedTable, notify, getLanguage, getDemoStaff });
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  setUsername(user) { this._set({ user }); }
  setPassword(pass) { this._set({ pass }); }
  identity() { return { generation: this.state.identityGeneration, name: this.state.waiter?.name, adminAccess: this.state.adminAccess }; }
  headerView() {
    const waiter = this.state.waiter || { name: '', color: '#475569' };
    return { t: (key, values) => this.t(key, values), waiterName: waiter.name, waiterInitial: waiter.name ? waiter.name[0] : '', waiterAv: avatar(waiter.color, 44), switchWaiter: () => this.switchWaiter(), entry: !this.state.waiter, manager: () => this.requestManager(), signOut: () => this.signOut(), retryClear: () => this.switchWaiter(this.state.handoffNotice), switching: this.state.switching, recoveryRequired: this.state.recoveryRequired };
  }
  _changeIdentity() { const generation = this.state.identityGeneration + 1; this._set({ identityGeneration: generation }); return generation; }
  _current(generation) { return !this.disposed && generation === this.state.identityGeneration; }
  async login() {
    if (this.disposed || this.signingIn || this.selecting || this.switching || this.state.screen !== 'login') return;
    const { user, pass } = this.state;
    if (!user.trim() || !pass) { this.notify(this.t('Enter the restaurant username and password.'), 'err'); return; }
    if (!this.bridge) { this._set({ screen: 'waiter', pass: '', waiter: null }); return; }
    this.signingIn = true;
    const generation = this.state.identityGeneration;
    try {
      const result = await this.bridge.signIn(user, pass);
      if (!this._current(generation)) return;
      if (result.ok && result.admin) {
        this._changeIdentity();
        this._set({ screen: 'admin', pass: '', waiter: { name: result.name }, adminAccess: true });
      } else if (result.ok) {
        this._set({ screen: 'waiter', pass: '', waiter: null, waiterMessage: '', recoveryRequired: false });
        await this.loadEntryTables();
      } else { this._set({ pass: '' }); this.notify(this.t('Sign in failed.'), 'err'); }
    } catch (_) {
      if (this._current(generation)) { this._set({ pass: '' }); this.notify(this.t('Sign in failed.'), 'err'); }
    } finally { this.signingIn = false; }
  }
  async signOut() {
    if (this.disposed || this.signingIn || this.selecting || this.switching || !this.canLeave({ afterAction: false })) return;
    this.switching = true;
    const generation = this._changeIdentity();
    this.dismissSelectedOrder();
    if (this.bridge) this.clearProtectedData();
    this._set({ screen: 'waiter', waiter: null, pinFor: null, pin: '', adminAccess: false, switching: true });
    try {
      if (this.bridge && !(await this.bridge.signOut()).ok) throw new Error();
      if (!this._current(generation)) return;
      this._set({ screen: 'login', recoveryRequired: false, handoffNotice: '', user: '', pass: '' });
    } catch (_) {
      if (this._current(generation)) { this._set({ recoveryRequired: true, waiterMessage: this.t('Could not clear the session. Retry or sign out.') }); this.notify(this.t('Sign out failed.'), 'err'); }
    } finally {
      this.switching = false;
      if (this._current(generation)) this._set({ switching: false });
    }
  }
  requestTable(tableId) {
    if (this.disposed || this.signingIn || this.selecting || this.switching || this.state.screen !== 'waiter' || this.state.waiter || this.state.recoveryRequired || !this.canLeave({ afterAction: false })) return;
    this.pinOrigin = typeof document === 'undefined' ? null : document.activeElement;
    this._set({ pinFor: { tableId, isTransfer: false }, pin: '', waiterMessage: '' });
  }
  requestManager() {
    if (this.disposed || this.signingIn || this.selecting || this.switching || this.state.screen !== 'waiter' || this.state.waiter || this.state.recoveryRequired || !this.canLeave({ afterAction: false })) return;
    this.pinOrigin = typeof document === 'undefined' ? null : document.activeElement;
    this._set({ pinFor: { isTransfer: true }, pin: '', waiterMessage: '' });
  }
  setPin(pin) {
    if (this.disposed || this.selecting || this.switching || !this.state.pinFor) return;
    const length = this.state.pinFor.isTransfer ? 6 : 4;
    this._set({ pin: String(pin).replace(/[^0-9]/g, '').slice(0, length) });
  }
  pinPress(key) {
    if (this.disposed || this.selecting || this.switching || !this.state.pinFor) return;
    let pin = this.state.pin;
    if (key === 'Clear') pin = '';
    else if (key === 'Del') pin = pin.slice(0, -1);
    else if (/^[0-9]$/.test(key)) pin += key;
    this.setPin(pin);
  }
  cancelPin() {
    if (this.selecting || this.switching) return;
    const origin = this.pinOrigin; this.pinOrigin = null;
    this._set({ pinFor: null, pin: '', waiterMessage: '' });
    origin?.focus?.();
  }
  async submitPin() {
    if (this.disposed || this.selecting || this.switching || !this.state.pinFor || this.state.recoveryRequired) return;
    const target = this.state.pinFor, pin = this.state.pin;
    if (!(target.isTransfer ? /^\d{6}$/ : /^\d{4}$/).test(pin)) { this._set({ pin: '', waiterMessage: this.t('Enter a valid PIN.') }); return; }
    this.selecting = true;
    const generation = this._changeIdentity();
    this._set({ pin: '', switching: true, waiterMessage: '' });
    try {
      let result;
      if (this.bridge) result = await this.bridge.identifyStaff(pin, target.isTransfer ? 'transfer' : 'waiter');
      else {
        const staff = this.getDemoStaff();
        result = target.isTransfer ? { ok: false } : { ok: true, data: staff[Number(pin) % staff.length] };
      }
      if (!this._current(generation)) return;
      if (!result?.ok) throw new Error('denied');
      const waiter = { ...result.data, color: '#1D4ED8' };
      this.pinOrigin = null;
      this.clearProtectedData();
      this.dismissSelectedOrder();
      this._set({ waiter, adminAccess: false, pinFor: null, pin: '', screen: target.isTransfer ? 'transferCorrection' : 'waiter' });
      if (!target.isTransfer) {
        if (this.bridge) await this.loadProtectedData();
        if (!this._current(generation)) return;
        const opened = await this.openSelectedTable(target.tableId);
        if (!this._current(generation)) return;
        if (!opened) throw new Error('denied');
      }
    } catch (_) {
      if (!this._current(generation)) return;
      this.pinOrigin = null;
      this.clearProtectedData(); this.dismissSelectedOrder();
      this._set({ waiter: null, adminAccess: false, pinFor: null, pin: '', screen: 'waiter', waiterMessage: this.t('PIN or table access was denied.') });
      // A lost reply can still have selected an actor; clear before exposing the grid.
      if (this.bridge) {
        try { if (!(await this.bridge.clearWaiter()).ok) throw new Error(); }
        catch (_) { if (this._current(generation)) this._set({ recoveryRequired: true, waiterMessage: this.t('Could not clear the session. Retry or sign out.') }); return; }
        if (this._current(generation)) await this.loadEntryTables();
      }
    } finally {
      this.selecting = false;
      if (this._current(generation)) this._set({ switching: false });
    }
  }
  openAdministration() { if (this.state.adminAccess && this.canLeave({ afterAction: false })) this._set({ screen: 'admin' }); }
  switchWaiter(notice = '') { return this._switchWaiter(notice, false); }
  completeHandoff(notice = '') { return this._switchWaiter(notice, true); }
  async _switchWaiter(notice, afterAction) {
    if (this.disposed || this.selecting || this.switching || !this.canLeave({ afterAction })) return;
    this.switching = true;
    const generation = this._changeIdentity();
    this.dismissSelectedOrder();
    this.pinOrigin = null;
    if (this.bridge) this.clearProtectedData();
    this._set({ screen: 'waiter', waiter: null, pinFor: null, pin: '', adminAccess: false, switching: true, handoffNotice: notice, waiterMessage: '', recoveryRequired: false });
    try {
      if (this.bridge) {
        try { if (!(await this.bridge.clearWaiter()).ok) throw new Error(); }
        catch (_) { if (this._current(generation)) this._set({ recoveryRequired: true, waiterMessage: this.t('Could not clear the session. Retry or sign out.') }); return; }
        if (this._current(generation)) await this.loadEntryTables();
      }
    } finally { this.switching = false; if (this._current(generation)) this._set({ switching: false }); }
  }
  async refreshAdminAccess(generation) {
    if (this.switching || !this._current(generation)) return false;
    const result = await this.bridge.adminAccess();
    if (this.switching || !this._current(generation)) return false;
    if (!result.ok || !result.signedIn || !result.selected || !result.admin) {
      this.clearProtectedData(); this.dismissSelectedOrder();
      this._set({ adminAccess: false, waiter: null, screen: 'login', waiterMessage: this.t('Session or administration access changed. Sign in again.') });
      return false;
    }
    return true;
  }
  accountView() {
    const state = this.state, t = (key, values) => this.t(key, values), selected = state.pinFor;
    return {
      t, isLogin: state.screen === 'login', isWaiters: false, isPin: !!selected,
      user: state.user, pass: state.pass, onUser: event => this.setUsername(event.target.value), onPass: event => this.setPassword(event.target.value), login: () => this.login(),
      switching: state.switching, handoffNotice: state.handoffNotice, waiterMessage: state.waiterMessage, desktop: !!this.bridge,
      pinName: '', pinInitial: '', pinAv: avatar('#475569', 84), pinPrompt: t(selected?.isTransfer ? 'Enter the manager 6-digit PIN' : 'Enter your 4-digit PIN'),
      pin: state.pin, onPin: event => this.setPin(event.target.value), submitPin: () => this.submitPin(), pinTarget: selected?.isTransfer ? t('Manager') : t('Table {id}', { id: selected?.tableId }),
      pinDots: Array.from({ length: selected?.isTransfer ? 6 : 4 }, (_, index) => ({ style: index < state.pin.length ? 'width:22px; height:22px; border-radius:999px; background:#0F172A' : 'width:22px; height:22px; border-radius:999px; border:3px solid #94A3B8; box-sizing:border-box' })),
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'].map(key => ({ label: key === 'Del' ? t('Delete') : key === 'Clear' ? t('Clear') : key, aria: key === 'Del' ? t('Delete last digit') : key === 'Clear' ? t('Clear PIN') : t('Digit {digit}', { digit: key }), press: () => this.pinPress(key), style: 'height:64px; border-radius:18px; border:2px solid #E2E8F0; background:' + (key.length > 1 ? '#F1F5F9' : '#FFFFFF') + '; color:#0F172A; font-size:' + (key.length > 1 ? '18px' : '28px') + '; font-weight:800' })),
      pinBack: () => this.cancelPin(),
    };
  }
}
