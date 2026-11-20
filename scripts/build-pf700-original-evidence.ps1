[CmdletBinding()]
param([string]$V5Zip, [string]$OutputZip)
$ErrorActionPreference = 'Stop'
$outputFolder = Join-Path $PSScriptRoot '..\build\sample-installer'
if (!$V5Zip) { $V5Zip = Join-Path $outputFolder 'Arra-S096-USB-Test-v5.zip' }
if (!$OutputZip) { $OutputZip = Join-Path $outputFolder 'Arra-S096-Original-Recovery-Check.zip' }
$OutputZip = [IO.Path]::GetFullPath($OutputZip)
if ([IO.File]::Exists($OutputZip)) { throw 'Output already exists.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stagingZip = $OutputZip + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
$source = [IO.Compression.ZipFile]::OpenRead($V5Zip)
try {
    $archive = [IO.Compression.ZipFile]::Open($stagingZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in @('runtime/node.exe','runtime/NODE-LICENSE.txt')) {
            $entry = @($source.Entries | Where-Object { $_.FullName.Replace('\','/') -ceq $name })
            if ($entry.Count -ne 1 -or $entry[0].Length -eq 0) { throw 'Missing or ambiguous runtime in the v5 kit.' }
            $inputStream = $entry[0].Open()
            try {
                $outputStream = $archive.CreateEntry($name).Open()
                try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
            } finally { $inputStream.Dispose() }
        }
        foreach ($name in @('Check-Original-Recovery.cmd','read-original.ps1','inspect.js','START-HERE.txt')) {
            $file = Join-Path (Join-Path $PSScriptRoot 'pf700-original-evidence') $name
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file,$name)
        }
    } finally { $archive.Dispose() }
    [IO.File]::Move($stagingZip,$OutputZip)
    Write-Output $OutputZip
} finally {
    $source.Dispose()
    if ([IO.File]::Exists($stagingZip)) { [IO.File]::Delete($stagingZip) }
}
