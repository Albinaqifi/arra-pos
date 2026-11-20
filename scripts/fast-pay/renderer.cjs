const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { fastPayBill } = require('./renderer-bill.cjs');

// The portable cash/card RC2 has a different renderer from the S-096 source
// branch. Apply only to the verified kit, keeping its original module bindings.
const RC2_RENDERER = '9f079578c3e8f2793f13da12924e432dcfa107e5d75a6f35e235aec3d24c8fbf';

function receiptStatusText(row, language) {
  const labels = {
    queued: ['Fiscal receipt queued', 'Kuponi fiskal në pritje'],
    unconfirmed: ['Fiscal receipt unconfirmed', 'Kuponi fiskal i pakonfirmuar'],
    acknowledged: ['Fiscal receipt acknowledged', 'Kuponi fiskal i konfirmuar'],
  };
  if (!Object.hasOwn(labels, row.receiptStatus)) return '';
  const label = labels[row.receiptStatus][language === 'sq' ? 1 : 0];
  const number = row.documentNumber;
  return row.receiptStatus === 'acknowledged' && typeof number === 'string' && /^[0-9]{7}$/.test(number)
    ? label + ' · ' + number : label;
}

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('The expected RC2 renderer module was not found exactly once.');
  return source.replace(before, () => after);
}

function patchRenderer(original) {
  if (createHash('sha256').update(original).digest('hex') !== RC2_RENDERER) throw new Error('Expected the original RC2 renderer.');
  const ownerEnd = '      };\n    }\n  });\n\n  // src/billing/BillingBoundary.js';
  const extendBill = '      };\n      DesktopBill = (' + fastPayBill.toString().replace(/\r\n/g, '\n') +
    ')(DesktopBill, desktopBridge, React.createElement, waiterTranslate);';
  let source = replaceOnce(original.toString(), ownerEnd, extendBill + ownerEnd.slice('      };'.length));

  const adminModule = '  // src/admin/AccountABills.js\n';
  source = replaceOnce(source, adminModule, adminModule + receiptStatusText.toString().replace(/\r\n/g, '\n') + '\n');
  const title = 'h8("span", null, h8("strong", null, t("Bill #{id}", { id: r.billId })))';
  const titleWithReceipt = 'h8("span", null, h8("strong", null, t("Bill #{id}", { id: r.billId })), ' +
    'r.receiptStatus && h8("small", null, receiptStatusText(r, this.props.language)))';
  return replaceOnce(source, title, titleWithReceipt);
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Supply input and new output renderer paths.');
  fs.writeFileSync(output, patchRenderer(fs.readFileSync(input)), { flag: 'wx' });
}
module.exports = { patchRenderer, receiptStatusText };
