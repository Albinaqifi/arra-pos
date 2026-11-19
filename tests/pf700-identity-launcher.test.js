const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('the Windows identity shortcut stages only the program and always selects the read-only action', {
  skip: process.platform !== 'win32',
}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'Arra identity launcher '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = path.join(root, 'payload');
  const app = path.join(payload, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  const scripts = path.join(__dirname, '../scripts/sample-installer');
  const shortcut = 'PF700-Check-Identity.cmd';
  for (const name of [shortcut, 'check-pf700-identity.ps1']) {
    fs.copyFileSync(path.join(scripts, name), path.join(root, name));
    fs.copyFileSync(path.join(scripts, name), path.join(payload, name));
  }
  fs.copyFileSync(path.join(scripts, 'test-arra.ps1'), path.join(root, 'test-arra.ps1'));
  const versionFile = path.join(root, 'version.txt');
  fs.writeFileSync(versionFile, '1.0.5');
  fs.writeFileSync(path.join(app, 'package.json'), '{"version":"1.0.5"}');
  fs.writeFileSync(path.join(payload, 'electron.exe'), 'Inert fixture');
  fs.writeFileSync(path.join(payload, 'setup-arra.ps1'), "throw 'Unexpected training setup'");
  fs.writeFileSync(path.join(payload, 'start-supervised-pf700.ps1'), [
    'param([switch]$CheckIdentityOnly)',
    'if (!$CheckIdentityOnly -or $args.Count) { throw "Unexpected arguments" }',
    '[IO.File]::AppendAllText($env:QA_IDENTITY_CALLS, "identity`n")',
  ].join('\n'));

  const env = { ...process.env, LOCALAPPDATA: path.join(root, 'Local'), APPDATA: path.join(root, 'Roaming'),
    QA_IDENTITY_CALLS: path.join(root, 'identity calls') };
  fs.mkdirSync(env.LOCALAPPDATA);
  fs.mkdirSync(env.APPDATA);
  const cmd = path.join(process.env.SystemRoot, 'System32/cmd.exe');
  const ps = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const packageResult = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    "Compress-Archive -Path '.\\payload\\*' -DestinationPath '.\\payload.zip' -ErrorAction Stop"], {
    cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(packageResult.error);
  assert.equal(packageResult.status, 0, packageResult.stderr);
  function open(directory, argumentText = '') {
    const result = spawnSync(cmd, ['/d', '/c', shortcut + argumentText], {
      cwd: directory, env, input: '\r\n', windowsHide: true, encoding: 'utf8', timeout: 30000,
      windowsVerbatimArguments: true,
    });
    assert.ifError(result.error);
    return result.status;
  }
  for (const args of [' -StartSale', ' "" -StartSale', ' -PrepareData']) assert.notEqual(open(root, args), 0);
  fs.writeFileSync(versionFile, '1.0.4');
  assert.notEqual(open(root), 0);
  assert.deepEqual(fs.readdirSync(env.LOCALAPPDATA), []);
  assert.ok(!fs.existsSync(env.QA_IDENTITY_CALLS));
  fs.writeFileSync(versionFile, '1.0.5');

  assert.equal(open(root), 0);
  const program = path.join(env.LOCALAPPDATA, 'Arra POS Offline Test', '1.0.5');
  assert.equal(open(program), 0);
  assert.deepEqual(fs.readFileSync(env.QA_IDENTITY_CALLS, 'utf8').trimEnd().split(/\r?\n/), ['identity', 'identity']);
  assert.deepEqual(fs.readdirSync(env.APPDATA), []);
});
