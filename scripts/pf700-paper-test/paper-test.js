// Standalone operator tool. Accent PF550/PF700 control codes v1.40, commands 74, 76 and 71.
const { receiptQueries, prepareSteps, checkedData, withWindowsPort, UnsentError } = require('./paper-transport');

function paperSteps(firstSequence) {
  return prepareSteps(firstSequence, [...receiptQueries(), { name: 'print', command: 0x47 }]);
}

function checkDocument(data) {
  const fields = data.toString('latin1').split(',');
  // Accent specifies widths, but does not illustrate positive-sign padding.
  // Amounts and counts are validated in memory and never shown or recorded.
  const amount = value => value.length === 9 && /^ *[+-]?[0-9]+$/.test(value);
  if ((fields.length !== 3 && fields.length !== 4) || !/^[01]$/.test(fields[0]) ||
      fields[1].length !== 4 || !/^ *[0-9]+$/.test(fields[1]) ||
      !amount(fields[2]) || (fields.length === 4 && !amount(fields[3]))) {
    throw new Error('Invalid receipt-state reply.');
  }
  if (fields[0] === '1') throw new Error('The printer has an open document.');
}

async function exchangeSteps(steps, exchange) {
  for (const step of steps) {
    try {
      const data = await checkedData(step, exchange);
      if (step.name === 'document') {
        checkDocument(data);
      } else if (step.name === 'print' && data.length !== 0) {
        throw new Error('Unexpected data in the diagnostic reply.');
      }
    } catch (error) {
      if (step.name === 'print' && !(error instanceof UnsentError)) {
        throw new Error(`Paper outcome is uncertain. Check the printer and paper before another attempt. ${error.message}`);
      }
      throw new Error(`No print command was sent. ${error.message}`);
    }
  }
}

function runSequence(firstSequence, exchange) {
  return exchangeSteps(paperSteps(firstSequence), exchange);
}

async function windowsPaperTest() {
  await withWindowsPort(paperSteps, exchangeSteps);
  return 'PF700 acknowledged the diagnostic command on COM3. Check for one diagnostic slip on the printer.';
}

async function runDiagnostic(args, live = windowsPaperTest) {
  if (args.length === 0) {
    // Synthetic closed-document data with the owner's observed six status bytes.
    const replies = [
      '0131204a888080e1809a04888080e1809a0530373a3a03',
      '013b214c302c303030302c30303030303030303004888080e1809a053037323c03',
      '012b224704888080e1809a053034323003'
    ];
    await runSequence(0x20, () => Buffer.from(replies.shift(), 'hex'));
    return 'Offline PF700 paper-test rehearsal passed using simulated replies. No printer was contacted.';
  }
  if (args.length !== 1 || args[0] !== '--print-diagnostic-slip') {
    throw new Error('Use no arguments for rehearsal or --print-diagnostic-slip for one live diagnostic.');
  }
  return live();
}

if (require.main === module) {
  runDiagnostic(process.argv.slice(2)).then(console.log, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runDiagnostic, runSequence };
