# Offline test. The only port passed to the production sender is this memory object.
param([Parameter(Mandatory)][string]$SerialScript)
$ErrorActionPreference='Stop'
. $SerialScript
function Read-Pf700CheckoutReply($p) { return ,([byte[]]@(21)) }
function Frame($cmd,[string]$data) {
    $length = $data.Length / 2
    $body = '{0:x2}20{1:x2}{2}05' -f ([int](36+$length)),[int]$cmd,$data
    $sum=0; for ($i=0;$i -lt $body.Length;$i+=2) { $sum += [Convert]::ToByte($body.Substring($i,2),16) }
    $check=''; foreach($s in 12,8,4,0) { $check += '{0:x2}' -f (48+(($sum -shr $s) -band 15)) }
    return '01'+$body+$check+'03'
}
function Check($lines,$plan,$expected) {
    $port=[pscustomobject]@{BytesToRead=0; Writes=0; Opens=0; Disposed=$false}
    $port | Add-Member ScriptMethod Open { $this.Opens++ }
    $port | Add-Member ScriptMethod Write {param($frame,$offset,$length) $this.Writes++}
    $port | Add-Member ScriptMethod Dispose {$this.Disposed=$true}
    $reader=[IO.StringReader]::new(($lines -join [Environment]::NewLine))
    $writer=[IO.StringWriter]::new()
    Invoke-RecoveryPort $port $reader $writer $plan
    if (!$port.Disposed -or $port.Writes -ne $expected) { throw "Unexpected number of writes (wanted $expected, actual $($port.Writes))." }
}
$binding=@{itemHex=@('53616d706c6509c2312a31','54656109c2312a31');total=2}
$read=@(Get-RecoveryPlan $binding 'Review')
$finish=@(Get-RecoveryPlan $binding 'Finish')
$cmds=@(foreach($step in $finish){$parts=$step.Split('/');Frame $parts[0] $parts[1]})
Check $cmds $finish $cmds.Length
Check $cmds $read $read.Length
Check @((Frame 48 '')) $finish 0
$readCount=2*$read.Length
foreach($bad in @((Frame 48 ''),(Frame 53 '09'),(Frame 56 ''),(Frame 49 $binding.itemHex[1]),(Frame 49 '00'))) {
    Check ($cmds[0..($readCount-1)] + $bad) $finish $readCount
}
Check ($cmds + $cmds[-1]) $finish $cmds.Length
$altered=$cmds[0].Substring(0,$cmds[0].Length-4)+'ff03'
Check @($altered) $finish 0
$binding.priorJournalHash = 'ab' * 32
$journalReads = @(Get-RecoveryPlan $binding 'Review')
$journalFinish = @(Get-RecoveryPlan $binding 'Finish')
if (($journalReads -join ',') -cne '90/30,90/30,113/,76/54,103/,97/,67/,110/') { throw 'Unexpected journal review plan' }
$journalFrames = @(foreach($step in $journalFinish){$parts=$step.Split('/');Frame $parts[0] $parts[1]})
Check $journalFrames $journalFinish $journalFrames.Length
Check $journalFrames $journalReads $journalReads.Length
Check ($journalFrames[0..5] + (Frame 110 '')) $journalReads 6
Check ($journalFrames[0..7] + (Frame 49 $binding.itemHex[0])) $journalReads 8
Write-Output 'Recovery sender: exact review/finish sequences and rejected write cases passed on a memory port.'
