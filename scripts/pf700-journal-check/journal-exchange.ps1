# Dedicated read-only allowlist, separate from checkout. No diagnostic, sale,
# tender, report, printer output or arbitrary command is accepted here.
$ErrorActionPreference = 'Stop'
function Read-Reply($Port) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $bytes = [Collections.Generic.List[byte]]::new()
    $length = 0; $busy = 0
    while ($clock.ElapsedMilliseconds -lt 20000) {
        try { $next = $Port.ReadByte() } catch [TimeoutException] { continue }
        if ($next -lt 0) { throw 'Incomplete reply' }
        if ($bytes.Count -eq 0) {
            if ($next -eq 0x16 -and $busy -lt 48) { $busy++; continue }
            if ($next -ne 1) { throw 'Unexpected reply' }
        } elseif ($bytes.Count -eq 1) {
            $length = $next - 0x20 + 6
            if ($length -lt 17 -or $length -gt 101) { throw 'Invalid reply length' }
        }
        $bytes.Add($next)
        if ($bytes.Count -eq $length) { return ,$bytes.ToArray() }
    }
    throw 'Reply timeout'
}

if (![Console]::IsInputRedirected -or ![Console]::IsOutputRedirected) { exit 1 }
$port = [IO.Ports.SerialPort]::new('COM3', 9600, [IO.Ports.Parity]::None, 8, [IO.Ports.StopBits]::One)
$port.Handshake = [IO.Ports.Handshake]::None; $port.DtrEnable = $false; $port.RtsEnable = $false
$port.WriteTimeout = 1000; $port.ReadTimeout = 300
$stage = 0; $priorSequence = -1; $opened = $false
try {
    while ($null -ne ($line = [Console]::ReadLine())) {
        if ($stage -gt 305 -or $line -cnotmatch '\A(?:[0-9a-f]{2}){10,101}\z') { throw 'Invalid request' }
        [byte[]]$request = @(for ($i = 0; $i -lt $line.Length; $i += 2) { [Convert]::ToByte($line.Substring($i,2),16) })
        if ($request[0] -ne 1 -or $request[1] -ne $request.Length + 26 -or $request[-1] -ne 3) { throw 'Invalid frame' }
        $sequence = [int]$request[2]; $command = [int]$request[3]
        if ($sequence -lt 0x20 -or $sequence -gt 0x7f -or ($priorSequence -ge 0 -and $sequence -eq $priorSequence)) { throw 'Invalid sequence' }
        $payload = [Text.Encoding]::ASCII.GetString($request, 4, $request.Length - 10)
        $valid = if ($stage -lt 2) { $command -eq 90 -and $payload -ceq '0' }
            elseif ($stage -eq 2) { $command -eq 76 -and $payload -ceq 'T' }
            elseif ($stage -eq 3) { $command -eq 113 -and $payload -ceq '' }
            elseif ($stage -eq 4) { $command -eq 119 -and $payload -cmatch '\AR,[0-9]{7}\z' }
            else { $command -eq 119 -and $payload -ceq 'N' }
        if (!$valid) { throw 'Command not allowed' }
        if (!$opened) { $port.Open(); $opened = $true }
        if ($port.BytesToRead -ne 0) { throw 'Pending input' }
        $port.Write($request,0,$request.Length)
        [byte[]]$reply = Read-Reply $port
        if ($port.BytesToRead -ne 0) { throw 'Trailing input' }
        [Console]::WriteLine([BitConverter]::ToString($reply).Replace('-',''))
        [Console]::Out.Flush()
        $priorSequence = $sequence; $stage++
    }
} catch {
    [Console]::WriteLine('FAIL'); [Console]::Out.Flush()
} finally { $port.Dispose() }
