const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { randomInt } = require('node:crypto');
const { createWindowsPf700Checkout } = require('../src/desktop/pf700-windows-checkout');
const { createStatefulPf700 } = require('./support/pf700-stateful-device');

// This mock represents a single exclusive port shared by separate adapters.
// It does not open any device; the separate PowerShell tests cover the helper.
function exclusiveTransport(device) {
  let held = false;
  return function start() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    let mine = false, ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      if (mine) held = false;
      child.stdout.end();
      setImmediate(() => child.emit('close', 0));
    };
    child.stdin = new Writable({
      write(bytes, _encoding, callback) {
        const line=bytes.toString().trim();
        try {
          if (line==='OPEN') {
            if (held) throw Error('Synthetic port busy');
            held=true; mine=true;
            child.stdout.write('READY\r\n');
          } else {
            if (!mine) throw Error('Port not reserved');
            const reply=device.exchange(Buffer.from(line,'hex'));
            child.stdout.write(reply.toString('hex').toUpperCase()+'\r\n');
          }
        } catch { finish(); }
        callback();
      },
      final(callback) { finish(); callback(); }
    });
    child.kill=finish;
    return child;
  };
}
const windows = { skip: process.platform !== 'win32' };
function adapter(device,start,serial=device.serial) {
  return createWindowsPf700Checkout({expectedSerial:serial,operatorNumber:2,operatorPassword:String(randomInt(100000,1000000)),
    tillNumber:1,domesticProduct:false},start);
}

test('observation holds an exclusive transport before writing and uses only read-only commands', windows, async () => {
  const device=createStatefulPf700(), start=exclusiveTransport(device);
  const first=adapter(device,start), second=adapter(device,start);
  const handle=await first.acquireCashObservation();
  assert.ok(handle);
  assert.equal(device.transcript.length,0);
  assert.equal(await second.acquireCashObservation(),null);
  assert.equal(device.transcript.length,0);
  device.state.open=true; device.state.items=2; device.state.sums=[35,0,40,0]; device.state.paid=75;
  const value=await handle.observe();
  assert.deepEqual(value,{open:true,items:2,amountMinor:7500,tenderMinor:7500,
    lastDocumentNumber:'0000001',taxTotalsMinor:[3500,0,4000,0]});
  assert.deepEqual(device.transcript.map(row=>row.command),[90,90,76,103,113]);
  assert.equal(device.state.tenders,0);
  assert.equal(device.state.closes,0);
  await handle.close();
  const next=await second.acquireCashObservation();
  assert.ok(next);
  await next.close();
});

test('observation rejects a different serial before requesting receipt state', windows, async () => {
  const device=createStatefulPf700(), start=exclusiveTransport(device);
  const handle=await adapter(device,start,'DIFFERENT01').acquireCashObservation();
  assert.ok(handle);
  await assert.rejects(handle.observe());
  assert.deepEqual(device.transcript.map(row=>row.command),[90]);
  await handle.close();
});
