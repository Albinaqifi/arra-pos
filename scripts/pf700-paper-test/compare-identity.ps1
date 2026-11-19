# Windows PowerShell 5.1. The CMD launcher selects the program's payload as
# the working directory. Only the local JS process receives the entered label.
$runtime = Join-Path (Get-Location) 'electron.exe'
$checker = Join-Path $PSScriptRoot 'check-identity-layout.js'
if ([Console]::IsInputRedirected) {
    $serial = [Console]::In.ReadLine()
} else {
    $secure = Read-Host 'Serial number from the printer label' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $serial = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secure.Dispose()
    }
}
if ([string]::IsNullOrEmpty($serial)) { exit 0 }
$env:ELECTRON_RUN_AS_NODE = '1'
try {
    $serial | & $runtime $checker --compare-identity 2>&1 | ForEach-Object { $_.ToString() }
    exit $LASTEXITCODE
} finally { $serial = $null }
