import { FeatureState } from '../shared/FeatureState.js';
import { desktopBridge } from '../shared/desktop-bridge.js';
import { waiterTranslate } from '../shared/waiter-ui.js';

const avatar = (color, size) => 'width:' + size + 'px; height:' + size + 'px; border-radius:999px; background:' + color + '; color:#FFFFFF; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:' + Math.round(size * 0.42) + 'px; flex:none';

export class SessionModel extends FeatureState {
  constructor({ bridge = desktopBridge, canLeave, clearProtectedData, dismissSelectedOrder, loadProtectedData, notify, getLanguage, getDemoStaff }) {
    super({ screen: 'login', user: '', pass: '', waiter: null, pinFor: null, pin: '', waiters: bridge ? [] : getDemoStaff(), waiterMessage: '', switching: false, handoffNotice: '', adminAccess: false, identityGeneration: 0 });
    Object.assign(this, { bridge, canLeave, clearProtectedData, dismissSelectedOrder, loadProtectedData, notify, getLanguage });
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  setUsername(user) { this._set({ user }); }
  setPassword(pass) { this._set({ pass }); }
  identity() { return { generation: this.state.identityGeneration, name: this.state.waiter?.name, adminAccess: this.state.adminAccess }; }
  _changeIdentity() { const generation = this.state.identityGeneration + 1; this._set({ identityGeneration: generation }); return generation; }
  _current(generation) { return !this.disposed && generation === this.state.identityGeneration; }
  async login() {
    if (this.disposed || this.signingIn) return;
    const { user, pass } = this.state;
    if (!user.trim() || !pass) { this.notify(this.t('Enter the restaurant username and password.'), 'err'); return; }
    if (!this.bridge) { this._set({ screen: 'waiters', pass: '' }); return; }
    this.signingIn = true;
    const generation = this.state.identityGeneration;
    try {
      const result = await this.bridge.signIn(user, pass);
      if (!this._current(generation)) return;
      if (result.ok && result.admin) {
        this._changeIdentity();
        this._set({ screen: 'admin', pass: '', waiter: { name: result.name }, adminAccess: true });
      } else if (result.ok) {
        this._set({ screen: 'waiters', pass: '', waiters: [], waiterMessage: this.t('Loading waiters…') });
        await this.loadWaiters();
      } else { this._set({ pass: '' }); this.notify(this.t('Sign in failed.'), 'err'); }
    } catch (_) {
      if (this._current(generation)) { this._set({ pass: '' }); this.notify(this.t('Sign in failed.'), 'err'); }
    } finally { this.signingIn = false; }
  }
  async signOut() {
    if (this.disposed || this.selecting || this.switching || !this.canLeave({ afterAction: false })) return;
    const generation = this._changeIdentity();
    if (this.bridge) {
      this.clearProtectedData();
      try {
        if (!(await this.bridge.signOut()).ok) throw new Error();
      } catch (_) { if (this._current(generation)) this.notify(this.t('Sign out failed.'), 'err'); return; }
    }
    if (!this._current(generation)) return;
    this.dismissSelectedOrder();
    this._set({ screen: 'login', waiter: null, adminAccess: false, user: '', pass: '' });
  }
  async loadWaiters() {
    const generation = this.state.identityGeneration;
    try {
      const result = await this.bridge.getWaiters();
      if (!this._current(generation)) return;
      if (!result.ok) throw new Error();
      this._set({ waiters: result.data.map(waiter => ({ id: waiter.id, name: waiter.name, pin: waiter.hasPin, isTransfer: waiter.isTransfer, color: '#1D4ED8' })), waiterMessage: result.data.length ? '' : this.t('No active waiters available.') });
    } catch (_) {
      if (this._current(generation)) this._set({ waiters: [], waiterMessage: this.t('Waiters unavailable. Sign out and try again.') });
    }
  }
  async chooseWaiter(waiter, pin) {
    if (this.disposed || this.selecting || this.switching) return;
    this.selecting = true;
    const generation = this._changeIdentity();
    try {
      const selection = this.bridge ? await this.bridge.selectWaiter(waiter.id, pin) : { ok: true, admin: false };
      if (!this._current(generation)) return;
      if (!selection.ok) throw new Error();
      if (this.bridge) this.clearProtectedData();
      this.dismissSelectedOrder();
      this._set({ waiter, adminAccess: selection.admin === true, pin: '', screen: waiter.isTransfer ? 'transferCorrection' : 'waiter' });
      if (this.bridge && !waiter.isTransfer) this.loadProtectedData();
    } catch (_) {
      if (this._current(generation)) { this._set({ pin: '' }); this.notify(this.t('Waiter selection failed.'), 'err'); }
    } finally { this.selecting = false; }
  }
  pickWaiter(waiter) {
    if (this.disposed || this.switching) return;
    const selected = { id: waiter.id, name: waiter.name, color: waiter.color, isTransfer: waiter.isTransfer };
    if (this.bridge || waiter.pin) this._set({ pinFor: selected, pin: '', screen: 'pin' });
    else return this.chooseWaiter(selected, '');
  }
  pinPress(key) {
    if (this.disposed || this.switching) return;
    let pin = this.state.pin;
    if (key === 'Clear') pin = '';
    else if (key === 'Del') pin = pin.slice(0, -1);
    const length = this.state.pinFor?.isTransfer ? 6 : 4;
    if (key !== 'Clear' && key !== 'Del' && pin.length < length) pin += key;
    if (pin.length === length) { this._set({ pin: '' }); return this.chooseWaiter(this.state.pinFor, pin); }
    this._set({ pin });
  }
  backToStaff() { this._set({ screen: 'waiters', pin: '' }); }
  openAdministration() { if (this.state.adminAccess && this.canLeave({ afterAction: false })) this._set({ screen: 'admin' }); }
  switchWaiter(notice = '') { return this._switchWaiter(notice, false); }
  completeHandoff(notice = '') { return this._switchWaiter(notice, true); }
  async _switchWaiter(notice, afterAction) {
    if (this.disposed || this.selecting || this.switching || !this.canLeave({ afterAction })) return;
    this.switching = true;
    const generation = this._changeIdentity();
    try {
      if (this.bridge) {
        this._set({ screen: 'waiters', adminAccess: false, waiter: null, switching: true, waiterMessage: this.t('Switching user…'), handoffNotice: notice });
        this.dismissSelectedOrder();
        try { if (!(await this.bridge.clearWaiter()).ok) throw new Error(); }
        catch (_) {
          if (this._current(generation)) this._set({ waiterMessage: this.t('Could not switch user. Choose a name or sign out to retry.') });
          return;
        }
      }
      if (!this._current(generation)) return;
      if (this.bridge) this.clearProtectedData();
      this.dismissSelectedOrder();
      this._set({ waiter: null, screen: 'waiters', handoffNotice: notice });
      if (this.bridge) await this.loadWaiters();
    } finally {
      this.switching = false;
      if (this._current(generation)) this._set({ switching: false });
    }
  }
  async refreshAdminAccess(generation) {
    if (this.switching || !this._current(generation)) return false;
    const result = await this.bridge.adminAccess();
    if (this.switching || !this._current(generation)) return false;
    if (!result.ok || !result.signedIn || !result.selected || !result.admin) {
      this.clearProtectedData();
      const selected = result.ok && result.signedIn && result.selected;
      this.dismissSelectedOrder();
      this._set({ adminAccess: false, waiter: selected ? this.state.waiter : null, screen: selected ? 'waiter' : result.ok && !result.signedIn ? 'login' : 'waiters', waiterMessage: this.t('Session or administration access changed. Sign in or select your name again.') });
      if (selected) this.loadProtectedData();
      return false;
    }
    return true;
  }
  accountView() {
    const state = this.state, t = (key, values) => this.t(key, values);
    const selected = state.pinFor || { name: '', color: '#475569' };
    return {
      t, isLogin: state.screen === 'login', isWaiters: state.screen === 'waiters', isPin: state.screen === 'pin',
      user: state.user, pass: state.pass, onUser: event => this.setUsername(event.target.value), onPass: event => this.setPassword(event.target.value), login: () => this.login(),
      switching: state.switching, handoffNotice: state.handoffNotice, waiterMessage: state.waiterMessage, desktop: !!this.bridge,
      waiters: state.waiters.map(waiter => ({ name: waiter.name, initial: waiter.name[0], avStyle: avatar(waiter.color, 76), hasPin: waiter.pin, noPin: !waiter.pin, pick: () => this.pickWaiter(waiter) })), signOut: () => this.signOut(),
      pinName: selected.name, pinInitial: selected.name ? selected.name[0] : '', pinAv: avatar(selected.color, 84), pinPrompt: t(selected.isTransfer ? 'Enter your 6-digit PIN' : 'Enter your 4-digit PIN'),
      pinDots: Array.from({ length: selected.isTransfer ? 6 : 4 }, (_, index) => ({ style: index < state.pin.length ? 'width:22px; height:22px; border-radius:999px; background:#0F172A' : 'width:22px; height:22px; border-radius:999px; border:3px solid #94A3B8; box-sizing:border-box' })),
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Del'].map(key => ({ label: key === 'Del' ? t('Delete') : key === 'Clear' ? t('Clear') : key, aria: key === 'Del' ? t('Delete last digit') : key === 'Clear' ? t('Clear PIN') : t('Digit {digit}', { digit: key }), press: () => this.pinPress(key), style: 'height:76px; border-radius:18px; border:2px solid #E2E8F0; background:' + (key.length > 1 ? '#F1F5F9' : '#FFFFFF') + '; color:#0F172A; font-size:' + (key.length > 1 ? '18px' : '32px') + '; font-weight:800' })),
      pinBack: () => this.backToStaff(),
    };
  }
}
