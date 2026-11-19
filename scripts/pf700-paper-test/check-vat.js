// Accent PF550/PF700 v1.40, command 97: read TaxA,TaxB,TaxC,TaxD without a payload.
const { prepareSteps, checkedData, withWindowsPort } = require('./paper-transport');

function vatSteps(firstSequence) {
  return prepareSteps(firstSequence, [
    { name: 'status', command: 0x4a, data: Buffer.from('X') },
    { name: 'vatRates', command: 0x61 }
  ]);
}

function formatVatRates(data) {
  const raw = data.toString('latin1');
  const fields = raw.split(',');
  const values = fields.map(field => field.replace(/^ +| +$/g, ''));
  // The manual defines percentages up to 99.00 with at most two decimal places.
  // It specifies neither an implied decimal point nor a disabled-group marker in this reply.
  const rateFormat = /^(?:[0-9]{1,2}|0*[0-9]{1,2}\.[0-9]{1,2})$/;
  if (values.length !== 4 || !values.every(rate => rateFormat.test(rate) && Number(rate) <= 99)) {
    const evidence = fields.map(field => {
      if (fields.length === 4 && /^[0-9.]{1,6}$/.test(field)) return field;
      return field.replace(/[0-9]/g, '#').replace(/ /g, '_').replace(/[^#._;%+-]/g, '?');
    }).join(',');
    throw new Error(`Unrecognized VAT reply. Group V is unconfirmed. Reply evidence (${data.length} bytes) = ${evidence || '(empty)'}`);
  }
  const labels = ['A', 'B', 'V', 'G'];
  const rates = values.map((value, index) => `${labels[index]} = ${value}%`).join(', ');
  const result = Number(values[2]) === 10
    ? 'Group V (third group) is configured at 10%.'
    : `Group V (third group) is configured at ${values[2]}%. The expected rate is 10%.`;
  return `PF700 configured VAT rates (Cyrillic group names transliterated)\n${rates}\n${result}`;
}

async function checkSteps([status, vatRates], exchange) {
  await checkedData(status, exchange);
  return formatVatRates(await checkedData(vatRates, exchange));
}

function runVatSequence(firstSequence, exchange) {
  return checkSteps(vatSteps(firstSequence), exchange);
}

async function runVatCheck(args, live = () => withWindowsPort(vatSteps, checkSteps)) {
  if (args.length === 0) {
    const replies = [
      '0131204a888080e1809a04888080e1809a0530373a3a03',
      '0140216131382e30302c352e30302c31302e30302c302e303004888080e1809a053038333903'
    ];
    await runVatSequence(0x20, () => Buffer.from(replies.shift(), 'hex'));
    return 'Offline VAT check rehearsal passed with simulated rates.';
  }
  if (args.length !== 1 || args[0] !== '--read-vat-rates') {
    throw new Error('Use no arguments for rehearsal or --read-vat-rates to read the configured VAT rates.');
  }
  return live();
}

if (require.main === module) {
  runVatCheck(process.argv.slice(2)).then(console.log, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runVatCheck, runVatSequence };
