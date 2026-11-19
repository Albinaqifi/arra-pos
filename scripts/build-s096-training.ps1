[CmdletBinding()]
param([string]$OutputName = 'Arra-S096-Simulated-Training.zip')
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Build on Windows.' }
if ($OutputName -notmatch '^[a-zA-Z0-9._-]+\.zip$') { throw 'Invalid output name.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $repo
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
} finally { Pop-Location }
$package = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json
$runtime = Join-Path $repo 'node_modules\electron\dist'
if ((Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim() -cne $package.devDependencies.electron) { throw 'Electron does not match the pinned runtime.' }
$output = Join-Path $repo 'build\sample-installer'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$zip = Join-Path $output $OutputName
if (Test-Path -LiteralPath $zip) { throw 'Output already exists. Choose a different file name.' }
$root = Join-Path $output ('.s096-sample-' + [guid]::NewGuid().ToString('N'))
$id = [guid]::NewGuid().ToString('N')
New-Item -ItemType Directory -Path $root | Out-Null
$program = Join-Path $root 'program'
Copy-Item -LiteralPath $runtime -Destination $program -Recurse
$app = Join-Path $program 'resources\app'
New-Item -ItemType Directory -Path (Join-Path $app 'src') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'src\desktop') -Destination (Join-Path $app 'src\desktop') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'scripts\s096-training-seed-origins.js') -Destination (Join-Path $app 'src\desktop\s096-training-seed-origins.js')
Copy-Item -LiteralPath (Join-Path $repo 'dist') -Destination (Join-Path $app 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $repo 'package.json') -Destination (Join-Path $app 'package.json')
Copy-Item -LiteralPath (Join-Path $repo 'scripts\sample-installer\setup-arra.ps1') -Destination (Join-Path $program 'setup-arra.ps1')
[IO.File]::WriteAllText((Join-Path $root 'TRAINING-ID.txt'), $id, [Text.Encoding]::ASCII)
$launcher = @'
@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-s096-training.ps1"
if errorlevel 1 pause
'@
[IO.File]::WriteAllText((Join-Path $root 'START-S096-TRAINING.cmd'), $launcher, [Text.Encoding]::ASCII)
$runner = @'
$ErrorActionPreference = 'Stop'
try {
    $id = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'TRAINING-ID.txt') -Raw).Trim()
    if ($id -cnotmatch '^[0-9a-f]{32}$') { throw 'Invalid training package identity.' }
    $program = Join-Path $PSScriptRoot 'program'
    $electron = Join-Path $program 'electron.exe'
    $app = Join-Path $program 'resources\app'
    $setup = Join-Path $program 'setup-arra.ps1'
    if (!(Test-Path -LiteralPath $electron -PathType Leaf) -or !(Test-Path -LiteralPath $setup -PathType Leaf) -or !(Test-Path -LiteralPath $app -PathType Container)) { throw 'Extract the complete training ZIP before starting it.' }
    $trainingRoot = Join-Path $env:APPDATA 'Arra POS S096 Simulated Training'
    $data = Join-Path $trainingRoot $id
    if (!(Test-Path -LiteralPath $data)) {
        New-Item -ItemType Directory -Path $trainingRoot -Force | Out-Null
        $setupLock = Join-Path $trainingRoot ($id + '.setup')
        $lock = [IO.File]::Open($setupLock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $lock.Dispose()
        if (Test-Path -LiteralPath $data) { throw 'The sample profile was created by another setup. Preserve it and ask for help.' }
        Write-Host 'SAMPLE DATA ONLY. Choose fictional usernames, passwords and PINs, not real ones.'
        $previous = $env:ARRA_MENU_TEST_DATA
        try { $env:ARRA_MENU_TEST_DATA = $data; & $setup }
        finally { $env:ARRA_MENU_TEST_DATA = $previous }
        if (!(Test-Path -LiteralPath (Join-Path $data 'SAMPLE-DATA-ONLY') -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $data 'ARRA-SETUP-COMPLETE') -PathType Leaf)) { throw 'Sample setup did not complete. Preserve the profile and ask for help.' }
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $electron
        $info.Arguments = ('"{0}" "{1}" "{2}"' -f (Join-Path $app 'src\desktop\s096-training-seed-origins.js'),$data,$id)
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
        $child = [Diagnostics.Process]::Start($info)
        try {
            $stderr = $child.StandardError.ReadToEndAsync()
            $stdout = $child.StandardOutput.ReadToEnd()
            $child.WaitForExit()
            $null = $stderr.GetAwaiter().GetResult()
            if ($child.ExitCode -ne 0) { throw 'Could not prepare fictional sample marks. Preserve the profile and ask for help.' }
            if ($stdout) { Write-Host $stdout.TrimEnd() }
        } finally { $child.Dispose() }
    }
    if (!(Test-Path -LiteralPath (Join-Path $data 'SAMPLE-DATA-ONLY') -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $data 'ARRA-SETUP-COMPLETE') -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $data 'S096-TRAINING-READY') -PathType Leaf) -or !(Test-Path -LiteralPath (Join-Path $data 'arra.sqlite') -PathType Leaf)) { throw 'The separate sample profile is incomplete. Preserve it and ask for help.' }
    $browserProfile = Join-Path $data 'browser-profile'
    Write-Host 'Starting the isolated training app with the simulated printer. No real payment is taken.'
    Start-Process -FilePath $electron -ArgumentList ('"{0}" "--sample-data-directory={1}" "--user-data-dir={2}" --pf700-offline-checkout' -f $app,$data,$browserProfile) -WorkingDirectory $program
} catch {
    [Console]::Error.WriteLine('The training app could not start. Existing data was not changed.')
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
'@
[IO.File]::WriteAllText((Join-Path $root 'start-s096-training.ps1'), $runner, [Text.Encoding]::UTF8)
$readme = @'
S-096 -- SIMULATED TRAINING ONLY

This Windows training package uses a simulated printer and separate sample
data. It does not operate a real fiscal printer or take a card payment.
Use fictional sample accounts and data only; do not use it for real sales.
All sample products receive a fictional non-domestic fiscal mark so the
simulation is usable. This is not a classification of real products.

Extract the full ZIP to its own folder on a 64-bit Windows PC. Double-click
START-S096-TRAINING.cmd. On first launch, choose fictional sample passwords,
PINs and usernames as prompted. Reopening this extracted package returns to
the same isolated sample data, including interrupted examples. Do not delete
or reset it while testing restart or recovery. To use a fresh sample, build a
new package with a new training identity; do not delete existing data.

The training printer is a simulation. Its evidence does not prove that the
physical PF700 can recover the same way. Real fiscal checkout recovery remains
blocked until its device evidence is verified.
'@
[IO.File]::WriteAllText((Join-Path $root 'START-HERE.txt'), $readme, [Text.Encoding]::UTF8)
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($root, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Output "Training package identity: $id"
Write-Output "Staging directory: $root"
Write-Output "Created: $zip"
