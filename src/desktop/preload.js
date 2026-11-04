const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arra', Object.freeze({
  async operationalReports(request) {
    try { return await ipcRenderer.invoke('arra:operational-reports', request); } catch (_) { return { ok: false }; }
  },
  async transferCorrection(request) {
    try { return await ipcRenderer.invoke('arra:transfer-correction', request); } catch (_) { return { ok: false }; }
  },
  async businessDays(request) {
    try { return await ipcRenderer.invoke('arra:business-days', request); } catch (_) { return { ok: false }; }
  },
  async financialVisibility(request) {
    try { return await ipcRenderer.invoke('arra:financial-visibility', request); } catch (_) { return { ok: false }; }
  },
  async payment(request) {
    try { return await ipcRenderer.invoke('arra:payment', request); } catch (_) { return { ok: false, uncertain: true, error: 'Payment result unknown. Retry the same selection.' }; }
  },
  async bill(request) {
    try { return await ipcRenderer.invoke('arra:bill', request); } catch (_) { return { ok: false, error: 'Bill unavailable' }; }
  },
  async orderHistory(orderId) {
    if (orderId !== null && (!Number.isSafeInteger(orderId) || orderId <= 0)) return { ok: false };
    try { return await ipcRenderer.invoke('arra:order-history', { orderId }); } catch (_) { return { ok: false }; }
  },
  async printJobs(request) {
    try { return await ipcRenderer.invoke('arra:print-jobs', request); }
    catch (_) { return { ok: false, error: 'Print jobs unavailable. Try again.' }; }
  },
  async employeeConfig(request) {
    try { return await ipcRenderer.invoke('arra:employee-config', request); }
    catch (_) { return { ok: false, error: 'Employee configuration unavailable' }; }
  },
  async menuConfig(request) {
    try { return await ipcRenderer.invoke('arra:menu-config', request); }
    catch (_) { return { ok: false, error: 'Configuration unavailable' }; }
  },
  async tableConfig(request) {
    try {
      const r = await ipcRenderer.invoke('arra:table-config', request);
      if (r?.ok && request?.action === 'list' && Array.isArray(r.data?.areas) && Array.isArray(r.data?.tables))
        return { ok: true, data: { areas: r.data.areas.map(a => ({ id: a.id, name: a.name, active: a.active })), tables: r.data.tables.map(t => ({ id: t.id, areaId: t.areaId, capacity: t.capacity, active: t.active, hasOrder: t.hasOrder })) } };
      if (r?.ok && request?.action !== 'list') return { ok: true };
      return { ok: false, error: typeof r?.error === 'string' ? r.error : 'Configuration unavailable' };
    } catch (_) { return { ok: false, error: 'Configuration unavailable' }; }
  },
  async getWaiters() {
    try {
      const r = await ipcRenderer.invoke('arra:waiters', {});
      if (r?.ok && Array.isArray(r.data) && r.data.every(w => Number.isSafeInteger(w.id) && w.id > 0 && typeof w.name === 'string' && w.name.trim() && typeof w.hasPin === 'boolean'))
        return { ok: true, data: r.data.map(w => ({ id: w.id, name: w.name, hasPin: w.hasPin, isTransfer: w.isTransfer === true })) };
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
        !['list', 'add', 'increment', 'decrement', 'remove', 'note', 'send', 'correct'].includes(action)) return { ok: false };
    const request = { action, orderId };
    if (action === 'correct') {
      if (!value || !Number.isSafeInteger(value.itemId) || !Number.isSafeInteger(value.quantity) || typeof value.reason !== 'string' || typeof value.requestId !== 'string') return { ok: false };
      Object.assign(request, { itemId: value.itemId, quantity: value.quantity, reason: value.reason, requestId: value.requestId });
    } else if (action === 'send') {
      if (typeof value !== 'string') return { ok: false };
      request.requestId = value;
    } else if (action === 'add') {
      if (typeof value === 'string' && value.trim()) request.productId = value;
      else if (value && typeof value.productId === 'string' && Array.isArray(value.optionIds)) { request.productId = value.productId; request.optionIds = value.optionIds; }
      else return { ok: false };
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
          id: i.id, productId: i.productId, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity, note: i.note, status: i.status, round: i.round, sentAt: i.sentAt, sentBy: i.sentBy, route: i.route, modifiers: i.modifiers || [], correctedQuantity: i.correctedQuantity || 0, corrections: i.corrections || []
        })) } };
      }
      if (action === 'correct' && response?.ok === false) return { ok: false, rejected: true };
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
          products: response.data.products.map(p => ({ id: p.id, categoryId: p.categoryId, name: p.name, price: p.price })),
          groups: response.data.groups || [], options: response.data.options || []
        } };
      }
    } catch (_) {
      // Do not expose internal IPC errors to the screen.
    }
    return { ok: false, error: 'Menu unavailable. Restart the app and try again.' };
  },
  async moveItems(orderId, sourceId, destinationId, destinationOrderId, itemIds, requestId) {
    try {
      const r = await ipcRenderer.invoke('arra:move-items', { orderId, sourceId, destinationId, destinationOrderId, itemIds, requestId });
      return r?.ok ? { ok: true } : r?.rejected ? { ok: false, rejected: true } : { ok: false };
    } catch (_) { return { ok: false }; }
  },
  async moveOrder(orderId, sourceId, destinationId, requestId) {
    if (![orderId, sourceId, destinationId].every(x => Number.isSafeInteger(x) && x > 0) || typeof requestId !== 'string') return { ok: false };
    try { return (await ipcRenderer.invoke('arra:move-order', { orderId, sourceId, destinationId, requestId }))?.ok ? { ok: true } : { ok: false }; }
    catch (_) { return { ok: false }; }
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
