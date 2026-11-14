import { desktopBridge } from './shared/desktop-bridge.js';
import { translate } from './shared/i18n.js';

const unavailable = 'Desktop application unavailable. Close and restart Arra POS; seek support if the problem continues. / Aplikacioni nuk është i disponueshëm. Mbyllni dhe rinisni Arra POS; kërkoni ndihmë nëse problemi vazhdon.';
let startup;

// Repeated callers share the probe and cannot mount a second root.
export function startRenderer(loadApp) {
  if (!startup) startup = mountRenderer(loadApp);
  return startup;
}

async function mountRenderer(loadApp) {
  const status = document.getElementById('application-status');
  const mode = document.body.dataset.mode;
  let language = 'en';
  if (desktopBridge?.language) { try { const r = await desktopBridge.language({action:'get'}); if (r.ok && r.language === 'sq') language = 'sq'; } catch (_) {} }
  const t = key => translate(language, key);
  const changeLanguage = event => { language = event.detail; if (status.dataset.key) status.textContent = status.dataset.key === 'status.development' ? 'Arra POS · ' + t(status.dataset.key) : t(status.dataset.key); };
  window.addEventListener('arra-language-changed', changeLanguage);
  window.addEventListener('pagehide', () => window.removeEventListener('arra-language-changed', changeLanguage), { once: true });
  const fail = (runtimeMissing = false) => {
    status.setAttribute('role', 'alert');
    status.dataset.key = 'status.unavailable'; status.textContent = runtimeMissing ? unavailable : t(status.dataset.key);
  };
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') { fail(true); return; }
  if (mode === 'demo' && !desktopBridge) {
    status.dataset.key = 'status.demo'; status.textContent = t(status.dataset.key);
  } else if (mode === 'desktop' && desktopBridge) {
    try {
      const result = await desktopBridge.getApplicationInfo();
      if (!result.ok) { fail(); return; }
      status.dataset.key = 'status.development'; status.textContent = `${result.data.name} · ${t(status.dataset.key)}`;
    } catch (_) { fail(); return; }
  } else { fail(); return; }
  try {
    const { WaiterDemo } = await loadApp();
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WaiterDemo));
  } catch (_) { fail(); }
}
