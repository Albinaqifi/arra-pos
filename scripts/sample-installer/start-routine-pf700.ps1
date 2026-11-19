$ErrorActionPreference = 'Stop'
try {
    $entry = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'version.txt')) {
        Join-Path $PSScriptRoot 'test-arra.ps1'
    } else { Join-Path $PSScriptRoot 'start-supervised-pf700.ps1' }
    & $entry -StartRoutine
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
