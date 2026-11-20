param([ValidateSet('Review','Finish')][string]$Mode = 'Review')

# One exclusive connection, one request per step. A finished or interrupted
# session cannot change the operation or restart its sequence.
function Get-RecoveryPlan($Binding, $Mode) {
    if ($Binding.itemHex.Count -ne 2 -or $Binding.total -notmatch '^[1-9][0-9]{0,6}$') { throw 'Binding' }
    foreach ($item in $Binding.itemHex) {
        if ($item -cnotmatch '^(?:[a-f0-9]{2}){6,91}$') { throw 'Binding' }
    }
    $registers = @('110/')
    if ($null -ne $Binding.priorJournalHash) {
        if ($Binding.priorJournalHash -cnotmatch '^[a-f0-9]{64}$') { throw 'Prior journal binding' }
        $registers = @('67/','110/')
    }
    $reads = @('90/30','90/30','113/','76/54','103/','97/') + $registers
    if ($Mode -ceq 'Review') { return $reads }
    $tender = [BitConverter]::ToString([Text.Encoding]::ASCII.GetBytes(([char]9 + 'D' + $Binding.total))).Replace('-','').ToLowerInvariant()
    return $reads + $reads + @("49/$($Binding.itemHex[0])","49/$($Binding.itemHex[1])",'76/54','103/',"53/$tender",'76/54','56/','76/54','113/') + $registers
}

function Invoke-RecoveryPort($Port, $Reader, $Writer, $Plan) {
    $index = 0
    try {
        while ($null -ne ($line = $Reader.ReadLine())) {
            if ($index -ge $Plan.Count -or $line -cnotmatch '^(?:[0-9a-f]{2}){10,101}$') { throw 'Sequence' }
            [byte[]]$frame = @(for ($i=0; $i -lt $line.Length; $i+=2) { [Convert]::ToByte($line.Substring($i,2),16) })
            if ($frame[0] -ne 1 -or $frame[1] -ne $frame.Length+26 -or $frame[2] -lt 32 -or $frame[2] -gt 127 -or
                $frame[-6] -ne 5 -or $frame[-1] -ne 3) { throw 'Frame' }
            $sum = 0
            for ($i=1; $i -le $frame.Length-6; $i++) { $sum += $frame[$i] }
            for ($i=0; $i -lt 4; $i++) {
                if ($frame[$frame.Length-5+$i] -ne (48+(($sum -shr (12-4*$i)) -band 15))) { throw 'Checksum' }
            }
            if (('{0}/{1}' -f $frame[3],$line.Substring(8,$line.Length-20)) -cne $Plan[$index]) { throw 'Unexpected request' }
            if ($index -eq 0) { $Port.Open() }
            $index++
            if ($Port.BytesToRead -ne 0) { throw 'Pending input' }
            $Port.Write($frame,0,$frame.Length)
            [byte[]]$reply = Read-Pf700CheckoutReply $Port
            if ($Port.BytesToRead -ne 0) { throw 'Trailing input' }
            $Writer.WriteLine([BitConverter]::ToString($reply).Replace('-',''))
            $Writer.Flush()
        }
    } catch { $Writer.WriteLine('STOP'); $Writer.Flush() }
    finally { $Port.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    if (![Console]::IsInputRedirected -or ![Console]::IsOutputRedirected) { exit 1 }
    $edition = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'edition.json') -Raw | ConvertFrom-Json
    if ($Mode -ceq 'Finish' -and $edition.reviewOnly -ne $false) { exit 1 }
    . (Join-Path $PSScriptRoot 'reply.ps1')
    $plan = Get-RecoveryPlan (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'incident.json') -Raw -Encoding UTF8 | ConvertFrom-Json) $Mode
    $port = [IO.Ports.SerialPort]::new('COM3',9600,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
    $port.Handshake = [IO.Ports.Handshake]::None
    $port.DtrEnable = $false
    $port.RtsEnable = $false
    $port.WriteTimeout = 1000
    $port.ReadTimeout = 300
    Invoke-RecoveryPort $port ([Console]::In) ([Console]::Out) $plan
}
