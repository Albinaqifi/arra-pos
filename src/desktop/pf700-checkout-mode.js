const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { offlineCheckoutRequested } = require('./fiscal-checkout');
const { createTrainingPf700 } = require('./training-pf700');
const { createWindowsPf700PrinterControl } = require('./pf700-printer-control');
const { createFastPayPrinterAccess } = require('./fast-pay-printer-access');
const { createWindowsPf700DailyReport } = require('./pf700-daily-report');
const { isCommissionedDirectory, deviceTrial, cardTrialLedger } = require('./pf700-commissioning');
const { createWindowsPf700Checkout } = require('./pf700-windows-checkout');

const supervised = '--pf700-supervised-checkout';
const routine = '--pf700-routine-checkout';
const cardTrial = '--pf700-supervised-card-trial';

// The attended launcher passes the local settings through a private pipe and
// closes it before the app opens. Never include its contents in errors or logs.
function readLocalProfile() {
  if (process.stdin.isTTY) throw Error('Start the supervised PF700 launcher.');
  const bytes = Buffer.alloc(2049);
  try {
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(0, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (!length || length === bytes.length) throw Error();
    return JSON.parse(bytes.toString('utf8', 0, length));
  } catch {
    throw Error('Could not read the local PF700 settings.');
  } finally {
    bytes.fill(0);
  }
}

function selectPf700Checkout(args, directory, readProfile = readLocalProfile, createDevice = createWindowsPf700Checkout) {
  const switches = args.filter(arg => arg.startsWith('--pf700-'));
  if (!switches.length) return null;
  if (switches.length !== 1) throw Error('Choose one PF700 checkout mode.');
  if (offlineCheckoutRequested(args)) {
    if (fs.existsSync(path.join(directory, 'arra.sqlite')) && isCommissionedDirectory(directory)) {
      throw Error('Use the dedicated training database for offline checkout.');
    }
    return createTrainingPf700(directory);
  }
  if (![supervised, routine, cardTrial].includes(switches[0]) || process.platform !== 'win32' ||
      args.some(arg => arg.startsWith('--sample-data-directory')) ||
      fs.existsSync(path.join(directory, 'SAMPLE-DATA-ONLY')) ||
      !fs.existsSync(path.join(directory, 'arra.sqlite')) || !isCommissionedDirectory(directory)) {
    throw Error('Prepare the dedicated PF700 data folder on Windows before supervised checkout.');
  }
  const profile = readProfile();
  if (!profile || typeof profile.domesticProduct !== 'boolean' || typeof profile.dataDirectory !== 'string' ||
      fs.realpathSync.native(profile.dataDirectory).toLowerCase() !== fs.realpathSync.native(directory).toLowerCase()) {
    throw Error('Check the local PF700 settings and data folder.');
  }
  const trial = deviceTrial(profile.expectedSerial);
  const isRoutine = switches[0] === routine;
  const isCardTrial = switches[0] === cardTrial;
  // An enrolled SQLite backup alone must not authorize a second terminal
  // invitation on another PC or Windows account. This attended profile is
  // for the already commissioned unit on the original POS.
  if (isCardTrial) {
    const original = path.join(process.env.APPDATA, 'Arra POS PF700 Commissioning');
    if (!trial.wasClaimed() || !fs.existsSync(original) ||
        fs.realpathSync.native(original).toLowerCase() !== fs.realpathSync.native(directory).toLowerCase()) {
      throw Error('Use the original commissioned printer, POS data folder and Windows account for the card trial.');
    }
  }
  const cardLedger = cardTrialLedger();
  const printerWait = createFastPayPrinterAccess();
  const adapter = createDevice({
    operatorNumber: profile.operatorNumber, operatorPassword: profile.operatorPassword,
    tillNumber: profile.tillNumber, expectedSerial: profile.expectedSerial, domesticProduct: profile.domesticProduct,
    ...(isCardTrial ? {supervisedCardTrial:true} : isRoutine ? {allowLegacyOrigin:true} : {mayProbe: trial.available, beforeOpen: trial.claim})
  });
  return Object.freeze({
    ...adapter,
    ...((isRoutine || isCardTrial) ? { requireOrigins: true } : {}),
    readCardTrial: cardLedger.read,
    ...(isCardTrial ? {
      supervisedCardTrial: true,
      cardTrialAvailable: () => cardLedger.read() === null,
      claimCardTrial: token => cardLedger.claim(profile.expectedSerial, token),
      recordCardOutcome: (token, outcome) => cardLedger.outcome(profile.expectedSerial, token, outcome),
      cardDispatchAvailable(token) {
        const record = cardLedger.read();
        return Boolean(record && record.token === token && record.outcome === 'approved' && !record.dispatched &&
          record.deviceHash === createHash('sha256').update(profile.expectedSerial).digest('hex'));
      },
      claimCardDispatch: token => cardLedger.dispatch(profile.expectedSerial, token)
    } : {}),
    dailyReport: createWindowsPf700DailyReport({ expectedSerial: profile.expectedSerial, printerWait }),
    printerWait,
    printerControl: createWindowsPf700PrinterControl({ expectedSerial: profile.expectedSerial, printerWait }),
    canRegister(receipt, prior) {
      if (isCardTrial) return receipt.account === 'A' && receipt.method === 'card' &&
        receipt.lines.length > 0 && receipt.lines.every(line => typeof line.domesticProduct === 'boolean');
      const legacy = typeof receipt.domesticProduct === 'boolean' && receipt.lines.length === 1 &&
        receipt.lines[0].quantity === 1 && !Object.hasOwn(receipt.lines[0], 'domesticProduct');
      return receipt.method === 'cash' && receipt.account === 'A' && (isRoutine
        ? (receipt.lines.every(line => typeof line.domesticProduct === 'boolean') ||
          (legacy && prior?.status === 'failed' && prior.mode === 'device' && prior.deviceId === adapter.deviceId))
        : (trial.available() && receipt.lines.length === 1 && receipt.lines[0].quantity === 1));
    }
  });
}

module.exports = { selectPf700Checkout };
