const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arra', Object.freeze({
  async getApplicationInfo() {
    try {
      const response = await ipcRenderer.invoke('arra:application-info', {});
      if (response && response.ok === true && response.data &&
          response.data.name === 'Arra POS' && response.data.mode === 'development') {
        return { ok: true, data: { name: response.data.name, mode: response.data.mode } };
      }
    } catch (_) {
      // Do not expose internal IPC errors to the screen.
    }
    return { ok: false, error: 'Application information unavailable' };
  },
  async getTables() {
    try {
      const response = await ipcRenderer.invoke('arra:tables', {});
      if (response && response.ok === true && Array.isArray(response.data) &&
          response.data.every(t => t && Number.isSafeInteger(t.id) && t.id > 0 &&
            typeof t.area === 'string' && t.area.trim().length > 0)) {
        return { ok: true, data: response.data.map(t => ({ id: t.id, area: t.area })) };
      }
    } catch (_) {
      // Do not expose internal IPC errors to the screen.
    }
    return { ok: false, error: 'Tables unavailable. Restart the app and try again.' };
  },
}));
