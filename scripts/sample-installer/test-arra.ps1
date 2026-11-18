$ErrorActionPreference = 'Stop'
try {
    $version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim()
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid offline test package version.' }
    $programRoot = Join-Path $env:LOCALAPPDATA 'Arra POS Offline Test'
    $dataRoot = Join-Path $env:APPDATA 'Arra POS Offline Test Data'
    $program = Join-Path $programRoot $version
    $data = Join-Path $dataRoot $version
    if (!(Test-Path -LiteralPath $program)) {
        New-Item -ItemType Directory -Path $programRoot -Force | Out-Null
        $staging = $program + '.install-' + [guid]::NewGuid().ToString('N')
        Write-Host "Preparing Arra POS $version for an offline test..."
        New-Item -ItemType Directory -Path $staging | Out-Null
        try {
            Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'payload.zip') -DestinationPath $staging
            $bundled = Get-Content -LiteralPath (Join-Path $staging 'resources\app\package.json') -Raw | ConvertFrom-Json
            if ($bundled.version -cne $version) { throw 'The application and package versions differ.' }
            [System.IO.Directory]::Move($staging, $program)
        } finally {
            if (Test-Path -LiteralPath $staging) {
                $stagedPath = (Resolve-Path -LiteralPath $staging).ProviderPath
                if ([IO.Path]::GetDirectoryName($stagedPath) -eq (Resolve-Path -LiteralPath $programRoot).ProviderPath) {
                    Remove-Item -LiteralPath $stagedPath -Recurse -Force
                }
            }
        }
    }
    $electron = Join-Path $program 'electron.exe'
    $app = Join-Path $program 'resources\app'
    $setup = Join-Path $program 'setup-arra.ps1'
    if (!(Test-Path -LiteralPath $electron) -or !(Test-Path -LiteralPath $setup) -or !(Test-Path -LiteralPath $app)) { throw 'The separate test program folder is incomplete. Move it aside before trying again.' }
    $installed = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
    if ($installed.version -cne $version) { throw 'The installed test application has a different version.' }
    if (!(Test-Path -LiteralPath $data)) {
        New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
        Write-Host 'First-time setup creates the Arra menu and free tables. Enter sample passwords, PINs, and usernames.'
        $previousData = $env:ARRA_MENU_TEST_DATA
        try {
            $env:ARRA_MENU_TEST_DATA = $data
            & $setup
        } finally {
            $env:ARRA_MENU_TEST_DATA = $previousData
        }
    }
    if (!(Test-Path -LiteralPath (Join-Path $data 'SAMPLE-DATA-ONLY')) -or !(Test-Path -LiteralPath (Join-Path $data 'ARRA-SETUP-COMPLETE')) -or !(Test-Path -LiteralPath (Join-Path $data 'arra.sqlite'))) { throw 'The separate test data folder is incomplete. Move it aside before trying again.' }
    $browserProfile = Join-Path $data 'browser-profile'
    Start-Process -FilePath $electron -ArgumentList ('"{0}" "--sample-data-directory={1}" "--user-data-dir={2}"' -f $app, $data, $browserProfile) -WorkingDirectory $program
    Write-Host "Opening the Arra POS $version offline test."
} catch {
    Write-Host 'The test could not start. Your existing installation and its data were not changed.'
    Write-Host $_.Exception.Message
    exit 1
}
