# Windows PowerShell 5.1. Private child of the incident collector.
param([string]$Sequence)

function Read-CloseEvidenceFrame($Port) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $frame = [Collections.Generic.List[byte]]::new()
    $expected = 0
    $busy = 0
    while ($clock.ElapsedMilliseconds -lt 5000) {
        try { $next = $Port.ReadByte() } catch [TimeoutException] { continue }
        if ($frame.Count -eq 0) {
            if ($next -eq 0x16 -and $busy -lt 48) { $busy++; continue }
            if ($next -ne 1) { throw 'Unexpected first byte' }
        } elseif ($frame.Count -eq 1) {
            $expected = $next - 0x20 + 6
            if ($expected -lt 17 -or $expected -gt 101) { throw 'Invalid frame length' }
        }
        if ($next -lt 0 -or $next -gt 255) { throw 'Invalid byte' }
        $frame.Add($next)
        if ($frame.Count -eq $expected) {
            if ($next -ne 3 -or $Port.get_BytesToRead() -ne 0) { throw 'Incomplete or multiple frames' }
            return [BitConverter]::ToString($frame.ToArray()).Replace('-','')
        }
    }
    throw 'Incomplete frame'
}

function Invoke-CloseEvidenceCapture($Port, [int]$SavedSequence) {
    try {
        if ($SavedSequence -lt 32 -or $SavedSequence -gt 127) { throw 'Invalid sequence' }
        # 74/X, immediate status. The child accepts no command or payload.
        [byte[]]$request = @(1, 0x25, $SavedSequence, 74, 0x58, 5, 0, 0, 0, 0, 3)
        $checksum = 0x25 + $SavedSequence + 74 + 0x58 + 5
        for ($i = 0; $i -lt 4; $i++) {
            $request[6 + $i] = 0x30 + (($checksum -shr (12 - 4 * $i)) -band 15)
        }

        $Port.Open()
        # Give already-arriving bytes a chance to reach the driver's queue.
        # Once any input is present, even a malformed or partial frame ends
        # this attempt without sending anything to the printer.
        [Threading.Thread]::Sleep(250)
        # PowerShell property access can silently return null if a .NET getter
        # throws. Calling the getter explicitly lets a driver error stop us.
        $queued = $Port.get_BytesToRead()
        if ($null -eq $queued -or $queued -lt 0) { throw 'Receive queue unavailable' }
        if ($queued -gt 0) {
            return 'PENDING ' + (Read-CloseEvidenceFrame $Port)
        }
        $Port.Write($request, 0, $request.Length)
        return 'PROBE ' + (Read-CloseEvidenceFrame $Port)
    } finally {
        $Port.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    try {
        if (![Console]::IsInputRedirected -or ![Console]::IsOutputRedirected -or
            $args.Count -ne 0 -or $Sequence -cnotmatch '\A[1-9][0-9]{1,2}\z' -or
            [int]$Sequence -lt 32 -or [int]$Sequence -gt 127) { throw 'Invalid invocation' }
        $port = [IO.Ports.SerialPort]::new('COM3', 9600, [IO.Ports.Parity]::None, 8, [IO.Ports.StopBits]::One)
        $port.Handshake = [IO.Ports.Handshake]::None
        $port.DtrEnable = $false
        $port.RtsEnable = $false
        $port.WriteTimeout = 1000
        $port.ReadTimeout = 100
        $result = Invoke-CloseEvidenceCapture $port ([int]$Sequence)
        [Console]::Out.WriteLine($result)
    } catch {
        [Console]::Out.WriteLine('ERROR')
        exit 1
    }
}
