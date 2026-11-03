const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arra', Object.freeze({
  async getWaiters() {
    try {
      const r = await ipcRenderer.invoke('arra:waiters', {});
      if (r?.ok && Array.isArray(r.data) && r.data.every(w => Number.isSafeInteger(w.id) && w.id > 0 && typeof w.name === 'string' && w.name.trim() && typeof w.hasPin === 'boolean'))
        return { ok: true, data: r.data.map(w => ({ id: w.id, name: w.name, hasPin: w.hasPin })) };
    } catch (_) {}
    return { ok: false };
  },
  async selectWaiter(id, pin) {
    if (!Number.isSafeInteger(id) || id <= 0 || typeof pin !== 'string') return { ok: false };
    try { return (await ipcRenderer.invoke('arra:select-waiter', { id, pin }))?.ok ? { ok: true } : { ok: false }; } catch (_) { return { ok: false }; }
  },
  async clearWaiter() {
    try { return (await ipcRenderer.invoke('arra:clear-waiter', {}))?.ok ? { ok: true } : { ok: false }; } catch (_) { return { ok: false }; }
  },
  async signIn(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') return { ok: false };
    try {
      const result = await ipcRenderer.invoke('arra:sign-in', { username, password });
      if (result && result.ok === true) return { ok: true };
    } catch (_) {}
    return { ok: false, error: 'Sign in failed' };
  },
  async signOut() {
    try {
      const result = await ipcRenderer.invoke('arra:sign-out', {});
      if (result && result.ok === true) return { ok: true };
    } catch (_) {}
    return { ok: false, error: 'Sign out failed' };
  },
  async orderItems(action, orderId, value) {
    if (!Number.isSafeInteger(orderId) || orderId <= 0 ||
        !['list', 'add', 'increment', 'decrement', 'remove', 'note'].includes(action)) return { ok: false };
    const request = { action, orderId };
    if (action === 'add') {
      if (typeof value !== 'string' || !value.trim()) return { ok: false };
      request.productId = value;
    } else if (action === 'note') {
      if (!value || !Number.isSafeInteger(value.itemId) || value.itemId <= 0 || typeof value.note !== 'string') return { ok: false };
      request.itemId = value.itemId; request.note = value.note;
    } else if (action !== 'list') {
      if (!Number.isSafeInteger(value) || value <= 0) return { ok: false };
      request.itemId = value;
    }
    try {
      const response = await ipcRenderer.invoke('arra:order-items', request);
      const data = response && response.data;
      if (response && response.ok === true && data && Array.isArray(data.items) &&
          Number.isSafeInteger(data.total) && data.total >= 0 && data.items.every(i =>
            i && Number.isSafeInteger(i.id) && i.id > 0 && typeof i.productId === 'string' &&
            typeof i.name === 'string' && i.name.trim() && Number.isSafeInteger(i.unitPrice) && i.unitPrice >= 0 &&
            Number.isSafeInteger(i.quantity) && i.quantity > 0 && typeof i.note === 'string')) {
        return { ok: true, data: { total: data.total, items: data.items.map(i => ({
          id: i.id, productId: i.productId, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity, note: i.note
        })) } };
      }
    } catch (_) {}
    return { ok: false, error: 'Could not update order items' };
  },
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
  async openOrder(tableId) {
    if (!Number.isSafeInteger(tableId) || tableId <= 0) return { ok: false, error: 'Invalid request' };
    try {
      const response = await ipcRenderer.invoke('arra:open-order', { tableId });
      const o = response && response.data;
      if (response && response.ok === true && o && Number.isSafeInteger(o.id) && o.id > 0 &&
          o.tableId === tableId && Number.isSafeInteger(o.openedAt) && o.openedAt > 0)
        return { ok: true, data: { id: o.id, tableId: o.tableId, openedAt: o.openedAt } };
    } catch (_) {}
    return { ok: false, error: 'Could not open table. Try again.' };
  },
  async getTables() {
    try {
      const response = await ipcRenderer.invoke('arra:tables', {});
      if (response && response.ok === true && Array.isArray(response.data) &&
          response.data.every(t => t && Number.isSafeInteger(t.id) && t.id > 0 &&
            typeof t.area === 'string' && t.area.trim().length > 0 &&
            ((t.orderId === null && t.openedAt === null) ||
             (Number.isSafeInteger(t.orderId) && t.orderId > 0 && Number.isSafeInteger(t.openedAt) && t.openedAt > 0)))) {
        return { ok: true, data: response.data.map(t => ({ id: t.id, area: t.area, orderId: t.orderId, openedAt: t.openedAt })) };
      }
    } catch (_) {
      // Do not expose internal IPC errors to the screen.
    }
    return { ok: false, error: 'Tables unavailable. Restart the app and try again.' };
  },
}));
