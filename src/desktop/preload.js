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
  async getMenu() {
    try {
      const response = await ipcRenderer.invoke('arra:menu', {});
      const validText = x => typeof x === 'string' && x.trim().length > 0;
      if (response && response.ok === true && response.data &&
          Array.isArray(response.data.categories) && Array.isArray(response.data.products) &&
          response.data.categories.every(c => c && validText(c.id) && validText(c.name)) &&
          response.data.products.every(p => p && validText(p.id) && validText(p.categoryId) &&
            validText(p.name) && Number.isSafeInteger(p.price) && p.price >= 0 &&
            response.data.categories.some(c => c.id === p.categoryId))) {
        return { ok: true, data: {
          categories: response.data.categories.map(c => ({ id: c.id, name: c.name })),
          products: response.data.products.map(p => ({ id: p.id, categoryId: p.categoryId, name: p.name, price: p.price }))
        } };
      }
    } catch (_) {
      // Do not expose internal IPC errors to the screen.
    }
    return { ok: false, error: 'Menu unavailable. Restart the app and try again.' };
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
