import { FeatureState } from '../shared/FeatureState.js';

export class ShellModel extends FeatureState {
  constructor({ now = () => Date.now(), scheduleInterval = (fn, delay) => setInterval(fn, delay), cancelInterval = id => clearInterval(id), scheduleTimeout = (fn, delay) => setTimeout(fn, delay), cancelTimeout = id => clearTimeout(id) } = {}) {
    super({ now: now(), toast: null });
    Object.assign(this, { now, scheduleInterval, cancelInterval, scheduleTimeout, cancelTimeout });
    this.started = false;
    this.toastSequence = 0;
  }
  start() {
    if (this.disposed || this.started) return;
    this.started = true;
    this.interval = this.scheduleInterval(() => { if (!this.disposed) this._set({ now: this.now() }); }, 20000);
  }
  notify(message, kind = 'ok') {
    if (this.disposed) return;
    const sequence = ++this.toastSequence;
    this.cancelTimeout(this.timeout);
    this._set({ toast: { msg: message, kind } });
    this.timeout = this.scheduleTimeout(() => {
      if (!this.disposed && sequence === this.toastSequence) this._set({ toast: null });
    }, 4200);
  }
  view() {
    const now = this.now(), date = new Date(now), toast = this.state.toast;
    const color = toast?.kind === 'err' ? 'background:#DC2626; color:#FFFFFF' : toast?.kind === 'warn' ? 'background:#FDE047; color:#1A1400' : 'background:#0F172A; color:#FFFFFF';
    return {
      now, clock: String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'),
      hasToast: !!toast, toastText: toast?.msg || '',
      toastStyle: 'position:fixed; left:50%; bottom:28px; transform:translateX(-50%); max-width:min(720px, calc(100vw - 32px)); padding:16px 24px; border-radius:16px; font-size:18px; font-weight:800; line-height:1.35; z-index:80; box-shadow:0 18px 40px rgba(15,23,42,0.3); ' + color,
    };
  }
  dispose() {
    this.toastSequence++;
    this.cancelInterval(this.interval); this.cancelTimeout(this.timeout);
    super.dispose();
  }
}
