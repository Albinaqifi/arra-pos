[CmdletBinding(DefaultParameterSetName = 'Paper')]
param(
    [string]$OutputDirectory,
    [Parameter(ParameterSetName = 'Reply')][switch]$CheckReplyOnly,
    [Parameter(ParameterSetName = 'Vat')][switch]$CheckVatRates,
    [Parameter(ParameterSetName = 'Identity')][switch]$CompareIdentity,
    [Parameter(ParameterSetName = 'Journal', Mandatory)][switch]$CheckJournal,
    [Parameter(ParameterSetName = 'Journal')][string]$JournalRuntimeDirectory
)
$ErrorActionPreference = 'Stop'
if (!$OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\build\sample-installer' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo = Split-Path -Parent $PSScriptRoot
$sources = @(
    'scripts/pf700-paper-test/paper-transport.js',
    'scripts/pf700-paper-test/paper-exchange.ps1',
    'src/desktop/pf700-frame.js'
)
if ($CheckJournal) {
    $filename = if ($JournalRuntimeDirectory) { 'Arra-S096-USB-Test-v5.zip' } else { 'Arra-PF700-Journal-Check-v5.zip' }
    $sources = @('scripts/pf700-journal-check/PF700-Journal-Check.cmd', 'scripts/pf700-journal-check/README.txt', 'scripts/pf700-journal-check/journal-check.js',
        'scripts/pf700-journal-check/journal-exchange.ps1', 'src/desktop/pf700-frame.js', 'src/desktop/pf700-windows-checkout.js',
        'src/desktop/pf700-checkout-protocol.js')
} elseif ($CompareIdentity) {
    $filename = 'Arra-PF700-Compare-Identity-1.0.4.zip'
    $sources = @('scripts/pf700-paper-test/PF700-Compare-Identity.cmd', 'scripts/pf700-paper-test/compare-identity.ps1', 'scripts/pf700-paper-test/check-identity-layout.js')
} elseif ($CheckVatRates) {
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
            $entry = if ($CompareIdentity -or $source.EndsWith('.cmd') -or ($CheckJournal -and $source.EndsWith('/README.txt'))) { [IO.Path]::GetFileName($source) } else { $source }
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $repo $source), $entry)
        }
        if ($CheckJournal -and $JournalRuntimeDirectory) {
            foreach ($file in @('node.exe', 'NODE-LICENSE.txt')) {
                [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $JournalRuntimeDirectory $file), ('runtime/' + $file))
            }
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
