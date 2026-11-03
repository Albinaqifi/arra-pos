const CHANNEL = 'arra:application-info';

// This operation has no parameters. Reject any unexpected request data.
function applicationInfo(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.getPrototypeOf(request) !== Object.prototype || Reflect.ownKeys(request).length !== 0) {
    return { ok: false, error: 'Invalid request' };
  }
  return { ok: true, data: { name: 'Arra POS', mode: 'development' } };
}

function registerApplicationInfo(ipcMain, isAllowedSender) {
  ipcMain.handle(CHANNEL, (event, request) => {
    if (!isAllowedSender(event)) return { ok: false, error: 'Invalid request' };
    return applicationInfo(request);
  });
}

module.exports = { CHANNEL, applicationInfo, registerApplicationInfo };
