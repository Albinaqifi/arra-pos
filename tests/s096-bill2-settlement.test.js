const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { registerBusinessDays } = require('../src/desktop/business-days');
const { lostClose } = require('./support/pf700-bill2-sale');
const { recoverySession, finish } = require('./support/pf700-bill2-session');
const { readCandidate } = require('../src/desktop/pf700-bill2-candidate');
const { savedCapture, resultPath } = require('../src/desktop/pf700-bill2-capture');
const { collectOnce, markerPath } = require('../scripts/pf700-close-evidence/collect');
const { summarizeBill2Journal } = require('../scripts/pf700-close-evidence/match-journal');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const totals = db => ['payments','fiscal_checkout_results','test_print_attempts'].map(table =>
  db.prepare('SELECT count(*) count FROM ' + table).get().count);

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'arra-bill2-'));
  const filename = path.join(directory,'arra.sqlite');
  // The sale helper registers a close after the test, before removing its folder.
  const cleanups = [];
  t.after(() => {
    for (const close of cleanups) close();
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const {db,device} = await lostClose({after:fn => cleanups.push(fn)}, 'after', {filename,originalPayer:2});
  const candidate = readCandidate(db,2,'0000030',{matchJournalPaper:true});
  assert.ok(candidate);
  const flags = Buffer.from('888082e1809a','hex');
  const body = Buffer.concat([Buffer.from([49,candidate.sequence,74]),flags,Buffer.from([4]),flags,Buffer.from([5])]);
  const sum = body.reduce((a,b) => a + b,0);
  const frame = Buffer.concat([Buffer.from([1]),body,Buffer.from([12,8,4,0].map(s => 48 + ((sum >> s) & 15))),Buffer.from([3])]);
  collectOnce(candidate,directory,() => ({source:'PROBE',frame}));
  const captureHash = savedCapture(directory,candidate);
  const capture = markerPath(directory,candidate.serial);
  const journal = resultPath(directory,candidate);
  const vat = ['ВКУПНО ДДВ А=18,00% 0,00','ВКУПНО ДДВ Б=5,00% 0,00',
    'ВКУПНО ДДВ В=10,00% 13,64','ВКУПНО ДДВ Г=0,00% 0,00'];
  const vatTotal = 'ВКУПНО ДДВ 13,64';
  const lines = ['',...Array(8).fill('synthetic header'),'1 x 70,00','Espresso 70,00 В','1 x 80,00',
    'Macchiato 80,00 В','* * *','ПРОМЕТ ОД МАКЕДОНСКИ ПР. 150,00',...vat,vatTotal,'* * *',
    'ВКУПЕН ПРОМЕТ 150,00',vatTotal,...vat,'ВО ГОТОВО 150,00','0000013 ДАТУМ 01.01.26 ВРЕМЕ 10:15',
    ...Array(3).fill('synthetic footer'),'','0000030'];
  const at = Date.now();
  const reservation = {version:1,type:'journal-reserved',billId:2,attemptId:candidate.attemptId,
    document:'0000030',binding:candidate.binding,priorCaptureHash:captureHash,at};
  const observation = {type:'journal-observation',at,result:{...summarizeBill2Journal(lines,'separator',candidate.serial),
    receiptState:'retained',lastDocumentMatched:true,responseHash:digest('synthetic exchange')}};
  function writeJournal(header = reservation, entry = observation) {
    const bytes = JSON.stringify(header) + '\n' + JSON.stringify(entry) + '\n';
    fs.writeFileSync(journal,bytes);
    return digest(bytes);
  }
  const pin = writeJournal();
  return {db,device,filename,directory,pin,capture,journal,reservation,observation,writeJournal,
    session:(approval = pin, actor = 1) => recoverySession(db,directory,approval,actor)};
}

test('read-only reopen and direct requests require the approved capture, exact journal and explicit finish', async t => {
  const f = await fixture(t);
  const session = f.session();
  const initial = totals(f.db);
  const reviewed = session.review().data;
  assert.equal(reviewed.fiscal.status,'submitted');
  assert.equal(reviewed.fiscal.reference,'0000030');
  assert.deepEqual(reviewed.fiscal.evidence, {kind:'numbered-journal',documentNumber:'0000030'});
  assert.equal(reviewed.total,150);
  assert.deepEqual(totals(f.db),initial);
  for (const request of [
    {billId:2,account:'A',method:'cash'}, {billId:2,account:'A',method:'cash',physicalIntentId:1},
    {...finish,acknowledgedDocument:'0000031'}, {...finish,billId:1}, {...finish,account:'B'},
    {...finish,method:'card'}, {...finish,evidence:f.observation}, {...finish,journalHash:f.pin}
  ]) assert.equal((await session.pay(request)).ok,false);
  assert.equal(f.session(f.pin,2).pay(finish).error,'Access denied');
  assert.equal(f.session(null).pay(finish).ok,false);
  assert.equal(f.session('b'.repeat(64)).pay(finish).ok,false);
  const capture = fs.readFileSync(f.capture);
  fs.appendFileSync(f.capture,'\n');
  assert.equal(session.pay(finish).ok,false);
  fs.writeFileSync(f.capture,capture);
  for (const header of [{...f.reservation,billId:1},{...f.reservation,attemptId:2},
    {...f.reservation,binding:'b'.repeat(64)},{...f.reservation,priorCaptureHash:'c'.repeat(64)}]) {
    assert.equal(f.session(f.writeJournal(header)).review().ok,false);
  }
  for (const change of [{receiptState:'cleared'},{lastDocumentMatched:false},{end:'end-of-data'},
    {reason:'identity'},{responseHash:null},{counts:{...f.observation.result.counts,documentMentions:2}},
    {structure:f.observation.result.structure.with(11,'unrecognized-tender')}]) {
    const pin = f.writeJournal(f.reservation,{...f.observation,result:{...f.observation.result,...change}});
    assert.equal(f.session(pin).pay(finish).ok,false);
  }
  fs.unlinkSync(f.journal);
  assert.equal(session.pay(finish).ok,false);
  assert.deepEqual(totals(f.db),initial);
  assert.deepEqual(session.writes,[]);
});

test('every supervised-card file or inspection error holds a previously reviewed cash finish', async t => {
  const f = await fixture(t), session = f.session();
  const initial = totals(f.db);
  assert.equal(session.review().data.fiscal.status,'submitted');
  for (const phase of ['claim','outcome','dispatch']) {
    const filename = path.join(f.directory,'supervised-card.' + phase);
    // Both a complete file and a malformed one forbid this pre-card recovery.
    const token = '1'.repeat(32) + ':' + digest(f.device.serial);
    for (const content of [phase === 'outcome' ? token + ':approved' : token,'']) {
      fs.writeFileSync(filename,content);
      assert.equal(session.review().ok,false);
      assert.equal(session.pay(finish).ok,false);
      fs.unlinkSync(filename);
    }
  }
  const stat = fs.lstatSync;
  const guard = t.mock.method(fs,'lstatSync',file => {
    if (path.basename(file) === 'supervised-card.dispatch') throw Object.assign(Error('Fixture'),{code:'EACCES'});
    return stat(file);
  });
  assert.equal(session.review().ok,false);
  assert.equal(session.pay(finish).ok,false);
  guard.mock.restore();
  f.db.exec('SAVEPOINT changed; PRAGMA user_version=53');
  assert.equal(session.pay(finish).ok,false,'v53 cannot omit the supervised-card tables');
  f.db.exec('ROLLBACK TO changed; RELEASE changed');
  f.db.exec('CREATE TABLE pf700_card_intents(id INTEGER PRIMARY KEY)');
  assert.equal(session.review().ok,false,'a v50 database cannot have a partial supervised-card schema');
  assert.deepEqual(totals(f.db),initial);
  assert.deepEqual(session.writes,[]);
});

test('ordinary accepted result and complete ACK trace cannot substitute for the pinned witness', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'arra-other-ack-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  for (const fault of ['after','afterTrace']) {
    const {db} = await lostClose(t,fault);
    if (fault === 'after') db.prepare(`INSERT INTO fiscal_checkout_results VALUES
      (1,'accepted','device-SYNTHETIC01','0000030',?,1)`).run(JSON.stringify({
      documentNumber:'0000030',fiscalReceiptCount:1,reversalCount:0}));
    const initial = totals(db);
    const used = recoverySession(db,directory,digest('other receipt'));
    assert.equal(recoverySession(db,directory,null).review().data.fiscal.status,'submitted');
    assert.equal(used.review().ok,false);
    assert.equal(used.pay(finish).ok,false);
    assert.deepEqual(totals(db),initial);
    assert.deepEqual(used.writes,[]);
  }
});

