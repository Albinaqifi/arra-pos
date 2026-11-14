import { FeatureState } from '../shared/FeatureState.js';
import { desktopBridge } from '../shared/desktop-bridge.js';
import { LanguageSetting } from '../admin/LanguageSetting.jsx';

export class LanguageSettings extends FeatureState {
  constructor({ bridge = desktopBridge } = {}) {
    super({ language: 'en', busy: false, feedback: '' });
    this.bridge = bridge;
    this.generation = 0;
  }
  async load() {
    if (!this.bridge?.language) return;
    const generation = ++this.generation;
    try {
      const result = await this.bridge.language({ action: 'get' });
      if (!this.disposed && generation === this.generation && result.ok && ['en', 'sq'].includes(result.language)) this._set({ language: result.language });
    } catch (_) { /* Retain the bundled default when the preference is unavailable. */ }
  }
  async changeLanguage(language) {
    if (this.disposed || this.state.busy || !this.bridge?.language || !['en', 'sq'].includes(language)) return;
    const generation = ++this.generation;
    this._set({ busy: true, feedback: '' });
    let result;
    try { result = await this.bridge.language({ action: 'set', language }); } catch (_) { result = { ok: false }; }
    if (this.disposed || generation !== this.generation) return;
    if (result.ok && ['en', 'sq'].includes(result.language)) {
      this._set({ language: result.language, busy: false, feedback: 'saved' });
      if (typeof CustomEvent === 'function' && typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new CustomEvent('arra-language-changed', { detail: result.language }));
    } else this._set({ busy: false, feedback: 'failed' });
  }
  render() { return React.createElement(LanguageSetting, { ...this.state, onChange: language => this.changeLanguage(language) }); }
}
