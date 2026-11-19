// Read-only command 76 layout check. The device data stays in memory.
const { receiptQueries, prepareSteps, checkedData, withWindowsPort } = require('./paper-transport');

function replySteps(firstSequence) {
  return prepareSteps(firstSequence, receiptQueries());
}

function formatLayout(data) {
  let layout = '';
  for (const [index, byte] of data.entries()) {
    const char = String.fromCharCode(byte);
    if (index === 0 && (char === '0' || char === '1') && (data.length === 1 || data[1] === 0x2c)) {
      layout += char;
    } else if (byte >= 0x30 && byte <= 0x39) {
      layout += '#';
    } else if (char === ' ') {
      layout += '_';
    } else if (',;|.+-'.includes(char)) {
      layout += char;
    } else {
      layout += '?';
    }
  }
  return `Reply format: ${data.length} ${data.length === 1 ? 'byte' : 'bytes'} | ${layout || '(empty)'}`;
}

async function checkSteps([status, document], exchange) {
  await checkedData(status, exchange);
  return formatLayout(await checkedData(document, exchange));
}

function runReplySequence(firstSequence, exchange) {
  return checkSteps(replySteps(firstSequence), exchange);
}

async function runReplyCheck(args, live = () => withWindowsPort(replySteps, checkSteps)) {
  if (args.length === 0) {
    // Synthetic status and receipt-state replies, including a nonstandard decimal field.
    const replies = [
      '0131204a888080e1809a04888080e1809a0530373a3a03',
      '0138214c302c2031322c2b3837332e303504888080e1809a053036393c03'
    ];
    const layout = await runReplySequence(0x20, () => Buffer.from(replies.shift(), 'hex'));
    return layout + ' (offline rehearsal)';
  }
  if (args.length !== 1 || args[0] !== '--check-reply') {
    throw new Error('Use no arguments for rehearsal or --check-reply to read the reply format.');
  }
  return live();
}

if (require.main === module) {
  runReplyCheck(process.argv.slice(2)).then(console.log, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runReplyCheck, runReplySequence };
