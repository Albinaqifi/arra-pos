[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CashCardZip, [Parameter(Mandatory=$true)][string]$OutputZip)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Directory]::GetParent($PSScriptRoot).FullName
$OutputZip = [IO.Path]::GetFullPath($OutputZip)
if ([IO.File]::Exists($OutputZip)) { throw 'Output already exists' }
$staging = $OutputZip + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
$source = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($CashCardZip))
try {
    $archive = [IO.Compression.ZipFile]::Open($staging, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in @('node.exe','NODE-LICENSE.txt')) {
            $entry = @($source.Entries | Where-Object { $_.FullName.Replace('\','/') -ceq ('Recovery/runtime/' + $name) })
            if ($entry.Count -ne 1 -or !$entry[0].Length) { throw 'Missing or ambiguous runtime' }
            $reader = $entry[0].Open()
            try {
                $writer = $archive.CreateEntry('runtime/' + $name).Open()
                try { $reader.CopyTo($writer) } finally { $writer.Dispose() }
            } finally { $reader.Dispose() }
        }
        $files = @(
            'scripts/pf700-close-evidence/start.ps1', 'scripts/pf700-close-evidence/collect.js',
            'scripts/pf700-close-evidence/capture.ps1', 'scripts/pf700-close-evidence/evidence.js',
            'src/desktop/pf700-frame.js', 'src/desktop/pf700-checkout-protocol.js',
            'src/desktop/pf700-commissioning.js', 'src/desktop/pf700-closed-cash-trace.js',
            'src/desktop/fiscal-checkout.js'
        )
        foreach ($file in $files) {
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $root $file),$file)
        }
        $launcher = Join-Path $PSScriptRoot 'pf700-close-evidence\Check-Bill-2.cmd'
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$launcher,'Check-Bill-2.cmd')
    } finally { $archive.Dispose() }
    [IO.File]::Move($staging,$OutputZip)
} finally {
    $source.Dispose()
    if ([IO.File]::Exists($staging)) { [IO.File]::Delete($staging) }
}