test('failed local payment rolls back journal proof, guards and audit; restart settles without hardware', async t => {
  const f = await fixture(t);
  const snapshot = () => f.db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
  const before = snapshot(), initial = totals(f.db), wire = f.device.transcript.length;
  f.db.exec(`CREATE TEMP TRIGGER fail_payment BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'fixture'); END`);
  assert.equal(f.session().pay(finish).ok,false);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(totals(f.db),initial);
  f.db.exec('DROP TRIGGER fail_payment');
  const session = f.session(), paid = session.pay(finish);
  assert.ok(paid.ok);
  fs.unlinkSync(f.journal);
  fs.unlinkSync(f.capture);
  assert.equal(f.session('b'.repeat(64)).pay(finish).ok,false);
  const retry = f.session().pay(finish);
  assert.deepEqual(retry,paid);
  fs.writeFileSync(path.join(f.directory,'supervised-card.claim'),'unrelated');
  assert.equal(f.session().pay(finish).ok,false);
  assert.deepEqual(session.writes,[]);
  assert.equal(f.device.transcript.length,wire);
  assert.deepEqual(totals(f.db),[1,1,initial[2]]);
  assert.deepEqual({...f.db.prepare('SELECT amount,method,account,actor_id FROM payments').get()},
    {amount:150,method:'cash',account:'A',actor_id:2});
  assert.deepEqual(f.db.prepare("SELECT actor_id FROM application_audit WHERE action='recover' AND entity_type='fiscal_checkout'").all().map(r=>r.actor_id),[1]);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=2').get().status,'completed');
  const proof = JSON.parse(f.db.prepare('SELECT evidence FROM fiscal_checkout_verified_results').get().evidence);
  assert.equal(proof.journalHash,f.pin);
  assert.equal(proof.captureHash,f.reservation.priorCaptureHash);
  assert.equal(proof.binding,f.reservation.binding);
  assert.equal(proof.responseHash,f.observation.result.responseHash);
  assert.equal(Object.hasOwn(proof,'fiscalReceiptCount'),false);
  assert.equal(Object.hasOwn(proof,'reversalCount'),false);
});

