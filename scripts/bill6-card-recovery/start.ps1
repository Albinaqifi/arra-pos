param([ValidateSet('Review','Finish')][string]$Mode = 'Review')
$ErrorActionPreference = 'Stop'

function Send-OwnerPassword($Writer) {
    $value = Read-Host 'Combined administrator password' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
        try { $Writer.WriteLine([Convert]::ToBase64String($bytes)) }
        finally { [Array]::Clear($bytes,0,$bytes.Length) }
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $value.Dispose() }
}
function Start-Recovery {
    $binding = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'incident.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $bill = $binding.billId; $total = $binding.total
    Write-Host "Arra bill #$bill - existing Card A payment, $total MKD"
    foreach ($line in $binding.lines) { Write-Host ("{0} x {1} at {2} MKD" -f $line.quantity,$line.name,$line.unitPrice) }
    Write-Host 'Close Arra and keep the enrolled printer connected. Use the original Windows account.'
    Write-Host 'Printer inquiries can replace its last cached reply.'
    if ($Mode -ceq 'Review') { Write-Host 'Review reads the local payment and current printer state.' }
    else { Write-Host 'Finish reviews the same receipt. You will be asked before fiscal printing.' }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $directory = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','..'))
    $start.FileName = Join-Path $directory 'runtime\node.exe'
    $start.WorkingDirectory = $directory
    $start.Arguments = '--no-warnings "' + (Join-Path $PSScriptRoot 'operator.cjs') + '" ' + $Mode
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($key in 'NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','NODE_V8_COVERAGE') { $start.EnvironmentVariables.Remove($key) }
    $child = [Diagnostics.Process]::Start($start)
    try {
        $discard = $child.StandardError.ReadToEndAsync()
        while ($null -ne ($text = $child.StandardOutput.ReadLine())) {
            switch -CaseSensitive ($text) {
                'USERNAME' {
                    $user = Read-Host 'Combined administrator username'
                    $child.StandardInput.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($user)))
                }
                'PASSWORD' { Send-OwnerPassword $child.StandardInput }
                'CONFIRM' {
                    if ($Mode -cne 'Finish') { throw 'Unexpected prompt' }
                    Write-Host ("Match the physical header #{0} on the unfinished slip. Arra recorded {1} as the last completed document before it opened." -f $binding.headerNumber,$binding.previousDocument)
                    Write-Host "Check the original bank-terminal approval for $total MKD. Confirm nobody else has used or changed the open receipt."
                    Write-Host "This will print the listed items on the existing open receipt, enter $total MKD as fiscal card tender, and close it."
                    $decision = Read-Host "Type FINISH $bill to proceed, or press Enter to stop"
                    $child.StandardInput.WriteLine($(if ($decision -ceq "FINISH $bill") {'CONFIRMED'} else {'CANCEL'}))
                }
                default {
                    if ($text -cmatch '^STOP HOLD_[A-Z0-9_]+$') { Write-Host "$text - Keep the paper and report this line. Do not repeat Pay." }
                    elseif ($text -ceq 'RESULT reviewed') { Write-Host 'REVIEW PASSED - The original payment, prior document and open empty receipt match the checks. No fiscal sale command sent.' }
                    elseif ($text -ceq 'RESULT cancelled') { Write-Host 'Cancelled before fiscal printing.' }
                    elseif ($text -cmatch '^RESULT (confirmed|already-confirmed) [0-9]{7}$') { Write-Host "$text - Keep the paper and compare its two items, card tender and total with the bill." }
                    elseif ($text -ceq 'RESULT awaiting-local-publication' -or $text -cmatch '^RESULT awaiting-local-publication [0-9]{7}$') { Write-Host 'Printer proof already exists. Finish can record it locally without sending the receipt again.' }
                    else { throw 'Unexpected output' }
                    $child.StandardInput.Close()
                }
            }
            if ($text -cin @('USERNAME','PASSWORD','CONFIRM')) { $child.StandardInput.Flush() }
        }
        $child.WaitForExit()
        return $child.ExitCode
    } finally {
        $child.StandardInput.Close()
        if (!$child.HasExited) { $child.WaitForExit(3000) | Out-Null }
        if (!$child.HasExited) { $child.Kill() }
        $child.Dispose()
    }
}
try { exit (Start-Recovery) } catch { Write-Host 'Stopped. Keep the printer and receipt as they are and report the last message.'; exit 1 }
