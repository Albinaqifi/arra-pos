[CmdletBinding(DefaultParameterSetName = 'Paper')]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build\sample-installer'),
    [Parameter(ParameterSetName = 'Reply')][switch]$CheckReplyOnly,
    [Parameter(ParameterSetName = 'Vat')][switch]$CheckVatRates
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path -Parent $PSScriptRoot
$sources = @(
    'scripts/pf700-paper-test/paper-transport.js',
    'scripts/pf700-paper-test/paper-exchange.ps1',
    'src/desktop/pf700-frame.js'
)
if ($CheckVatRates) {
    $filename = 'Arra-PF700-Check-VAT.zip'
    $sources += 'scripts/pf700-paper-test/PF700-Check-VAT.cmd', 'scripts/pf700-paper-test/check-vat.js'
} elseif ($CheckReplyOnly) {
    $filename = 'Arra-PF700-Check-Reply.zip'
    $sources += 'scripts/pf700-paper-test/PF700-Check-Reply.cmd', 'scripts/pf700-paper-test/check-reply.js'
} else {
    $filename = 'Arra-PF700-Paper-Test-v2.zip'
    $sources += 'scripts/pf700-paper-test/PF700-Paper-Test.cmd', 'scripts/pf700-paper-test/run-paper-test.ps1', 'scripts/pf700-paper-test/paper-test.js'
}
$out = [IO.Directory]::CreateDirectory($OutputDirectory).FullName
$zip = Join-Path $out $filename
$tempZip = Join-Path $out ('.paper-test-' + [guid]::NewGuid().ToString('N') + '.zip')
try {
    $archive = [IO.Compression.ZipFile]::Open($tempZip, 'Create')
    try {
        foreach ($source in $sources) {
            $entry = if ($source.EndsWith('.cmd')) { [IO.Path]::GetFileName($source) } else { $source }
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $repo $source), $entry)
        }
    } finally {
        $archive.Dispose()
    }
    if ([IO.File]::Exists($zip)) {
        [IO.File]::Replace($tempZip, $zip, [System.Management.Automation.Language.NullString]::Value)
    } else {
        [IO.File]::Move($tempZip, $zip)
    }
    Write-Host "Created $zip"
} finally {
    if (Test-Path -LiteralPath $tempZip) { Remove-Item -LiteralPath $tempZip }
}
