# Loaded by paper-test.js. Loading this file by itself opens no port.
function Read-Pf700PaperReply($Reader) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $frame = [Collections.Generic.List[byte]]::new()
    while ($frame.Count -lt 101 -and $clock.ElapsedMilliseconds -lt 20000) {
        $next = $Reader.ReadByte()
        if ($next -lt 0) { throw [IO.EndOfStreamException]::new() }
        if ($frame.Count -eq 0 -and $next -eq 0x16) { continue } # Device busy.
        $frame.Add($next)
        if ($next -eq 0x03 -or $next -eq 0x15) { return ,$frame.ToArray() }
    }
    throw [TimeoutException]::new()
}

function Invoke-Pf700PaperExchange($Port, $Requests) {
    $printAttempted = $false
    try {
        $Port.Open()
        foreach ($name in @('status', 'document', 'print')) {
            # JS only releases the next operation after checking the previous reply.
            # EOF, including after a failed preflight or a closed launcher, stops here.
            if ([Console]::ReadLine() -cne $name) { return }
            if ($Port.BytesToRead -ne 0) {
                [Console]::WriteLine('UNSENT pending-data')
                return
            }
            [byte[]]$request = $Requests[$name]
            if ($name -eq 'print') { $printAttempted = $true }
            $Port.Write($request, 0, $request.Length)
            [byte[]]$reply = Read-Pf700PaperReply $Port
            if ($Port.BytesToRead -ne 0) { throw [IO.InvalidDataException]::new() }
            [Console]::WriteLine([BitConverter]::ToString($reply).Replace('-', ''))
        }
    } catch {
        if ($printAttempted) { [Console]::WriteLine('UNKNOWN') }
        else { [Console]::WriteLine('UNSENT serial-error') }
    } finally {
        $Port.Dispose()
    }
}
