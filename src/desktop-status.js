import { desktopBridge } from './shared/desktop-bridge.js';
import { translate } from './shared/i18n.js';

const unavailable = 'Desktop application unavailable. Close and restart Arra POS; seek support if the problem continues. / Aplikacioni nuk eshte i disponueshem. Mbyllni dhe rinisni Arra POS; kerkoni ndihme nese problemi vazhdon.';
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
  let appName = 'Arra POS';
  let active = true;
  let stopWatchingPrinter;
  if (desktopBridge?.language) { try { const r = await desktopBridge.language({action:'get'}); if (r.ok && r.language === 'sq') language = 'sq'; } catch (_) {} }
  const t = key => translate(language, key);
  const setStatus = key => {
    status.dataset.key = key;
    status.textContent = key === 'status.development' ? appName + ' · ' + t(key) : t(key);
  };
  const changeLanguage = event => { language = event.detail; if (status.dataset.key) setStatus(status.dataset.key); };
  window.addEventListener('arra-language-changed', changeLanguage);
  window.addEventListener('pagehide', () => {
    active = false;
    stopWatchingPrinter?.();
    window.removeEventListener('arra-language-changed', changeLanguage);
  }, { once: true });
  const fail = (runtimeMissing = false) => {
    status.setAttribute('role', 'alert');
    status.dataset.key = 'status.unavailable'; status.textContent = runtimeMissing ? unavailable : t(status.dataset.key);
  };
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') { fail(true); return; }
  if (mode === 'demo' && !desktopBridge) {
    setStatus('status.demo');
  } else if (mode === 'desktop' && desktopBridge) {
    try {
      const result = await desktopBridge.getApplicationInfo();
      if (!result.ok) { fail(); return; }
      appName = result.data.name;
      setStatus('status.development');
    } catch (_) { fail(); return; }
  } else { fail(); return; }
  try {
    const { WaiterDemo } = await loadApp();
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WaiterDemo));
  } catch (_) { fail(); return; }

  if (mode !== 'desktop' || !active || !desktopBridge.onFiscalPrinterWaiting || !desktopBridge.getFiscalPrinterWaiting) return;
  const showPrinterWaiting = waiting => {
    if (!active || typeof waiting !== 'boolean') return;
    const key = waiting ? 'status.waitingForPrinter' : 'status.development';
    if (status.dataset.key === key) return;
    status.setAttribute('role', waiting ? 'alert' : 'status');
    setStatus(key);
  };
  let receivedChange = false;
  stopWatchingPrinter = desktopBridge.onFiscalPrinterWaiting(waiting => {
    receivedChange = true;
    showPrinterWaiting(waiting);
  });
  desktopBridge.getFiscalPrinterWaiting().then(waiting => {
    if (!receivedChange) showPrinterWaiting(waiting);
  }).catch(() => {});
}