test('the closed local day includes one Cash A payment while the device report holds for missing counters', async t => {
  const f = await fixture(t);
  assert.equal(f.session().pay(finish).ok,true);
  f.db.exec(`INSERT INTO local_users(id,username,salt,password_hash) VALUES(3,'sample-combined',x'00',x'00');
    INSERT INTO financial_scopes VALUES(3,'combined');
    INSERT INTO user_permissions VALUES(3,'business_days.close')`);
  const owner = {currentUserId:() => 3, authenticatedUserId:() => 3};
  const commands = [];
  let handleDays;
  registerBusinessDays({handle(name,handler) { handleDays = handler; }}, () => true, f.db, owner,
    () => 'accepted', {mode:'device',deviceId:f.device.serial,
      issueDailyReport() { commands.push('issue'); }, reconcileDailyReport() { commands.push('reconcile'); }});
  const days = request => handleDays({},request);
  const {id:dayId} = days({action:'list'}).data.days.find(day => day.closedAt === null);
  assert.equal(days({action:'close',dayId}).ok,true);
  await new Promise(setImmediate);
  const summary = days({action:'accountAList'}).data.days.find(day => day.id === dayId);
  assert.deepEqual([summary.count,summary.cash,summary.card,summary.total],[1,150,0,150]);
  assert.deepEqual(summary.fiscal,{mode:'device',status:'blocked',reason:'period'});
  assert.deepEqual(await days({action:'accountAFiscalClose',dayId,mode:'device',confirmed:true}),
    {ok:false,error:'period'});
  assert.deepEqual(commands,[]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fiscal_daily_reports').get().n,0);
});

test('two workers finishing the same reviewed receipt return one payment and one audit', async t => {
  const f = await fixture(t);
  const attempts = totals(f.db)[2];
  const workers = [1,2].map(() => new Worker(require.resolve('./support/pf700-bill2-session'),{
    workerData:{bill2Race:true,filename:f.filename,directory:f.directory,pin:f.pin}
  }));
  t.after(() => Promise.all(workers.map(worker => worker.terminate())));
  const ready = await Promise.all(workers.map(worker => once(worker,'message')));
  assert.deepEqual(ready,[['submitted'],['submitted']]);
  const done = workers.map(worker => once(worker,'message'));
  for (const worker of workers) worker.postMessage('finish');
  const [[one],[two]] = await Promise.all(done);
  assert.ok(one.result.ok);
  assert.deepEqual(one,two);
  assert.deepEqual(one.writes,[]);
  assert.deepEqual(totals(f.db),[1,1,attempts]);
  assert.equal(f.db.prepare("SELECT count(*) n FROM application_audit WHERE entity_type='fiscal_checkout' AND action='recover'").get().n,1);
});
