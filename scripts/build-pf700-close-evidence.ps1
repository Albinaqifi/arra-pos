[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CashCardZip, [Parameter(Mandatory=$true)][string]$OutputZip, [switch]$Journal)
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
            'scripts/pf700-close-evidence/start.ps1', 'scripts/pf700-close-evidence/evidence.js',
            'scripts/pf700-close-evidence/evidence-files.js',
            'src/desktop/pf700-frame.js', 'src/desktop/pf700-checkout-protocol.js',
            'src/desktop/pf700-commissioning.js', 'src/desktop/pf700-closed-cash-trace.js',
            'src/desktop/fiscal-checkout.js'
        )
        if ($Journal) {
            $launcherName = 'Read-Bill-2-Journal.cmd'
            $files += @('scripts/pf700-close-evidence/read-journal.js','scripts/pf700-close-evidence/match-journal.js',
                'src/desktop/pf700-windows-checkout.js','scripts/pf700-journal-check/journal-pipe.js',
                'scripts/pf700-journal-check/journal-exchange.ps1')
        } else {
            $launcherName = 'Check-Bill-2.cmd'
            $files += @('scripts/pf700-close-evidence/collect.js','scripts/pf700-close-evidence/capture.ps1')
        }
        foreach ($file in $files) {
            $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $root $file),$file)
        }
        $launcher = Join-Path (Join-Path $PSScriptRoot 'pf700-close-evidence') $launcherName
        $null = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$launcher,$launcherName)
    } finally { $archive.Dispose() }
    [IO.File]::Move($staging,$OutputZip)
} finally {
    $source.Dispose()
    if ([IO.File]::Exists($staging)) { [IO.File]::Delete($staging) }
}
