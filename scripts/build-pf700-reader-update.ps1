# Produce a side-by-side 1.0.10 portable ZIP with the reviewed serial reader.
param(
    [Parameter(Mandatory=$true)][string]$CashCardZip,
    [Parameter(Mandatory=$true)][string]$OutputZip
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$originalHash = '9C485F178750798145A445D1D7BAD4AE475D583FF6ABB81B2EA11972243BD155'
$readerHash = '48F70B1CCBAAD492E4C5685E0879D2B7B3CC516CC0C7EAF89D37F08408E8B665'
$output = [IO.Path]::GetFullPath($OutputZip)
if ([IO.Path]::GetExtension($output) -ine '.zip' -or (Test-Path -LiteralPath $output)) {
    throw 'Choose a new output ZIP. Keep the original kit.'
}
$staging = $output + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::Copy([IO.Path]::GetFullPath($CashCardZip), $staging, $false)
try {
    if ((Get-FileHash -LiteralPath $staging -Algorithm SHA256).Hash -cne $originalHash) {
        throw 'Expected the original Arra-POS-1.0.10-Cash-Card.zip.'
    }
    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src/desktop/pf700-checkout-exchange.ps1'))
    $source = $source.Replace("`r`n", "`n").Replace("`n", "`r`n")
    $functionStart = 'function Read-Pf700CheckoutReply('
    $functionEnd = 'function Invoke-Pf700CheckoutPort('
    $start = $source.IndexOf($functionStart, [StringComparison]::Ordinal)
    $end = $source.IndexOf($functionEnd, [StringComparison]::Ordinal)
    $reviewedReader = $source.Substring($start, $end - $start)

    $archive = [IO.Compression.ZipFile]::Open($staging, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry = $archive.GetEntry('program/resources/app/src/desktop/pf700-checkout-exchange.ps1')
        $stream = $entry.Open()
        try {
            $utf8 = [Text.UTF8Encoding]::new($false, $true)
            $reader = [IO.StreamReader]::new($stream, $utf8, $false, 1024, $true)
            try { $original = $reader.ReadToEnd() } finally { $reader.Dispose() }
            # Keep the release's CardTrial command and tender restrictions. They
            # live outside the reader and differ from the story branch.
            $start = $original.IndexOf($functionStart, [StringComparison]::Ordinal)
            $end = $original.IndexOf($functionEnd, [StringComparison]::Ordinal)
            $updated = $original.Substring(0, $start) + $reviewedReader + $original.Substring($end)
            $updated = $updated.Replace('Read-Pf700CheckoutReply $Port 120000 2100', 'Read-Pf700CheckoutReply $Port 120000')
            $bytes = $utf8.GetBytes($updated)
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $digest = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') }
            finally { $sha.Dispose() }
            if ($digest -cne $readerHash) { throw 'The port does not match the tested 1.0.10 reader.' }
            $stream.Position = 0
            $stream.SetLength(0)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
        $note = Join-Path $PSScriptRoot 'pf700-release-candidate/READ-BEFORE-USE.txt'
        # Produce the same ZIP when a Windows checkout expands repository line endings.
        $noteBytes = $utf8.GetBytes([IO.File]::ReadAllText($note).Replace("`r`n", "`n"))
        $releaseNote = $archive.CreateEntry('READ-BEFORE-USE.txt')
        $releaseNote.LastWriteTime = $archive.GetEntry('START-HERE.txt').LastWriteTime
        $noteStream = $releaseNote.Open()
        try { $noteStream.Write($noteBytes, 0, $noteBytes.Length) } finally { $noteStream.Dispose() }
    } finally { $archive.Dispose() }
    [IO.File]::Move($staging, $output)
} finally {
    if ([IO.File]::Exists($staging)) { [IO.File]::Delete($staging) }
}
Get-FileHash -LiteralPath $output -Algorithm SHA256
