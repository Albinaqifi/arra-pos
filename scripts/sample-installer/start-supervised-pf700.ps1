# Manually invoked on site for an attended cash receipt. The offline test
# launcher does not call this script. Operator settings exist only in memory.
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Sale')][switch]$StartSale,
    [Parameter(Mandatory = $true, ParameterSetName = 'Prepare')][switch]$PrepareData,
    [Parameter(Mandatory = $true, ParameterSetName = 'Identity')][switch]$CheckIdentityOnly
)
$ErrorActionPreference = 'Stop'
if (@($StartSale, $PrepareData, $CheckIdentityOnly).Where({ $_.IsPresent }).Count -ne 1) {
    throw 'Choose -CheckIdentityOnly, -PrepareData or -StartSale.'
}
$app = Join-Path $PSScriptRoot 'resources\app'
$electron = Join-Path $PSScriptRoot 'electron.exe'
if (!(Test-Path -LiteralPath $electron -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $app 'package.json'))) {
    throw 'Open this launcher from the installed Arra program folder.'
}
if ($PrepareData) {
    & (Join-Path $PSScriptRoot 'setup-arra.ps1') -PrepareSupervisedProfile
    return
}
if ($CheckIdentityOnly) {
    Write-Host 'Read-only PF700 identity check on COM3. Enter the label serial or press Enter to cancel.'
    if ([Console]::IsInputRedirected) {
        $serial = [Console]::In.ReadLine()
    } else {
        $secure = Read-Host 'Printer serial number' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $serial = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            $secure.Dispose()
        }
    }
    if ([string]::IsNullOrEmpty($serial)) { return }
    if ($serial -cnotmatch '^[A-Za-z0-9]{11}$') { throw 'Check the serial number from the printer.' }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $electron
    $info.WorkingDirectory = $PSScriptRoot
    $info.Arguments = '"{0}" --check-identity' -f (Join-Path $app 'src\desktop\pf700-identity-cli.js')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $child = [Diagnostics.Process]::Start($info)
    try {
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        $child.StandardInput.WriteLine($serial)
        $child.StandardInput.Close()
        $child.WaitForExit()
        [Console]::Write($stdout.GetAwaiter().GetResult())
        if ($child.ExitCode -ne 0) { [Console]::Error.Write($stderr.GetAwaiter().GetResult()) }
        $result = $child.ExitCode
    } finally { $child.Dispose(); $serial = $null }
    exit $result
}
$data = Join-Path $env:APPDATA 'Arra POS PF700 Commissioning'
if (!(Test-Path -LiteralPath (Join-Path $data 'arra.sqlite') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $data 'SAMPLE-DATA-ONLY'))) {
    throw 'Prepare the dedicated PF700 data profile first using -PrepareData.'
}
Write-Host 'Supervised PF700 checkout on COM3. Confirming Cash A in Arra can register one real sale, one unit of one item.'
Write-Host 'In Financial information, a Combined user can also confirm a real PF700 fiscal day close.'
if ((Read-Host 'Type LIVE to prepare this session') -cne 'LIVE') { return }
$serial = (Read-Host 'Printer serial number from the device').Trim()
$operator = (Read-Host 'Printer operator number (1 to 8)').Trim()
$till = (Read-Host 'Till number (1 to 5 digits)').Trim()
$origin = (Read-Host 'Does the item being sold require the Macedonian-product mark? Enter YES or NO').Trim()
if ($serial -cnotmatch '^[A-Za-z0-9]{11}$' -or $operator -cnotmatch '^[1-8]$' -or
    $till -cnotmatch '^[0-9]{1,5}$' -or $origin -cnotin @('YES','NO')) { throw 'Check the local printer settings.' }
$secure = Read-Host 'Printer operator password' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $profile = @{
        dataDirectory = $data
        expectedSerial = $serial
        operatorNumber = [int]$operator
        operatorPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        tillNumber = $till
        domesticProduct = ($origin -ceq 'YES')
    }
    if ($profile.operatorPassword -cnotmatch '^[0-9]{4,6}$') { throw 'Check the printer operator password.' }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $electron
    $info.WorkingDirectory = $PSScriptRoot
    $info.Arguments = '"{0}" "--user-data-dir={1}" --pf700-supervised-checkout' -f $app, $data
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
    $child = [Diagnostics.Process]::Start($info)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $profile -Compress))
        try { $child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length) }
        finally { [Array]::Clear($bytes, 0, $bytes.Length); $child.StandardInput.Close() }
    } finally { $child.Dispose() }
} finally {
    if ($profile) { $profile.Clear() }
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secure.Dispose()
}
