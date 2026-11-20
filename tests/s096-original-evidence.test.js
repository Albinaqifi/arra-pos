const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { inspectLocked } = require('../scripts/pf700-original-evidence/inspect');

const hash = text => createHash('sha256').update(text).digest('hex');
const scriptDir = path.join(__dirname, '../scripts/pf700-original-evidence');

function fixture(t) {
  // The long digest and SQLite rollback suffix can exceed MAX_PATH in the
  // Windows sandbox's deeply nested system temp directory.
  const root = fs.mkdtempSync(path.join(__dirname, '.original-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, 'Arra POS PF700 Commissioning');
  const directory = path.join(root, 'Arra POS', 'PF700 commissioning');
  fs.mkdirSync(profile);
  fs.mkdirSync(directory, { recursive: true });
  const serial = 'TESTUNIT001', previousDocument = '0832504';
  const documentNumber = String(Number(previousDocument) + 1).padStart(7, '0');
  const receipt = { billId: 1, method: 'cash', account: 'A', total: 70, currency: 'MKD', domesticProduct: true,
    lines: [{ itemId: 4, name: 'Espresso', unitPrice: 70, quantity: 1, taxGroup: '\u0412', taxRate: 10, modifiers: [] }] };
  const attempt = { id: 8, started_at: 11, actor_id: 7, receipt: JSON.stringify(receipt), created_at: 10,
    fingerprint: 'synthetic', order_id: 3, generated_at: 9 };
  const counts = { fiscalReceiptCount: 15, reversalCount: 2 };
  const evidence = { documentNumber, ...counts };
  const database = path.join(profile, 'arra.sqlite');
  const ledger = path.join(directory, hash(serial + ':' + documentNumber) + '.finish.sqlite');
  const marker = path.join(directory, hash(serial) + '.used');
  const app = new DatabaseSync(database);
  try {
    app.exec(`CREATE TABLE pf700_commissioning_enrollment(id);
      CREATE TABLE bills(id, fingerprint, order_id, generated_at, total);
      CREATE TABLE orders(id,status,retired_empty);
      CREATE TABLE bill_lines(bill_id,item_id,name,unit_price,quantity,modifiers);
      CREATE TABLE order_items(id,product_id,status,order_id);
      CREATE TABLE order_item_fiscal_tax(item_id,tax_group);
      CREATE TABLE fiscal_checkout_attempts(id,bill_id,started_at);
      CREATE TABLE fiscal_checkout_baselines(attempt_id,device_id,previous_document);
      CREATE TABLE fiscal_checkout_sales(bill_id,actor_id,receipt,created_at,device_id,mode,method);
      CREATE TABLE fiscal_checkout_results(attempt_id,status,source,reference,evidence);
      CREATE VIEW fiscal_checkout_verified_results AS SELECT * FROM fiscal_checkout_results WHERE status='accepted';
      CREATE TABLE payments(bill_id,actor_id,amount,method,account);
      INSERT INTO pf700_commissioning_enrollment VALUES(1);
      INSERT INTO bills VALUES(1,'synthetic',3,9,70);
      INSERT INTO orders VALUES(3,'completed',0);
      INSERT INTO bill_lines VALUES(1,4,'Espresso',70,1,'[]');
      INSERT INTO order_items VALUES(4,'arra-product-11-0','sent',3);
      INSERT INTO order_item_fiscal_tax VALUES(4,'\u0412');
      INSERT INTO fiscal_checkout_attempts VALUES(8,1,11);
      INSERT INTO payments VALUES(1,7,70,'cash','A');`);
    app.prepare("INSERT INTO fiscal_checkout_sales VALUES(1,7,?,10,?,'device','cash')").run(attempt.receipt, serial);
    app.prepare('INSERT INTO fiscal_checkout_baselines VALUES(8,?,?)').run(serial, previousDocument);
    app.prepare("INSERT INTO fiscal_checkout_results VALUES(8,'accepted',?,?,?)")
      .run('device-' + serial, documentNumber, JSON.stringify(evidence));
  } finally { app.close(); }
  fs.writeFileSync(marker, '');
  const journal = new DatabaseSync(ledger);
  try {
    journal.exec('CREATE TABLE events(step INTEGER PRIMARY KEY,binding TEXT NOT NULL,details TEXT NOT NULL,at INTEGER NOT NULL) STRICT');
    const insert = journal.prepare('INSERT INTO events VALUES(?,?,?,?)');
    const binding = hash(JSON.stringify([{ serial, previousDocument }, attempt]));
    const details = [{ action: 'cash-tender-intent', billId: 1, attemptId: 8 },
      { action: 'close-intent', items: 1, amountRaw: 7000, tenderRaw: 7000 }, counts, evidence];
    details.forEach((value, i) => insert.run(i + 1, binding, JSON.stringify(value), i + 12));
  } finally { journal.close(); }
  return { root, database, ledger, marker, directory, profile, check: () => inspectLocked(root, root) };
}

function edit(filename, sql) {
  const db = new DatabaseSync(filename);
  try { db.exec(sql); } finally { db.close(); }
}

test('the original fingerprint, four ordered stages and one matched Cash A payment produce only redacted text', t => {
  const f = fixture(t);
  const before = [f.database, f.ledger, f.marker].map(file => hash(fs.readFileSync(file)));
  assert.equal(f.check(), 'MATCH');
  assert.equal(f.check().split('\n').length, 1);
  assert.deepEqual([f.database, f.ledger, f.marker].map(file => hash(fs.readFileSync(file))), before);
  assert.equal(fs.readdirSync(f.directory).length, 2);
  assert.equal(fs.readdirSync(f.profile).length, 1);
});

test('each valid journal prefix remains incomplete', t => {
  const f = fixture(t);
  for (let step = 4; step > 0; step--) {
    edit(f.ledger, 'DELETE FROM events WHERE step=' + step);
    assert.equal(f.check(), 'STAGE' + (step - 1));
  }
});

for (const [label, file, sql] of [
  ['receipt reserialization changes its original fingerprint', 'database', "UPDATE fiscal_checkout_sales SET receipt=receipt || ' '"],
  ['mismatching bound order item', 'database', "UPDATE order_items SET product_id='other'"],
  ['another billed item with missing fiscal data', 'database', "INSERT INTO bill_lines VALUES(1,9,'other',7,1,'[]')"],
  ['ambiguous original attempt', 'database', 'INSERT INTO fiscal_checkout_attempts VALUES(2,1,50)'],
  ['binding from a different checkout', 'ledger', "UPDATE events SET binding='other' WHERE step=2"],
  ['missing interior stage', 'ledger', 'DELETE FROM events WHERE step=2'],
  ['unconfirmed tender stage', 'ledger', "UPDATE events SET details=json_set(details,'$.tenderRaw',0) WHERE step=2"],
  ['unexpected event format', 'ledger', "UPDATE events SET details=json_set(details,'$.other',1) WHERE step=1"],
  ['different counters at final verification', 'ledger', "UPDATE events SET details=json_set(details,'$.fiscalReceiptCount',2) WHERE step=4"],
  ['different final document', 'database', "UPDATE fiscal_checkout_results SET reference='other'"],
  ['result excluded from Arra verification', 'database', 'DROP VIEW fiscal_checkout_verified_results; CREATE VIEW fiscal_checkout_verified_results AS SELECT * FROM fiscal_checkout_results WHERE 0'],
  ['unexpected result for a different device', 'database', "UPDATE fiscal_checkout_results SET source='other'"],
  ['unsettled order with payment', 'database', "UPDATE orders SET status='open'"],
  ['ambiguous payment', 'database', 'INSERT INTO payments SELECT * FROM payments'],
  ['wrong payment actor', 'database', 'UPDATE payments SET actor_id=0'],
  ['wrong payment account', 'database', "UPDATE payments SET account='B'"],
]) {
  test(label, t => {
    const f = fixture(t);
    edit(f[file], sql);
    assert.throws(f.check);
  });
}

test('verified journal without an Arra payment separately identifies the incomplete settlement', t => {
  const f = fixture(t);
  edit(f.database, "DELETE FROM payments; UPDATE orders SET status='open'");
  assert.equal(f.check(), 'UNSETTLED');
  edit(f.database, 'DELETE FROM fiscal_checkout_results');
  assert.equal(f.check(), 'UNSETTLED');
});

test('an absent marker, ambiguous journal or sample profile cannot pass', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.profile, 'SAMPLE-DATA-ONLY'), '');
  assert.throws(f.check);
  fs.unlinkSync(path.join(f.profile, 'SAMPLE-DATA-ONLY'));
  fs.writeFileSync(path.join(f.directory, 'different.finish.sqlite'), '');
  assert.throws(f.check);
  fs.unlinkSync(path.join(f.directory, 'different.finish.sqlite'));
  fs.unlinkSync(f.marker);
  assert.throws(f.check);
});

