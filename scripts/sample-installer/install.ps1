$ErrorActionPreference = 'Stop'
$version = (Get-Content (Join-Path $PSScriptRoot 'version.txt') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version.' }
$root = Join-Path $env:LOCALAPPDATA 'Arra POS Sample'
$target = Join-Path $root $version
$data = Join-Path $env:APPDATA 'Arra POS Sample Data'
New-Item -ItemType Directory -Path $root -Force | Out-Null
if (Test-Path -LiteralPath $target) { throw 'This version already exists. Its files and sample data were not changed.' }
$staging = Join-Path $root ('.install-' + [guid]::NewGuid().ToString('N'))
$startParent = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$start = Join-Path $startParent "Arra POS Sample $version"
$shortcutStaging = Join-Path $startParent ('.arra-install-' + [guid]::NewGuid().ToString('N'))
$published = $false
try {
    Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'payload.zip') -DestinationPath $staging
    New-Item -ItemType Directory -Path $shortcutStaging -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $shortcutStaging 'Arra POS Sample.lnk'))
    $shortcut.TargetPath = Join-Path $target 'electron.exe'
    $shortcut.Arguments = '"' + (Join-Path $target 'resources\app') + '" --sample-data-directory="' + $data + '"'
    $shortcut.WorkingDirectory = $target
    $shortcut.Save()
    $shortcut = $shell.CreateShortcut((Join-Path $shortcutStaging 'Set up sample data.lnk'))
    $shortcut.TargetPath = Join-Path $target 'setup-sample.cmd'
    $shortcut.WorkingDirectory = $target
    $shortcut.Save()
    # Directory.Move fails if either destination already exists. Never replace
    # an earlier version or its shortcuts, even if another installer races us.
    [System.IO.Directory]::Move($staging, $target)
    $published = $true
    [System.IO.Directory]::Move($shortcutStaging, $start)
    $published = $false # Both published paths are now complete.
    Write-Host "Installed Arra POS Sample $version. Run 'Set up sample data' from the Start menu once, then open Arra POS Sample. Sample data only; no real sales."
} catch {
    if ($published) {
        try { Remove-Item -LiteralPath $target -Recurse -Force }
        catch { throw "Installation failed and the new program directory could not be removed. Close the app, move $target aside, and retry. Sample data and other versions were not removed." }
    }
    throw
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    if (Test-Path -LiteralPath $shortcutStaging) { Remove-Item -LiteralPath $shortcutStaging -Recurse -Force }
}
