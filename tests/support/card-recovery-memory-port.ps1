# Test-only entry for the disposable copy of the tool. The original Windows
# sender is dot-sourced so its physical-port entry point cannot run.
param([ValidateSet('Review','Finish')][string]$Mode)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'sender.ps1') -Mode $Mode
. (Join-Path $PSScriptRoot 'reply.ps1')
$rows = Get-Content -Raw -LiteralPath $env:ARRA_QA_TRANSCRIPT | ConvertFrom-Json
$binding = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'incident.json') | ConvertFrom-Json
$plan = Get-RecoveryPlan $binding $Mode
$port = [pscustomobject]@{ Cursor=0; Buffer=[Collections.Generic.Queue[byte]]::new() }
$port | Add-Member ScriptProperty BytesToRead { $this.Buffer.Count }
$port | Add-Member ScriptMethod Open { }
$port | Add-Member ScriptMethod Dispose { }
$port | Add-Member ScriptMethod ReadByte { $this.Buffer.Dequeue() }
$port | Add-Member ScriptMethod Write {
    param([byte[]]$frame,$offset,$count)
    $row = $rows[$this.Cursor]
    $payload = [BitConverter]::ToString($frame,4,$count-10).Replace('-','').ToLowerInvariant()
    if ($offset -ne 0 -or $row.command -ne $frame[3] -or $row.payload -cne $payload) { throw 'Unexpected sample request' }
    $this.Cursor++
    [IO.File]::AppendAllText($env:ARRA_QA_COMMANDS,"$($row.command)`n")
    [byte[]]$reply = @(for($i=0;$i -lt $row.reply.Length;$i+=2) { [Convert]::ToByte($row.reply.Substring($i,2),16) })
    $reply[2] = $frame[2]
    $sum = 0
    for ($i=1; $i -le $reply.Length-6; $i++) { $sum += $reply[$i] }
    for ($i=0; $i -lt 4; $i++) { $reply[$reply.Length-5+$i] = 48+(($sum -shr (12-4*$i)) -band 15) }
    foreach ($byte in $reply) { $this.Buffer.Enqueue($byte) }
}
Invoke-RecoveryPort $port ([Console]::In) ([Console]::Out) $plan
