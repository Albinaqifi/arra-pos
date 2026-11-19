const fs = require('node:fs');
const path = require('node:path');
const { offlineCheckoutRequested } = require('./fiscal-checkout');
const { createTrainingPf700 } = require('./training-pf700');
const { createWindowsPf700DailyReport } = require('./pf700-daily-report');
const { isCommissionedDirectory, deviceTrial } = require('./pf700-commissioning');
const { createWindowsPf700Checkout } = require('./pf700-windows-checkout');

const supervised = '--pf700-supervised-checkout';

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
  if (switches[0] !== supervised || process.platform !== 'win32' ||
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
  const adapter = createDevice({
    operatorNumber: profile.operatorNumber, operatorPassword: profile.operatorPassword,
    tillNumber: profile.tillNumber, expectedSerial: profile.expectedSerial, domesticProduct: profile.domesticProduct,
    mayProbe: trial.available, beforeOpen: trial.claim
  });
  return Object.freeze({
    ...adapter,
    dailyReport: createWindowsPf700DailyReport({ expectedSerial: profile.expectedSerial }),
    canRegister(receipt) {
      return trial.available() && receipt.method === 'cash' && receipt.account === 'A' &&
        receipt.lines.length === 1 && receipt.lines[0].quantity === 1;
    }
  });
}

module.exports = { selectPf700Checkout };
