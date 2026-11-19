# Windows PowerShell 5.1. The checkout process owns the private stdin/stdout
# pipes. Running this helper with no valid identity probe opens no port.
function Read-Pf700CheckoutReply($Port) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $frame = [Collections.Generic.List[byte]]::new()
    $busy = 0
    $expected = 0
    while ($clock.ElapsedMilliseconds -lt 20000) {
        try { $next = $Port.ReadByte() }
        catch [TimeoutException] { continue }
        if ($next -lt 0) { throw 'Incomplete frame' }
        if ($frame.Count -eq 0) {
            if ($next -eq 0x16 -and $busy -lt 48) { $busy++; continue }
            if ($next -eq 0x15) { return ,([byte[]]@(0x15)) }
            if ($next -ne 1) { throw 'Unexpected reply' }
        } elseif ($frame.Count -eq 1) {
            $expected = $next - 0x20 + 6
            if ($expected -lt 17 -or $expected -gt 101) { throw 'Invalid frame length' }
        }
        $frame.Add($next)
        if ($frame.Count -eq $expected) { return ,$frame.ToArray() }
    }
    throw 'Reply deadline exceeded'
}

function Invoke-Pf700CheckoutPort($Port, $InputReader, $OutputWriter) {
    $opened = $false
    try {
        while ($null -ne ($line = $InputReader.ReadLine())) {
            if ($line -cnotmatch '\A(?:[0-9a-f]{2}){10,101}\z') { throw 'Invalid request' }
            [byte[]]$request = @(for ($i = 0; $i -lt $line.Length; $i += 2) {
                [Convert]::ToByte($line.Substring($i, 2), 16)
            })
            if ($request[0] -ne 1 -or $request[1] -ne $request.Length + 26 -or $request[-1] -ne 3 -or
                $request[3] -notin @(90,74,76,97,113,48,49,51,103,53,56)) { throw 'Invalid checkout frame' }
            if (!$opened) {
                if ($request[3] -ne 90 -or $request.Length -ne 11 -or $request[4] -ne 0x30) { throw 'Identity probe required' }
                $Port.Open()
                $opened = $true
            }
            if ($Port.BytesToRead -ne 0) { throw 'Unexpected pending input' }
            $Port.Write($request, 0, $request.Length)
            [byte[]]$reply = Read-Pf700CheckoutReply $Port
            if ($Port.BytesToRead -ne 0) { throw 'Unexpected trailing input' }
            $OutputWriter.WriteLine([BitConverter]::ToString($reply).Replace('-', ''))
            $OutputWriter.Flush()
        }
    } catch {
        $OutputWriter.WriteLine('FAIL')
        $OutputWriter.Flush()
    } finally {
        $Port.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    if (![Console]::IsInputRedirected -or ![Console]::IsOutputRedirected) { exit 1 }
    $port = [IO.Ports.SerialPort]::new('COM3', 9600, [IO.Ports.Parity]::None, 8, [IO.Ports.StopBits]::One)
    $port.Handshake = [IO.Ports.Handshake]::None
    $port.DtrEnable = $false
    $port.RtsEnable = $false
    $port.WriteTimeout = 1000
    $port.ReadTimeout = 300
    Invoke-Pf700CheckoutPort $port ([Console]::In) ([Console]::Out)
}
