# Run the fixed read-only action from the release root or its extracted program.
$ErrorActionPreference = 'Stop'
try {
    $versionFile = Join-Path $PSScriptRoot 'version.txt'
    if (Test-Path -LiteralPath $versionFile -PathType Leaf) {
        $version = (Get-Content -LiteralPath $versionFile -Raw).Trim()
        $entry = Join-Path $PSScriptRoot 'test-arra.ps1'
    } else {
        $manifest = Join-Path $PSScriptRoot 'resources\app\package.json'
        $version = (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version
        $entry = Join-Path $PSScriptRoot 'start-supervised-pf700.ps1'
    }
    if ($version -notmatch '^\d+\.\d+\.\d+$' -or [version]$version -lt [version]'1.0.5' -or
        !(Get-Command -Name $entry).Parameters.ContainsKey('CheckIdentityOnly')) {
        throw 'Extract the complete Arra POS 1.0.5 or newer package into its own folder.'
    }
    & $entry -CheckIdentityOnly
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
