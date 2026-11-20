# Windows PowerShell 5.1. The checkout process owns the private stdin/stdout
# pipes. Running this helper with no valid identity probe opens no port.
param([ValidateSet('Checkout', 'CardTrial', 'DailyReport', 'ReadDailyReport', 'ReadCheckout', 'PrinterControl')][string]$Operation = 'Checkout')

function Read-Pf700CheckoutReply($Port, $Deadline = 20000) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $frame = [Collections.Generic.List[byte]]::new()
    $expected = 0
    while ($clock.ElapsedMilliseconds -lt $Deadline) {
        try { $next = $Port.ReadByte() }
        catch [TimeoutException] { continue }
        if ($clock.ElapsedMilliseconds -ge $Deadline) { break }
        if ($next -lt 0) { throw 'Incomplete frame' }
        if ($frame.Count -eq 0) {
            # SYN means the command is still running. Keep its original reply deadline.
            if ($next -eq 0x16) { continue }
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

function Invoke-Pf700CheckoutPort($Port, $InputReader, $OutputWriter, $Operation = 'Checkout') {
    $opened = $false
    $identified = $false
    $reportSent = $false
    $cashRequest = $false
    $cashWriteStarted = $false
    try {
        while ($null -ne ($line = $InputReader.ReadLine())) {
            $cashRequest = $false
            $cashWriteStarted = $false
            # Acquire the serial handle without writing a device command. The
            # caller then atomically seals the checkout before any observation.
            if ($Operation -eq 'ReadCheckout' -and !$opened -and $line -ceq 'OPEN') {
                $Port.Open()
                $opened = $true
                if ($Port.BytesToRead -ne 0) { throw 'Unexpected pending input' }
                $OutputWriter.WriteLine('READY')
                $OutputWriter.Flush()
                continue
            }
            if ($Operation -eq 'ReadCheckout' -and !$opened) { throw 'Port reservation required' }
            if ($line -cnotmatch '\A(?:[0-9a-f]{2}){10,101}\z') { throw 'Invalid request' }
            [byte[]]$request = @(for ($i = 0; $i -lt $line.Length; $i += 2) {
                [Convert]::ToByte($line.Substring($i, 2), 16)
            })
            $cashRequest = $Operation -eq 'PrinterControl' -and $request[3] -eq 70
            if ($request[0] -ne 1 -or $request[1] -ne $request.Length + 26 -or $request[-1] -ne 3) {
                throw 'Invalid frame'
            }
            if ($Operation -in @('Checkout','CardTrial')) {
                if ($Operation -eq 'CardTrial' -and $request[3] -eq 110) {
                    if ($request.Length -ne 10) { throw 'Invalid tender register inquiry' }
                } elseif ($request[3] -notin @(90,74,76,97,113,48,49,51,103,53,56)) { throw 'Invalid checkout command' }
                if ($request[3] -eq 53) {
                    $tender = [Text.Encoding]::ASCII.GetString($request, 4, $request.Length - 10)
                    $format = if ($Operation -eq 'CardTrial') { '\A\tD[1-9][0-9]{0,6}\z' } else { '\A\t(?:P[1-9][0-9]{0,7})?\z' }
                    if ($tender -cnotmatch $format) { throw 'Invalid tender for this checkout mode' }
                }
            } elseif ($Operation -eq 'ReadCheckout') {
                $payload = [Text.Encoding]::ASCII.GetString($request, 4, $request.Length - 10)
                $queries = @{ 90 = '0'; 76 = 'T'; 103 = ''; 113 = '' }
                $command = [int]$request[3]
                if (!$queries.ContainsKey($command) -or $queries[$command] -cne $payload) { throw 'Invalid checkout inquiry' }
            } elseif ($Operation -eq 'PrinterControl') {
                $payload = [Text.Encoding]::ASCII.GetString($request, 4, $request.Length - 10)
                if ($request[3] -eq 90 -and !$identified -and $payload -ceq '0') { }
                elseif ($request[3] -eq 69 -and $identified -and !$reportSent -and $payload -ceq '2') { $reportSent = $true }
                elseif ($request[3] -eq 70 -and $identified -and !$reportSent -and $payload.Length -le 9 -and $payload -cmatch '\A-?(?:0|[1-9][0-9]*)\.[0-9]{2}\z' -and $payload -cmatch '[1-9]') { $reportSent = $true }
                else { throw 'Invalid printer control command' }
            } else {
                $payload = [Text.Encoding]::ASCII.GetString($request, 4, $request.Length - 10)
                $queries = @{ 90 = '0'; 74 = 'X'; 76 = 'T'; 62 = ''; 64 = ''; 65 = ''; 67 = ''; 110 = ''; 113 = '' }
                $command = [int]$request[3]
                if ($command -eq 69 -and $Operation -eq 'DailyReport' -and !$reportSent -and $payload -ceq '0') {
                    $reportSent = $true
                } elseif (!$queries.ContainsKey($command) -or $queries[$command] -cne $payload) {
                    throw 'Invalid daily report command'
                }
            }
            if (!$opened) {
                if ($request[3] -ne 90 -or $request.Length -ne 11 -or $request[4] -ne 0x30) { throw 'Identity probe required' }
                $Port.Open()
                $opened = $true
            }
            if (!$identified -and ($request[3] -ne 90 -or $request.Length -ne 11 -or $request[4] -ne 0x30)) { throw 'Identity probe required' }
            if ($Port.BytesToRead -ne 0) { throw 'Unexpected pending input' }
            if ($cashRequest) { $cashWriteStarted = $true }
            $Port.Write($request, 0, $request.Length)
            if ($request[3] -eq 69) {
                # The printer may report busy every 60 ms while printing the Z report.
                [byte[]]$reply = Read-Pf700CheckoutReply $Port 120000
            } else {
                [byte[]]$reply = Read-Pf700CheckoutReply $Port
            }
            if ($Port.BytesToRead -ne 0) { throw 'Unexpected trailing input' }
            $OutputWriter.WriteLine([BitConverter]::ToString($reply).Replace('-', ''))
            $OutputWriter.Flush()
            $identified = $true
        }
    } catch {
        # This marker is emitted only while processing command 70 and only
        # before calling SerialPort.Write. Once Write starts its outcome is unknown.
        $OutputWriter.WriteLine($(if ($cashRequest -and !$cashWriteStarted) { 'FAIL_NOT_SENT' } else { 'FAIL' }))
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
    Invoke-Pf700CheckoutPort $port ([Console]::In) ([Console]::Out) $Operation
}
