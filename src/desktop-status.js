(async () => {
  const status = document.getElementById('application-status');
  if (!window.arra) {
    status.textContent = 'Browser demo';
    return;
  }
  const result = await window.arra.getApplicationInfo();
  status.textContent = result.ok ? `${result.data.name} · ${result.data.mode}` : result.error;
})();
