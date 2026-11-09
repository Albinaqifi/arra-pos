(async () => {
  const status = document.getElementById('application-status');
  const mode = document.body.dataset.mode;
  const fail = () => {
    status.setAttribute('role', 'alert');
    status.textContent = 'Desktop application unavailable. Close and restart Arra POS; seek support if the problem continues.';
  };
  if (mode === 'demo' && !window.arra) {
    status.textContent = 'Browser demo — sample data and simulated actions only';
  } else if (mode === 'desktop' && window.arra) {
    try {
      const result = await window.arra.getApplicationInfo();
      if (!result.ok) { fail(); return; }
      status.textContent = `${result.data.name} · ${result.data.mode}`;
    } catch (_) { fail(); return; }
  } else { fail(); return; }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(WaiterDemo));
})();
