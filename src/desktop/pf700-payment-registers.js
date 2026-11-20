// The enrolled 1.00MK reports tender totals in hundredths of MKD. Debit
// (the D tender) is the third register; credit and cheque are separate.
function integer(field, width) {
  if (typeof field !== 'string' || field.length !== width || !/^ *[0-9]+$/.test(field)) throw Error('Invalid PF700 counter');
  return Number(field);
}

function hundredths(field) {
  if (typeof field !== 'string' || field.length > 13 || !/^ *[+-]?[0-9]+$/.test(field)) throw Error('Invalid PF700 amount');
  return Number(field);
}

function paymentRegisters(text) {
  const fields = text.split(',');
  if (fields.length !== 6) throw Error('Invalid PF700 payment registers');
  return { amounts: fields.slice(0, 4).map(hundredths), closure: integer(fields[4], 4), nextReceipt: integer(fields[5], 4) };
}

module.exports = { integer, hundredths, paymentRegisters };
