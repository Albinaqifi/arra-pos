const fs = require('node:fs');
const { checkWindowsPf700Identity } = require('./pf700-windows-checkout');
const { deviceTrial } = require('./pf700-commissioning');

async function check() {
  if (process.argv.length !== 3 || process.argv[2] !== '--check-identity' || process.stdin.isTTY) {
    throw Error('Use the supervised launcher with -CheckIdentityOnly.');
  }
  const serial = fs.readFileSync(0, 'utf8').trim();
  if (!/^[A-Za-z0-9]{11}$/.test(serial)) throw Error('Check the serial number from the printer.');
  if (!deviceTrial(serial).available()) throw Error('The supervised trial was already attempted. Review the saved bill before using diagnostics.');
  const result = await checkWindowsPf700Identity(serial);
  if (!result.ok) {
    throw Error('PF700 identity unconfirmed (' + result.reason + ').' + (result.layout ? ' ' + result.layout : ''));
  }
  console.log('The PF700 on COM3 matches the serial number you entered.');
}

if (require.main === module) check().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
