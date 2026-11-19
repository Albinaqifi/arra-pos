param([string]$OutputName = '', [switch]$OfflineTestOnly)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Build on Windows.' }
$repo = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Package version must have three numeric parts.' }
$runtime = Join-Path $repo 'node_modules\electron\dist'
if ((Get-Content (Join-Path $runtime 'version') -Raw).Trim() -ne $package.devDependencies.electron) { throw 'Installed Electron does not match the pinned runtime.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
$output = Join-Path $repo 'build\sample-installer'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$work = Join-Path $output ('.build-' + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $work 'payload'
$source = Join-Path $work 'source'
$succeeded = $false
try {
    New-Item -ItemType Directory -Path $payload, $source -Force | Out-Null
    Copy-Item -Path (Join-Path $runtime '*') -Destination $payload -Recurse
    $app = Join-Path $payload 'resources\app'
    New-Item -ItemType Directory -Path $app -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $app 'src') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'src\desktop') -Destination (Join-Path $app 'src\desktop') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo 'dist') -Destination $app -Recurse
    Copy-Item -LiteralPath (Join-Path $repo 'package.json') -Destination $app
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\setup-sample.cmd') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\setup-sample.ps1') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\setup-arra.cmd') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\setup-arra.ps1') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\check-pf700.ps1') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\start-supervised-pf700.ps1') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\PF700-Check-Identity.cmd') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\PF700-Routine.cmd') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\start-routine-pf700.ps1') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\check-pf700-identity.ps1') -Destination $payload
    Compress-Archive -Path (Join-Path $payload '*') -DestinationPath (Join-Path $source 'payload.zip') -CompressionLevel Optimal
    if (!$OfflineTestOnly) { Copy-Item -Path (Join-Path $PSScriptRoot 'sample-installer\install.*') -Destination $source }
    Copy-Item -Path (Join-Path $PSScriptRoot 'sample-installer\test-arra.*') -Destination $source
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\PF700-Check-Identity.cmd') -Destination $source
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\PF700-Routine.cmd') -Destination $source
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\start-routine-pf700.ps1') -Destination $source
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'sample-installer\check-pf700-identity.ps1') -Destination $source
    Set-Content -LiteralPath (Join-Path $source 'version.txt') -Value $version -Encoding ASCII
    if (!$OutputName) {
        $OutputName = if ($OfflineTestOnly) { "Arra-POS-$version-Offline-Test.zip" } else { "Arra-POS-Sample-$version-Setup.zip" }
    }
    if ($OutputName -notmatch '^[a-zA-Z0-9._-]+\.zip$') { throw 'Invalid output name.' }
    $installer = Join-Path $output $OutputName
    if (Test-Path -LiteralPath $installer) { throw 'Installer output already exists; choose another name.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($source, $installer, [System.IO.Compression.CompressionLevel]::NoCompression, $false)
    Write-Host "Created $installer"
    $succeeded = $true
} finally {
    if ($succeeded -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force }
    elseif (!$succeeded) { Write-Host "Build files retained at $work for diagnosis." }
}
