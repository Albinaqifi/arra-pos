const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { encodeRequest } = require('../src/desktop/pf700-frame');
const { readClosedCashTrace } = require('../src/desktop/pf700-closed-cash-trace');
const { readCandidate, classifyReply } = require('../scripts/pf700-close-evidence/evidence');
const { lostClose } = require('./support/pf700-bill2-sale');

const digest = data => createHash('sha256').update(data).digest('hex');
const candidateFor = db => readCandidate(db, 2, '0000030');

test('journal requires the original item order, printed VAT group and domestic origin for both lines', async t => {
  for (const options of [{}, {otherTax:true}, {imported:true}, {reverse:true}]) {
    const {db} = await lostClose(t,'after',options);
    const original = candidateFor(db);
    assert.ok(original);
    const strict = readCandidate(db,2,'0000030',{matchJournalPaper:true});
    assert.deepEqual(strict,Object.keys(options).length ? null : original);
  }
});

for (const fault of ['before', 'after']) {
  test('read-only classifier following a synthetic close interruption ' + fault + ' execution', async t => {
    const {db, device} = await lostClose(t, fault);
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
    const candidate = candidateFor(db);
    assert.ok(candidate);
    assert.deepEqual(candidateFor(db), candidate);
    assert.match(candidate.binding, /^[a-f0-9]{64}$/);
    assert.deepEqual(candidate, {
      billId:2, attemptId:1, sequence:43, serial:device.serial, expectedDocument:'0000030', total:150,
      openingFiscalReceiptCount:0, openingReversalCount:0, binding:candidate.binding
    });
    assert.equal(readClosedCashTrace(db, 2), null);
    const reply = device.exchange(encodeRequest({sequence:candidate.sequence, command:74, data:Buffer.from('X')}));
    const result = classifyReply(candidate, reply);
    const common = {ready:true, responseHash:digest(reply)};
    if (fault === 'after') {
      assert.deepEqual(result, {kind:'cached-close', open:false, fiscalReceiptCount:1, reversalCount:0,
        countersMatch:true, statusHex:'888080e1809a', ...common});
      assert.equal(device.state.closes, 1);
    } else {
      assert.deepEqual(result, {kind:'status', open:true, statusHex:'888088e1809a', ...common});
      assert.equal(device.state.closes, 0);
    }
    assert.equal(device.state.tenders, 1);
    for (const table of ['payments','fiscal_checkout_results','pf700_command_seals']) {
      assert.equal(db.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
    }
  });
}

test('incomplete and conflicting local histories cannot supply a probe sequence', async t => {
  const {db} = await lostClose(t, 'after');
  const original = candidateFor(db);
  assert.ok(original);
  assert.equal(readCandidate(db, 1, '0000030'), null);
  assert.equal(readCandidate(db, 2, '0000031'), null);
  for (const [reason, corrupt] of [
    ['missing enrollment', 'DROP TABLE pf700_commissioning_enrollment'],
    ['different payer', 'DROP TRIGGER fiscal_checkout_sales_no_update; UPDATE fiscal_checkout_sales SET actor_id=2'],
    ['wrong saved bill', "DROP TRIGGER bill_lines_no_update; UPDATE bill_lines SET name='Other' WHERE id=1"],
    ['different baseline device', "DROP TRIGGER fiscal_checkout_baselines_no_update; UPDATE fiscal_checkout_baselines SET device_id='OTHER'"],
    ['different expected document', "DROP TRIGGER fiscal_checkout_baselines_no_update; UPDATE fiscal_checkout_baselines SET previous_document='0000028'"],
    ['sealed attempt', 'DROP TRIGGER pf700_command_seal_guard; INSERT INTO pf700_command_seals VALUES(1,1,1)'],
    ['missing item ack', 'DROP TRIGGER pf700_command_acks_no_delete; DELETE FROM pf700_command_acks WHERE command_id=7'],
    ['invalid tender request hash', "DROP TRIGGER pf700_command_intents_no_update; UPDATE pf700_command_intents SET request_hash=lower(hex(zeroblob(32))) WHERE command=53"],
    ['invalid item request hash', "DROP TRIGGER pf700_command_intents_no_update; UPDATE pf700_command_intents SET request_hash=lower(hex(zeroblob(32))) WHERE id=8"],
    ['invalid close request hash', "DROP TRIGGER pf700_command_intents_no_update; UPDATE pf700_command_intents SET request_hash=lower(hex(zeroblob(32))) WHERE command=56"],
    ['wrong command sequence', 'DROP TRIGGER pf700_command_intents_no_update; UPDATE pf700_command_intents SET sequence=127 WHERE id=7'],
    ['unconfirmed firmware', `DROP TRIGGER pf700_command_acks_no_update; UPDATE pf700_command_acks SET summary='{"identityMatched":true,"onsiteFirmware":false}' WHERE command_id=1`],
    ['wrong paid-state summary', `DROP TRIGGER pf700_command_acks_no_update; UPDATE pf700_command_acks SET summary='{"state":"open_unpaid","items":2,"total":150}' WHERE command_id=12`],
    ['close already acknowledged', `INSERT INTO pf700_command_acks VALUES(13,lower(hex(zeroblob(32))),'{"fiscalReceiptCount":1,"reversalCount":0}',1)`],
    ['more than one trailing intent', `DROP TRIGGER pf700_command_intent_guard; INSERT INTO pf700_command_intents
      (attempt_id,sequence,command,request_hash,created_at) VALUES(1,44,74,lower(hex(zeroblob(32))),1)`],
    ['stored accepted receipt', `INSERT INTO fiscal_checkout_results VALUES(1,'accepted','device-SYNTHETIC01','0000030',
      '{"documentNumber":"0000030","fiscalReceiptCount":1,"reversalCount":0}',1)`],
    ['other unresolved report', `DROP TRIGGER pf700_cash_daily_guard; INSERT INTO fiscal_daily_reports
      (day_id,actor_id,mode,device_id,expected,previous_closure,previous_document,device_date,started_at)
      SELECT id,1,'device','SYNTHETIC01','{}',0,'0000028','010120',1 FROM business_days LIMIT 1`]
  ]) {
    db.exec('SAVEPOINT change');
    try {
      db.exec(corrupt);
      assert.equal(candidateFor(db), null, reason);
    } finally {
      db.exec('ROLLBACK TO change; RELEASE change');
    }
  }
  // A different plausible prior validated response must change the binding.
  db.exec(`DROP TRIGGER pf700_command_acks_no_update;
    UPDATE pf700_command_acks SET response_hash=lower(hex(zeroblob(32))) WHERE command_id=7`);
  assert.notEqual(candidateFor(db).binding, original.binding);
});

// Construct independent bounded response vectors, including checksum-valid
// but unsupported replies. The report must not echo arbitrary device text.
function wire(command, value, { sequence = 43, statusHex = '888080e1809a' } = {}) {
  const data = Buffer.from(value, 'latin1'), status = Buffer.from(statusHex, 'hex');
  const body = Buffer.concat([Buffer.from([43 + data.length, sequence, command]), data, Buffer.from([4]), status, Buffer.from([5])]);
  const sum = body.reduce((a,b) => a+b, 0);
  return Buffer.concat([Buffer.from([1]), body, Buffer.from([12,8,4,0].map(shift => 48 + ((sum >> shift) & 15))), Buffer.from([3])]);
}

test('validated observations preserve counter differences and status faults', () => {
  const candidate = {sequence:43, openingFiscalReceiptCount:10, openingReversalCount:1};
  const cached = classifyReply(candidate, wire(56, '  12,0001'));
  assert.equal(cached.kind, 'cached-close');
  assert.equal(cached.fiscalReceiptCount, 12);
  assert.equal(cached.countersMatch, false);
  const abnormal = classifyReply(candidate, wire(56, '0011,0001', {statusHex:'888088e1809a'}));
  assert.equal(abnormal.open, true);
  assert.equal(abnormal.ready, false);
  const faultStatus = Buffer.from('898080e1809a', 'hex');
  const fault = classifyReply(candidate, wire(74, faultStatus, {statusHex:faultStatus.toString('hex')}));
  assert.equal(fault.kind, 'status');
  assert.equal(fault.ready, false);
});

test('an unrecognized close layout preserves its bounded shape and frame identity', () => {
  for (const [payload, shape] of [['0001,00-0','####,##-#'],['  1 ,0000','__#_,####'],
    ['A1/2 +private.name' + 'X'.repeat(40),'?#/#_+???????.' + '?'.repeat(18)]]) {
    const reply = wire(56, payload);
    assert.deepEqual(classifyReply({sequence:43}, reply), {
      kind:'unrecognized-close', ready:true, open:false, shape, payloadLength:payload.length,
      statusHex:'888080e1809a', responseHash:digest(reply)
    });
  }
});

test('malformed frames and unrelated responses yield only a fixed classification', () => {
  const good = wire(56, '0001,0000');
  const corrupt = Buffer.from(good); corrupt[corrupt.length-2] ^= 1;
  for (const bad of [null, Buffer.from([0x15]), Buffer.concat([Buffer.from([0x16]),good]), corrupt,
    good.subarray(0,-1), Buffer.concat([good,good]), Buffer.alloc(102), wire(90, 'UNEXPECTED TEXT'),
    wire(56, '0001,0000', {sequence:44}), wire(74, Buffer.from('888088e1809a','hex')),
    wire(74, '0001,0000'), wire(56, '0001,0000', {statusHex:'088080e1809a'})]) {
    assert.deepEqual(classifyReply({sequence:43}, bad), {kind:'inconclusive'});
  }
});

test('settling a numbered journal keeps the original verification contract and a sealed incident witness', async t => {
  const { originalVerifiedView, persistNumberedJournal } = require('../src/desktop/pf700-numbered-journal-result');
  const { db } = await lostClose(t, 'after');
  const candidate = candidateFor(db);
  const proof = {kind:'numbered-journal', documentNumber:'0000030', binding:candidate.binding,
    captureHash:'a'.repeat(64), journalHash:'b'.repeat(64), responseHash:'c'.repeat(64)};
  const original = originalVerifiedView(db);
  const originalVersion = db.prepare('PRAGMA user_version').get().user_version;
  assert.ok(original);
  const schema = () => db.prepare("SELECT sql FROM sqlite_schema WHERE name='fiscal_checkout_verified_results'").get().sql;
  const witnessExists = () => !!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='pf700_bill2_numbered_journal'").get();
  assert.throws(() => persistNumberedJournal(db, candidate, proof), /Invalid numbered/);
  db.exec('BEGIN IMMEDIATE');
  db.exec('DROP TRIGGER fiscal_checkout_result_guard');
  assert.equal(originalVerifiedView(db), null);
  assert.throws(() => persistNumberedJournal(db, candidate, proof), /schema/);
  db.exec('ROLLBACK');
  for (const [input, evidence] of [
    [candidate, {...proof, binding:'d'.repeat(64)}],
    [{...candidate, attemptId:candidate.attemptId+1}, proof],
    [candidate, {...proof, fiscalReceiptCount:1, reversalCount:0}]
  ]) {
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => persistNumberedJournal(db, input, evidence));
    db.exec('ROLLBACK');
    assert.equal(witnessExists(), false);
  }
  db.exec('BEGIN IMMEDIATE');
  persistNumberedJournal(db, candidate, proof);
  db.exec('ROLLBACK');
  assert.equal(schema(), original);
  assert.equal(witnessExists(), false);
  assert.equal(db.prepare('SELECT count(*) n FROM fiscal_checkout_results').get().n, 0);
  db.exec('BEGIN IMMEDIATE');
  persistNumberedJournal(db, candidate, proof);
  persistNumberedJournal(db, candidate, proof);
  db.exec('COMMIT');
  assert.ok(schema().startsWith(original));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, originalVersion);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const result = db.prepare('SELECT status,source,reference,evidence FROM fiscal_checkout_verified_results').all();
  assert.equal(result.length, 1);
  assert.deepEqual({...result[0],evidence:JSON.parse(result[0].evidence)}, {
    status:'accepted',source:'device-'+candidate.serial,reference:'0000030',evidence:proof});
  assert.equal(db.prepare(`SELECT count(*) n FROM pf700_command_intents c JOIN pf700_command_acks a
    ON a.command_id=c.id WHERE c.command=56`).get().n, 0);
  for (const operation of ["DELETE FROM pf700_bill2_numbered_journal", "UPDATE pf700_bill2_numbered_journal SET evidence='{}'",
    "INSERT OR REPLACE INTO pf700_bill2_numbered_journal SELECT * FROM pf700_bill2_numbered_journal"]) {
    assert.throws(() => db.exec(operation), /immutable/);
  }
});
