// Standalone diagnostic for an operator at the Windows POS. Only the explicit
// live option reaches the serial port. Electron main and preload do not import it.
const { execFileSync } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PF700_PROFILE, readImmediateStatus, rehearseStatus } = require('./pf700-status');

function queryWindowsPort() {
  if (process.platform !== 'win32') throw new Error('A live status check requires Windows.');
  // Avoid reusing a predictable last sequence when another POS used the port.
  // A matching reply by itself cannot establish device identity or freshness.
  return readImmediateStatus(randomInt(0x20, 0x100), request => {
    const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const readStatusReply = readFileSync(path.join(__dirname, 'pf700-read-status.ps1'), 'utf8');
    // Only source-controlled settings and bytes of the fixed status request
    // enter this command. No caller-supplied command, port or script is accepted.
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
${readStatusReply}
$port = [IO.Ports.SerialPort]::new('${PF700_PROFILE.port}', ${PF700_PROFILE.baudRate}, [IO.Ports.Parity]::None, ${PF700_PROFILE.dataBits}, [IO.Ports.StopBits]::One)
try {
  $port.Handshake = [IO.Ports.Handshake]::None
  $port.DtrEnable = $false
  $port.RtsEnable = $false
  $port.WriteTimeout = 500
  $port.ReadTimeout = 500
  $port.Open()
  if ($port.BytesToRead -gt 0) { exit 12 }
  [byte[]]$request = @(${Array.from(request).join(',')})
  $port.Write($request, 0, $request.Length)
  [byte[]]$reply = Read-Pf700StatusReply $port
  if ($port.BytesToRead -gt 0) { exit 13 }
  [Console]::OpenStandardOutput().Write($reply, 0, $reply.Length)
} catch [TimeoutException] {
  exit 10
} catch {
  exit 11
} finally {
  $port.Dispose()
}
exit 0`;
    try {
      return execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')], {
        windowsHide: true, timeout: 8000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      if (error.status === 10 || error.code === 'ETIMEDOUT') throw new Error('Timed out waiting for a complete status reply.');
      if (error.status === 12) throw new Error('The port already has pending data. No status request was sent.');
      if (error.status === 13) throw new Error('The port returned unexpected extra data.');
      throw new Error('Could not complete the Windows serial status check. Check the port and whether another program is using it.');
    }
  });
}

function runDiagnostic(args, query = queryWindowsPort) {
  if (args.length === 0) {
    rehearseStatus();
    return 'Offline PF700 rehearsal passed using a simulated response.';
  }
  if (args.length !== 1 || args[0] !== '--read-device-status') {
    throw new Error('Use no arguments for the offline rehearsal, or --read-device-status for an intentional live status check.');
  }
  const result = query();
  return `Received a PF-compatible status reply on ${PF700_PROFILE.port}. Status bytes: ${result.statusBytes}. Frame status bytes: ${result.frameStatusBytes}.`;
}

if (require.main === module) {
  try {
    console.log(runDiagnostic(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { runDiagnostic };
