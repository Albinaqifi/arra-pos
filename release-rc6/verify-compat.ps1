param([Parameter(Mandatory=$true)][string]$Rc5Zip, [Parameter(Mandatory=$true)][string]$Kit)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$kitRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Kit).Path)
$fixture = Join-Path $PSScriptRoot ('compat-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixture)
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Rc5Zip).Path)
try {
    $entry = $zip.GetEntry('Arra POS.exe')
    $source = $entry.Open()
    try {
        $destination = [IO.File]::OpenWrite((Join-Path $fixture 'RC5.exe'))
        try { $source.CopyTo($destination) } finally { $destination.Dispose() }
    } finally { $source.Dispose() }
} finally { $zip.Dispose() }
$old = [Reflection.Assembly]::LoadFile((Join-Path $fixture 'RC5.exe'))
$new = [Reflection.Assembly]::LoadFile((Join-Path $kitRoot 'Arra POS.exe'))
$flags = [Reflection.BindingFlags]'NonPublic,Static'
$oldApp = $old.GetType('ArraPos', $true)
$newApp = $new.GetType('ArraPos', $true)
$profile = [Activator]::CreateInstance($old.GetType('PrinterProfile', $true), $true)
$profile.dataDirectory = Join-Path $fixture 'sample-data'
$profile.expectedSerial = [guid]::NewGuid().ToString('N').Substring(0,11)
$profile.operatorNumber = 2
$profile.tillNumber = '1'
$profile.operatorPassword = [string](Get-Random -Minimum 100000 -Maximum 1000000)
[void][IO.Directory]::CreateDirectory($profile.dataDirectory)
$desktop = Join-Path $fixture 'Desktop'
[void][IO.Directory]::CreateDirectory($desktop)
$store = Join-Path $fixture 'settings/rc4.profile'
$target = Join-Path $fixture 'installed/Arra POS.exe'
$link = $oldApp.GetMethod('SaveSetup', $flags).Invoke($null, @($profile, [string]$store, [string]$desktop, [string]$target))
$saved = [IO.File]::ReadAllBytes($store)
$shortcut = [IO.File]::ReadAllBytes($link)
$read = $newApp.GetMethod('ReadProfile', $flags).Invoke($null, @([string]$store, [string]$profile.dataDirectory))
if ($read.expectedSerial -cne $profile.expectedSerial -or $read.operatorPassword -cne $profile.operatorPassword) {
    throw 'RC6 failed to read RC5 protected settings'
}
$shell = New-Object -ComObject WScript.Shell
$current = $shell.CreateShortcut($link)
if ($current.TargetPath -cne $target -or $current.Arguments -cne '--open' -or
    [Convert]::ToBase64String($saved) -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes($store)) -or
    [Convert]::ToBase64String($shortcut) -cne [Convert]::ToBase64String([IO.File]::ReadAllBytes($link))) {
    throw 'Existing profile or shortcut changed'
}
Write-Output 'PASS RC6 reads an RC5 DPAPI profile; existing shortcut and settings remain unchanged'
