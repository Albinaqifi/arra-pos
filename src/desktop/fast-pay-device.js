'use strict';

// Installed next to the authentic RC2 desktop modules. Each tender uses that
// release's serial transport, frame checks and register-specific protocol.
function createFastPrinter(profile, createDevice, cardEnrolled) {
  const cash = createDevice({ ...profile, supervisedCardTrial: false });
  const card = createDevice({ ...profile, supervisedCardTrial: true, fastPayCardCounters: true });
  let busy = false;

  function canRegister(receipt) {
    return receipt?.account === 'A' && (receipt.method === 'cash' || (receipt.method === 'card' && cardEnrolled === true)) &&
      receipt.domesticProduct === cash.domesticProduct && Array.isArray(receipt.lines) && receipt.lines.length > 0 &&
      receipt.lines.every(line => typeof line?.domesticProduct === 'boolean');
  }

  return Object.freeze({
    mode: cash.mode, deviceId: cash.deviceId, domesticProduct: cash.domesticProduct, canRegister,
    async acquireCashObservation() {
      if (busy) return null;
      busy = true;
      let handle;
      try {
        handle = await cash.acquireCashObservation();
        if (!handle) return null;
        let closed = false;
        return {
          observe: handle.observe,
          async close() {
            if (closed) return;
            closed = true;
            try { await handle.close(); } finally { busy = false; }
          }
        };
      } finally {
        if (!handle) busy = false;
      }
    },
    async registerSale(receipt, context) {
      if (busy || !canRegister(receipt) || typeof context?.beforeOpen !== 'function') return { status: 'failed' };
      busy = true;
      const device = receipt.method === 'cash' ? cash : card;
      try {
        return await device.registerSale(receipt, {
          ...context,
          async afterCommand(ack) {
            // Fast cash uses the enrolled on-site firmware's lone TAB tender.
            if (ack.summary.identityMatched && !ack.summary.onsiteFirmware) throw Error('Unsupported checkout firmware');
            await context.afterCommand?.(ack);
          }
        });
      } finally {
        busy = false;
      }
    }
  });
}

function selectFastPayCheckout(args, directory) {
  if (args.filter(arg => arg === '--arra-fast-pay').length !== 1 || !args.includes('--pf700-routine-checkout')) {
    throw Error('Use the fast payment launcher.');
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const { selectPf700Checkout } = require('./pf700-checkout-mode');
  const { createWindowsPf700Checkout } = require('./pf700-windows-checkout');
  const { deviceTrial } = require('./pf700-commissioning');
  let printer;
  const native = selectPf700Checkout(args, directory, undefined, profile => {
    const original = path.join(process.env.APPDATA, 'Arra POS PF700 Commissioning');
    if (!fs.existsSync(original) ||
        fs.realpathSync.native(original).toLowerCase() !== fs.realpathSync.native(directory).toLowerCase() ||
        !deviceTrial(profile.expectedSerial).wasClaimed()) {
      throw Error('Use the enrolled printer and its original POS data folder and Windows account.');
    }
    printer = createFastPrinter(profile, createWindowsPf700Checkout, true);
    return printer;
  });
  return Object.freeze({ ...native, canRegister: printer.canRegister, fastPayVersion: 1 });
}

module.exports = { createFastPrinter, selectFastPayCheckout };
