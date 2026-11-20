// Stateful synthetic PF700 for tests only. Nothing in this fixture opens a port.
// Requests are processed in memory; the transcript deliberately retains only
// command numbers and sequence numbers, never item text or operator secrets.
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');

const serial = 'SYNTHETIC01';
const amount = value => '+' + String(value * 100).padStart(9, '0');
function response(sequence, command, data, open) {
  const status = Buffer.from(open ? '888088e1809a' : '888080e1809a', 'hex');
  const value = command === 74 ? status : Buffer.from(data, 'latin1');
  const body = Buffer.concat([Buffer.from([43 + value.length, sequence, command]), value,
    Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((total, byte) => total + byte, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12, 8, 4, 0].map(shift => 48 + ((sum >> shift) & 15))), Buffer.from([3])]);
}

function createStatefulPf700({legacy = false, method = 'cash', debitRegister = 2} = {}) {
  const state = { open: false, items: 0, sums: [0, 0, 0, 0], paid: 0, tenders: 0, closes: 0, document: 1 };
  const registers = [10, 20, 30, 40];
  const transcript = [];
  let cache = null, fault = null;
  const hit = (command, mode) => {
    if (!fault || fault.command !== command || fault.mode !== mode) return false;
    if (--fault.remaining > 0) return false;
    fault = null;
    return true;
  };
  function exchange(frame) {
    const sequence = frame[2], command = frame[3], payload = frame.subarray(4, -6).toString('latin1');
    const entry = { sequence, command, effect: 'sent' };
    transcript.push(entry);
    if (cache?.sequence === sequence) { entry.effect = 'replayed'; return Buffer.from(cache.reply); }
    if (hit(command, 'before')) { entry.effect = 'dropped-before'; throw Error('Synthetic transport interruption'); }
    const total = state.sums.reduce((sum, value) => sum + value, 0);
    let value = '';
    switch (command) {
      case 90:
        if (payload !== '0') throw Error('Unsupported identity request');
        value = legacy ? `1.00 231014 1230,ABCD,0011,1,${serial}` : `QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,${serial}`;
        break;
      case 74: if (payload !== 'X') throw Error('Unsupported status request'); break;
      case 76:
        if (payload !== 'T') throw Error('Unsupported state request');
        value = [Number(state.open), String(state.items).padStart(4, '0'), legacy ? '+' + String(total).padStart(9,'0') : amount(total),
          legacy ? '+' + String(state.paid).padStart(9,'0') : amount(state.paid)].join(',');
        break;
      case 97: value = '18.00,5.00,10.00,0.00'; break;
      case 110:
        if (method !== 'card' || state.open || payload) throw Error('Invalid synthetic register inquiry');
        value = [...registers.map(amount), '0007', String(state.closes + 1).padStart(4, '0')].join(',');
        break;
      case 113: value = String(state.document).padStart(7, '0'); break;
      case 48:
        if (state.open || state.closes || !/^[1-8],[0-9]{4,6},[0-9]{1,5}$/.test(payload)) throw Error('Invalid synthetic open');
        state.open = true; value = '0000,0000'; break;
      case 49: {
        const sale = /^[\x20-\x7e]{1,25}(?:\n[\x20-\x7e]{1,25})?\t@?([\xc0\xc2])([0-9]{1,8})\*([0-9]{1,8})$/.exec(payload);
        if (!state.open || state.paid || !sale) throw Error('Invalid synthetic item');
        state.sums[sale[1].charCodeAt(0) - 0xc0] += Number(sale[2]) * Number(sale[3]);
        state.items++;
        break;
      }
      case 51:
        if (!legacy || !state.open || payload !== '00') throw Error('Invalid synthetic subtotal');
        value = [total,...state.sums].join(','); break;
      case 103:
        if (!state.open || payload) throw Error('Invalid synthetic VAT query');
        value = legacy ? ['0',...state.sums].join(',') : ['1', ...state.sums.map(amount)].join(','); break;
      case 53:
        if (!state.open || !total || payload !== (method === 'card' ? '\tD' + total : legacy ? '\tP' + total : '\t')) {
          throw Error('Invalid synthetic tender');
        }
        // The protocol allows another total command; deliberately model a
        // duplicate tender as harmful instead of granting idempotency for free.
        registers[method === 'card' ? debitRegister : 0] += total;
        state.paid += total; state.tenders++; value = 'R+000000000'; break;
      case 56:
        if (!state.open || state.paid !== total || !total) throw Error('Invalid synthetic close');
        state.open = false; state.closes++; state.document++; value = '0001,0000'; break;
      default: throw Error('Unsupported synthetic command');
    }
    const reply = response(sequence, command, value, state.open);
    cache = { sequence, reply };
    entry.effect = 'executed';
    if (hit(command, 'after')) { entry.effect = 'executed-reply-lost'; throw Error('Synthetic transport interruption'); }
    return Buffer.from(reply);
  }
  function start() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(bytes, _encoding, callback) {
        try {
          const result = exchange(Buffer.from(bytes.toString().trim(), 'hex'));
          child.stdout.write(result.toString('hex').toUpperCase() + '\r\n');
        } catch (_) { child.stdout.end(); }
        callback();
      },
      final(callback) { child.stdout.end(); setImmediate(() => child.emit('close', 0)); callback(); }
    });
    child.kill = () => child.emit('close', 1);
    return child;
  }
  return {
    serial, state, transcript, start, exchange,
    fault(command, mode, occurrence = 1) {
      if (!Number.isSafeInteger(occurrence) || occurrence < 1 || !['before', 'after'].includes(mode)) throw Error('Invalid synthetic fault');
      fault = { command, mode, remaining: occurrence };
    },
    resetCache() { cache = null; }
  };
}

module.exports = { createStatefulPf700 };
