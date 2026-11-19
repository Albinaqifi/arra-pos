const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes, randomInt } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const windows = { skip: process.platform !== 'win32' };
const version = '7.8.9'; // Fixture release, independent of the repository's current version.

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra offline launcher '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    LOCALAPPDATA: path.join(root, 'Local'),
    APPDATA: path.join(root, 'Roaming'),
    ARRA_MENU_TEST_DATA: path.join(root, 'inherited sample directory'),
    TEST_NODE: process.execPath,
    TEST_RECORDER: path.join(root, 'capture.cjs'),
    TEST_RECORD: path.join(root, 'launch.json'),
    TEST_SETUP: path.join(__dirname, '../src/desktop/setup-arra-sample.js'),
  };
  fs.mkdirSync(env.LOCALAPPDATA);
  fs.mkdirSync(env.APPDATA);
  fs.copyFileSync(path.join(__dirname, '../scripts/sample-installer/test-arra.ps1'), path.join(root, 'test-arra.ps1'));
  fs.writeFileSync(env.TEST_RECORDER, `
    require('node:fs').writeFileSync(process.env.TEST_RECORD, JSON.stringify({
      file: process.env.TEST_EXECUTABLE, cwd: process.cwd(), args: process.argv.slice(2)
    }));
  `);
  const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const run = (command, input) => spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: root, env, input, encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
  function launch(input) {
    fs.rmSync(env.TEST_RECORD, { force: true });
    // Route Start-Process to an argv recorder with native Windows argument parsing.
    return run(`
      function Start-Process($FilePath, [string[]]$ArgumentList, $WorkingDirectory) {
        $env:TEST_EXECUTABLE = $FilePath
        $argsToRecord = @('"' + $env:TEST_RECORDER + '"') + $ArgumentList
        $child = Microsoft.PowerShell.Management\\Start-Process -FilePath $env:TEST_NODE -ArgumentList $argsToRecord -WorkingDirectory $WorkingDirectory -NoNewWindow -PassThru -Wait
        if ($child.ExitCode -ne 0) { throw 'Argument recorder failed' }
      }
      & '.\\test-arra.ps1'
      exit $LASTEXITCODE
    `, input);
  }
  return { root, env, run, launch, versionFile: path.join(root, 'version.txt') };
}

test('offline launcher isolates a new release and reopens its saved test data', windows, (t) => {
  const { root, env, run, launch, versionFile } = fixture(t);
  const programRoot = path.join(env.LOCALAPPDATA, 'Arra POS Offline Test');
  const dataRoot = path.join(env.APPDATA, 'Arra POS Offline Test Data');
  const program = path.join(programRoot, version);
  const data = path.join(dataRoot, version);
  const stale = [
    path.join(env.LOCALAPPDATA, 'Arra POS Arra Menu Test 2'), path.join(env.APPDATA, 'Arra POS Arra Menu Test 2 Data'),
  ];
  for (const directory of stale) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'preserve'), 'older fixture');
  }
  const payload = path.join(root, 'payload');
  const app = path.join(payload, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(payload, 'electron.exe'), 'inert fixture');
  // Replace interactive prompts with a pipe to the actual sample database setup.
  fs.writeFileSync(path.join(payload, 'setup-arra.ps1'), `
    [Console]::In.ReadToEnd() | & $env:TEST_NODE $env:TEST_SETUP $env:ARRA_MENU_TEST_DATA
    if ($LASTEXITCODE -ne 0) { throw 'Sample setup failed' }
  `);
  const zipped = run("Compress-Archive -Path '.\\payload\\*' -DestinationPath '.\\payload.zip' -ErrorAction Stop");
  assert.equal(zipped.status, 0, zipped.stderr);
  // A stale payload in a newly labelled ZIP must not be installed as that release.
  fs.writeFileSync(versionFile, '7.8.10');
  const mismatched = launch();
  assert.equal(mismatched.status, 1, mismatched.stdout + mismatched.stderr);
  assert.deepEqual(fs.existsSync(programRoot) ? fs.readdirSync(programRoot) : [], []);
  assert.equal(fs.existsSync(dataRoot), false);
  assert.equal(fs.existsSync(env.TEST_RECORD), false);
  fs.writeFileSync(versionFile, version + '\r\n');
  const identities = ['entry', 'owner-a', 'owner-b', 'combined', 'staff', 'manager'];
  const input = [...identities.slice(0, 4).map(() => randomBytes(16).toString('hex')),
    String(randomInt(1000, 10000)), String(randomInt(100000, 1000000)), ...identities];
  const first = launch(JSON.stringify(input));
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const expected = {
    file: path.join(program, 'electron.exe'), cwd: program,
    args: [path.join(program, 'resources', 'app'), '--sample-data-directory=' + data,
      '--user-data-dir=' + path.join(data, 'browser-profile'), '--pf700-offline-checkout'],
  };
  const recorded = () => JSON.parse(fs.readFileSync(env.TEST_RECORD, 'utf8'));
  assert.deepEqual(recorded(), expected);
  const dbFile = path.join(data, 'arra.sqlite');
  const db = new DatabaseSync(dbFile);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dining_tables WHERE active=1').get().n, 16);
    for (const table of ['orders', 'order_items', 'bills', 'payments', 'account_a_closes', 'restaurant_shifts',
      'preparation_tickets', 'print_jobs', 'test_print_jobs', 'day_print_jobs']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    }
    db.exec("INSERT INTO orders(table_id, opened_at, status) VALUES (1, 1234, 'open')");
  } finally { db.close(); }
  for (const directory of [path.join(programRoot, '7.8.8'), path.join(dataRoot, '7.8.8')]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'preserve'), 'older fixture');
    stale.push(directory);
  }
  fs.unlinkSync(path.join(root, 'payload.zip'));
  const reopened = launch();
  assert.equal(reopened.status, 0, reopened.stdout + reopened.stderr);
  assert.deepEqual(recorded(), expected);
  const saved = new DatabaseSync(dbFile, { readOnly: true });
  try { assert.equal(saved.prepare('SELECT opened_at FROM orders WHERE table_id=1').get().opened_at, 1234); }
  finally { saved.close(); }
  fs.writeFileSync(path.join(program, 'resources', 'app', 'package.json'), JSON.stringify({ version: '7.8.8' }));
  const wrongInstalled = launch();
  assert.equal(wrongInstalled.status, 1, wrongInstalled.stdout + wrongInstalled.stderr);
  assert.equal(fs.existsSync(env.TEST_RECORD), false);
  for (const directory of stale) {
    assert.deepEqual(fs.readdirSync(directory), ['preserve']);
    assert.equal(fs.readFileSync(path.join(directory, 'preserve'), 'utf8'), 'older fixture');
  }
});

test('offline launcher rejects missing or malformed version before installing or launching', windows, (t) => {
  const { env, launch, versionFile } = fixture(t);
  for (const invalid of [null, '7.8', '..\\7.8.9']) {
    if (invalid !== null) fs.writeFileSync(versionFile, invalid);
    const result = launch();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /version/i);
    assert.equal(fs.existsSync(env.TEST_RECORD), false);
    assert.deepEqual(fs.readdirSync(env.LOCALAPPDATA), []);
    assert.deepEqual(fs.readdirSync(env.APPDATA), []);
  }
});
