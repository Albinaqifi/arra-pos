const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: delay } = require('node:timers/promises');

function ledgerDirectory() {
  if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) throw Error('Receipt ledger unavailable');
  return path.join(process.env.LOCALAPPDATA, 'Arra POS', 'PF700 commissioning', 'fast-pay-v1');
}

function tryAcquire(file) {
  // Node's SQLite busy timeout defaults to zero. Never wait on the Electron main thread.
  const lock = new DatabaseSync(file);
  try {
    lock.exec('BEGIN IMMEDIATE');
    return lock;
  } catch (error) {
    lock.close();
    if (error.errcode === 5 || error.errcode === 6) return null;
    throw error;
  }
}

// Cash slips and receipt workers on this POS use the same crash-released lock.
// Only local lock acquisition is retried. No command has reached the printer yet.
function createFastPayPrinterAccess() {
  const listeners = new Set();
  let waiting = 0;
  function changeWaiting(delta) {
    const previous = waiting;
    waiting += delta;
    if ((previous === 0) !== (waiting === 0)) {
      for (const listener of listeners) {
        try { listener(waiting > 0); } catch (_) { /* A closing window cannot interrupt printing. */ }
      }
    }
  }
  return {
    isWaiting: () => waiting > 0,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async acquire(mayWait) {
      const folder = ledgerDirectory();
      fs.mkdirSync(folder, {recursive:true});
      const file = path.join(folder, 'worker.sqlite');
      let lock = tryAcquire(file);
      if (lock || !mayWait()) return lock;
      changeWaiting(1);
      try {
        do {
          await delay(100);
          if (!mayWait()) return null;
          lock = tryAcquire(file);
        } while (!lock);
        return lock;
      } finally {
        changeWaiting(-1);
      }
    }
  };
}

module.exports = {createFastPayPrinterAccess, ledgerDirectory};
