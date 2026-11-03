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
}));
