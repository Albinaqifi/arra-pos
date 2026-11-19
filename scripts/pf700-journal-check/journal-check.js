// Operator-assisted, read-only PF550/PF700 v1.40 ECT exploration. Never used
// by checkout. A successful read is not proof that a sale can be recovered.
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { TextDecoder } = require('node:util');
const { encodeRequest, decodeResponse } = require('../../src/desktop/pf700-frame');
const { probeIdentity } = require('../../src/desktop/pf700-windows-checkout');

const MAX_LINES = 300;
const decoder = new TextDecoder('windows-1251', { fatal: true });
function closedStatus(status) {
  if ((status[0] & 0x37) || (status[1] & 0x3f) || (status[2] & 0x0d) ||
      (status[4] & 0x35) || (status[5] & 0x01) || (status[5] & 0x1a) !== 0x1a) {
    throw Error('Printer status is not ready or a receipt is open. Stop and ask for help.');
  }
}

async function readJournal(exchange, serial, document, terms = [], firstSequence = 0x20) {
  if (!/^[A-Za-z0-9]{11}$/.test(serial) || !/^[0-9]{7}$/.test(document) ||
      !Number.isInteger(firstSequence) || firstSequence < 0x20 || firstSequence > 0x7f ||
      !Array.isArray(terms) || terms.length > 3 || terms.some(x => typeof x !== 'string' || x.length > 40)) {
    throw Error('Invalid input. No device command was sent.');
  }
  let sequence = firstSequence;
  async function send(command, payload) {
    const current = sequence;
    sequence = sequence === 0x7f ? 0x20 : sequence + 1;
    const frame = encodeRequest({ sequence: current, command, data: Buffer.from(payload, 'ascii') });
    const response = await exchange(frame);
    const reply = decodeResponse(response, { sequence: current, command });
    closedStatus(reply.status);
    return { ...reply, frame: response, sequence: current };
  }
  // The first reply may be cached from an earlier command with the same
  // sequence. A second distinct sequence obtains a fresh identity response.
  for (let i = 0; i < 2; i++) {
    const reply = await send(90, '0');
    const identity = await probeIdentity({ exchange: async () => reply.frame }, reply.sequence, serial);
    if (!identity.ok) throw Error('Printer identity or status did not match. Stop.');
  }
  const state = (await send(76, 'T')).data.toString('latin1').split(',');
  const amount = value => /^[+-][0-9]{9}$/.test(value) || (value?.length === 9 && /^ *[+-]?[0-9]+$/.test(value));
  if (state.length !== 4 || state[0] !== '0' || !/^ *[0-9]{1,4}$/.test(state[1]) || state[1].length !== 4 ||
      !amount(state[2]) || !amount(state[3])) throw Error('Receipt state is open or unrecognized. Stop.');
  const last = (await send(113, '')).data.toString('ascii');
  if (!/^[0-9]{7}$/.test(last) || last !== document) throw Error('The chosen document is not the last printed document. Stop.');

  let lines = 0, end = '', matches = terms.map(() => false);
  for (let index = 0; index < MAX_LINES + 1; index++) {
    const reply = (await send(119, index === 0 ? 'R,' + document : 'N')).data;
    if (reply.equals(Buffer.from('F'))) { end = 'end-of-data'; break; }
    if (reply.equals(Buffer.from('*,'))) { end = 'document separator'; break; }
    if (index === MAX_LINES || reply.length < 2 || reply[0] !== 0x50 || reply[1] !== 0x2c) {
      throw Error('Journal reply is malformed or exceeds the line limit. Stop.');
    }
    const content = decoder.decode(reply.subarray(2)).toLocaleLowerCase();
    for (let i = 0; i < terms.length; i++) if (terms[i] && content.includes(terms[i].toLocaleLowerCase())) matches[i] = true;
    lines++;
  }
  if (!end) throw Error('Journal read did not finish within the limit. Stop.');
  return { lines, end, matches };
}

function openPipe() {
  if (process.platform !== 'win32') throw Error('The live check requires Windows.');
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-File',path.join(__dirname, 'journal-exchange.ps1')], { windowsHide:true, stdio:['pipe','pipe','ignore'], timeout:180000 });
  child.on('error', () => {}); child.stdin.on('error', () => {});
  const done = new Promise(resolve => child.once('close', resolve));
  const iterator = readline.createInterface({ input:child.stdout, crlfDelay:Infinity })[Symbol.asyncIterator]();
  return {
    async exchange(frame) {
      child.stdin.write(frame.toString('hex') + '\n');
      const line = await iterator.next();
      if (line.done || !/^(?:[0-9A-F]{2}){17,101}$/.test(line.value)) throw Error('The printer exchange failed or was incomplete. Stop.');
      return Buffer.from(line.value, 'hex');
    },
    async close() { child.stdin.end(); await done; }
  };
}

async function main() {
  if (process.argv.length !== 2) throw Error('Do not pass command-line arguments.');
  const prompt = readline.createInterface({ input:process.stdin, output:process.stdout });
  const ask = q => new Promise(resolve => prompt.question(q, resolve));
  try {
    console.log('PF700 electronic trail check: read-only commands on COM3. No receipt will be printed or sale recorded.');
    console.log('Every inquiry can replace the printer’s cached last response. Do not continue if ANY sale or report is unresolved, even outside Arra.');
    console.log('Stop other POS/printer programs. Use only an already closed, known receipt. This tool does not check Arra’s database.');
    if (await ask('Type CLEAR ONLY if all transactions and reports are resolved and no other program is using the printer: ') !== 'CLEAR') { console.log('Cancelled before connecting.'); return; }
    const serial = (await ask('Enter the 11-character serial from the intended printer label (kept local): ')).trim();
    const document = (await ask('Enter the 7-digit number of the last printed, closed document: ')).trim();
    const terms = [];
    for (const label of ['sample item text', 'cash or card label', 'sample amount']) terms.push((await ask('Optional local comparison text for ' + label + ' (Enter to skip): ')).trim());
    if (!/^[A-Za-z0-9]{11}$/.test(serial) || !/^[0-9]{7}$/.test(document) || terms.some(x => x.length > 40)) throw Error('Invalid input. No device command was sent.');
    if (await ask('Type READ to connect and replace the cached printer response, or press Enter to cancel: ') !== 'READ') { console.log('Cancelled before connecting.'); return; }
    prompt.close();
    const pipe = openPipe();
    try {
      const result = await readJournal(pipe.exchange, serial, document, terms, randomInt(0x20, 0x80));
      console.log('Read ' + result.lines + ' text line(s); stopped at ' + result.end + '.');
      terms.forEach((term, index) => { if (term) console.log('Comparison ' + (index + 1) + ': ' + (result.matches[index] ? 'found' : 'not found')); });
      console.log('This does not verify receipt completeness, tender, or safe recovery. No receipt text was saved or displayed.');
    } finally { await pipe.close(); }
  } finally { prompt.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); console.error('The check stopped. Ask for help; do not retry an uncertain printer operation.'); process.exitCode = 1; });
module.exports = { readJournal, MAX_LINES };
