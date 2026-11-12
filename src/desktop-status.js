(async () => {
  const status = document.getElementById('application-status');
  const mode = document.body.dataset.mode;
  let language = 'en';
  if (window.arra?.language) { try { const r = await window.arra.language({action:'get'}); if (r.ok && r.language === 'sq') language = 'sq'; } catch (_) {} }
  window.addEventListener('arra-language-changed', event => { language = event.detail; if (status.dataset.key) status.textContent = status.dataset.key === 'status.development' ? 'Arra POS · ' + t(status.dataset.key) : t(status.dataset.key); });
  const t = key => typeof ArraComponents !== 'undefined' && ArraComponents.translate ? ArraComponents.translate(language, key) : 'Desktop application unavailable. Close and restart Arra POS; seek support if the problem continues. / Aplikacioni nuk është i disponueshëm. Mbyllni dhe rinisni Arra POS; kërkoni ndihmë nëse problemi vazhdon.';
  const fail = () => {
    status.setAttribute('role', 'alert');
    status.dataset.key = 'status.unavailable'; status.textContent = t(status.dataset.key);
  };
  if (typeof ArraComponents === 'undefined' || !ArraComponents.translate || typeof React === 'undefined' || typeof ReactDOM === 'undefined') { fail(); return; }
  if (mode === 'demo' && !window.arra) {
    status.dataset.key = 'status.demo'; status.textContent = t(status.dataset.key);
  } else if (mode === 'desktop' && window.arra) {
    try {
      const result = await window.arra.getApplicationInfo();
      if (!result.ok) { fail(); return; }
      status.dataset.key = 'status.development'; status.textContent = `${result.data.name} · ${t(status.dataset.key)}`;
    } catch (_) { fail(); return; }
  } else { fail(); return; }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WaiterDemo));
})();
