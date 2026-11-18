// Accent's v1.36 PF550 manual, linked by its manufacturer for PF550/PF700.
// Builds payloads only; actual PF700 compatibility and fiscal behavior are
// unverified. No transport, credentials, payment or printer wiring is here.

function amount(value, maxSymbols = Infinity) {
  // Decimal text is supplied by the caller; do not round or convert currency.
  if (typeof value !== 'string' || value.length > maxSymbols || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value) || value.replace('.', '').length > 8 || !/[1-9]/.test(value)) {
    throw new TypeError('Invalid fiscal amount');
  }
  return value;
}

function sale({ description, taxGroup, price }) {
  // ASCII only until the device's actual encoding has been verified. Control
  // bytes and the second line are intentionally not accepted as descriptions.
  if (typeof description !== 'string' || !/^[\x20-\x7e]{1,25}$/.test(description) || !description.trim()) throw new TypeError('Invalid fiscal description');
  if (!['A', 'B', 'C', 'D'].includes(taxGroup)) throw new TypeError('Invalid fiscal tax group');
  return { command: 0x31, data: Buffer.from(`${description}\t${taxGroup}${amount(price)}`, 'ascii'), allowedControls: [0x09] };
}

function total({ mode, tendered }) {
  // These names correspond only to the manual's P and D codes. The mapping of
  // the restaurant's terminal and payment methods must be confirmed on device.
  const modes = { cash: 'P', debit: 'D' };
  if (typeof mode !== 'string' || !Object.hasOwn(modes, mode)) throw new TypeError('Invalid fiscal payment mode');
  return { command: 0x35, data: Buffer.from(`\t${modes[mode]}${amount(tendered, 8)}`, 'ascii'), allowedControls: [0x09] };
}

function closeReceipt() {
  return { command: 0x38, data: Buffer.alloc(0), allowedControls: [] };
}

function dailyReport({ option }) {
  // Caller must choose deliberately: 0 or 1 closes; 2 is without closure.
  if (!['0', '1', '2'].includes(option)) throw new TypeError('Invalid fiscal report option');
  return { command: 0x45, data: Buffer.from(option, 'ascii'), allowedControls: [] };
}

module.exports = { sale, total, closeReceipt, dailyReport };
