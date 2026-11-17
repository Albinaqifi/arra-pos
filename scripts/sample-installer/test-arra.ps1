$ErrorActionPreference = 'Stop'
$program = Join-Path $env:LOCALAPPDATA 'Arra POS Arra Menu Test 2'
$data = Join-Path $env:APPDATA 'Arra POS Arra Menu Test 2 Data'
try {
    if (!(Test-Path -LiteralPath $program)) {
        $staging = $program + '.install-' + [guid]::NewGuid().ToString('N')
        Write-Host 'Preparing a separate Arra menu test...'
        Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'payload.zip') -DestinationPath $staging
        [System.IO.Directory]::Move($staging, $program)
    }
    $electron = Join-Path $program 'electron.exe'
    $app = Join-Path $program 'resources\app'
    $setup = Join-Path $program 'setup-arra.ps1'
    if (!(Test-Path -LiteralPath $electron) -or !(Test-Path -LiteralPath $setup) -or !(Test-Path -LiteralPath $app)) { throw 'The separate test program folder is incomplete. Move it aside before trying again.' }
    if (!(Test-Path -LiteralPath $data)) {
        Write-Host 'First-time sample setup: enter sample passwords, PINs, and usernames.'
        $env:ARRA_MENU_TEST_DATA = $data
        & $setup
    }
    if (!(Test-Path -LiteralPath (Join-Path $data 'SAMPLE-DATA-ONLY')) -or !(Test-Path -LiteralPath (Join-Path $data 'ARRA-SETUP-COMPLETE')) -or !(Test-Path -LiteralPath (Join-Path $data 'arra.sqlite'))) { throw 'The separate test data folder is incomplete. Move it aside before trying again.' }
    Start-Process -FilePath $electron -ArgumentList @('"' + $app + '"', '"--sample-data-directory=' + $data + '"') -WorkingDirectory $program
    Write-Host 'The separate Arra menu sample is starting.'
} catch {
    Write-Host 'The test could not start. Your existing installation and its data were not changed.'
    Write-Host $_.Exception.Message
    exit 1
}