test('Windows launcher checks fixed paths, rejects companion files and locks, and releases both originals', {
  skip: process.platform !== 'win32'
}, t => {
  const f = fixture(t);
  const kit = path.join(f.root, 'kit');
  fs.cpSync(scriptDir, kit, { recursive: true });
  fs.mkdirSync(path.join(kit, 'runtime'));
  fs.copyFileSync(process.execPath, path.join(kit, 'runtime', 'node.exe'));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const launcher = path.join(kit, 'read-original.ps1');
  const env = { ...process.env, APPDATA: f.root, LOCALAPPDATA: f.root };
  const run = (args = ['-File', launcher], variables = env) => {
    const proc = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { env: variables, encoding: 'utf8' });
    assert.equal(proc.error, undefined);
    assert.equal(proc.stderr, '');
    return { code: proc.status, line: proc.stdout.trim() };
  };
  assert.match(run().line, /^MATCH - /);
  const sidecar = f.ledger + '-journal';
  fs.writeFileSync(sidecar, 'untouched');
  assert.match(run().line, /companion files/);
  assert.equal(fs.readFileSync(sidecar, 'utf8'), 'untouched');
  fs.unlinkSync(sidecar);
  // The writer is a separate process. No SQLite connection to the in-use
  // file is needed to detect it.
  const locked = run(['-Command',
    "$db=Join-Path $env:APPDATA 'Arra POS PF700 Commissioning/arra.sqlite';" +
    "$f=[IO.File]::Open($db,'Open','ReadWrite','Read');" +
    "try { & (Join-Path $env:APPDATA 'kit/read-original.ps1') } finally { $f.Dispose() }"]);
  assert.match(locked.line, /^INCONCLUSIVE/);
  assert.match(run().line, /^MATCH - /);
  fs.renameSync(f.ledger, f.ledger + '.moved');
  assert.match(run().line, /^MISSING/);
  fs.renameSync(f.ledger + '.moved', f.ledger);
  // Exercise the ancestor ordering without granting junction-creation
  // privileges or making a network lookup. Only file metadata is stubbed
  // in this copy of the launcher; the path-walk and stop policy are real.
  const pathCheck = path.join(kit, 'path-check.ps1');
  const sourcePs = fs.readFileSync(launcher, 'utf8');
  const simulatedAttrs = "if ($part -ceq $env:APPDATA) { [IO.FileAttributes]::ReparsePoint } " +
    "elseif ($part.StartsWith($env:APPDATA + '\\')) { [Console]::WriteLine('walked past redirected parent'); throw 'unexpected' } " +
    "else { [IO.File]::GetAttributes($part) }";
  fs.writeFileSync(pathCheck, sourcePs.replace('[IO.File]::GetAttributes($part)', () => simulatedAttrs));
  const redirected = run(['-File', pathCheck]);
  assert.match(redirected.line, /^INCONCLUSIVE[^\r\n]+$/);
  const noDrive = sourcePs.replace('[IO.DriveInfo]::new([IO.Path]::GetPathRoot($path)).DriveType',
    "(& { [Console]::WriteLine('unexpected drive lookup'); throw 'unexpected' })");
  fs.writeFileSync(pathCheck, noDrive);
  const network = run(['-File', pathCheck], { ...env, APPDATA: '\\\\example.invalid\\unused' });
  assert.match(network.line, /^INCONCLUSIVE[^\r\n]+$/);
  const source = path.join(kit, 'inspect.js');
  fs.renameSync(source, source + '.saved');
  const missing = run();
  assert.deepEqual(missing, { code: 1, line: 'INCONCLUSIVE - The inspector could not run. Extract the complete ZIP and try again.' });
  fs.writeFileSync(source, "console.log('unexpected output');console.error('unexpected diagnostic');");
  assert.deepEqual(run(), missing);
  fs.unlinkSync(source);
  fs.renameSync(source + '.saved', source);
  fs.writeFileSync(path.join(f.directory, 'another.finish.sqlite'), '');
  const multiple = run();
  assert.equal(multiple.code, 1);
  assert.match(multiple.line, /Multiple recovery journals/);
});
