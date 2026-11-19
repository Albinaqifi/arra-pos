# Build the portable POS kit for the existing enrolled restaurant profile.
param(
    [Parameter(Mandatory = $true)][string]$OriginalRecoveryKit,
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Build on Windows.' }
$repo = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version.' }
$runtime = Join-Path $repo 'node_modules\electron\dist'
if ((Get-Content -Raw -LiteralPath (Join-Path $runtime 'version')).Trim() -cne $package.devDependencies.electron) {
    throw 'Installed Electron differs from the pinned runtime.'
}
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo 'build\commissioned-pos' }
$out = [IO.Directory]::CreateDirectory($OutputDirectory).FullName
$final = Join-Path $out ("Arra-POS-" + $package.version + "-Cash-Card.zip")
if (Test-Path -LiteralPath $final) { throw 'A kit already exists at the output path.' }

Push-Location -LiteralPath $repo
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
    $desktopFiles = @(git ls-files -- src/desktop)
    if ($LASTEXITCODE -ne 0 -or $desktopFiles -notcontains 'src/desktop/main.js') { throw 'Cannot list application sources.' }
} finally { Pop-Location }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$compression = [IO.Compression.CompressionLevel]::Optimal
function Add-KitFile([string]$file, [string]$entry) {
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $entry, $compression)
}

$reader = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $OriginalRecoveryKit).ProviderPath)
$temp = Join-Path $out ('.kit-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    $archive = [IO.Compression.ZipFile]::Open($temp, 'Create')
    try {
        foreach ($file in Get-ChildItem -LiteralPath $runtime -Recurse -File) {
            $relative = $file.FullName.Substring($runtime.Length + 1).Replace('\','/')
            Add-KitFile $file.FullName ('program/' + $relative)
        }
        $app = 'program/resources/app/'
        Add-KitFile (Join-Path $repo 'package.json') ($app + 'package.json')
        foreach ($file in $desktopFiles) {
            Add-KitFile (Join-Path $repo $file) ($app + $file)
        }
        foreach ($file in @('index.html','demo.html','styles.css','renderer-entry.js','react.js','react-dom.js')) {
            Add-KitFile (Join-Path $repo ('dist/' + $file)) ($app + 'dist/' + $file)
        }
        Add-KitFile (Join-Path $PSScriptRoot 'sample-installer\start-supervised-pf700.ps1') 'program/start-supervised-pf700.ps1'
        foreach ($file in @('Arra-Cash-A.cmd','Arra-Card-A-Trial.cmd','START-HERE.txt')) {
            Add-KitFile (Join-Path $PSScriptRoot ('commissioned-pos/' + $file)) $file
        }
        foreach ($file in @('Check-Original-Recovery.cmd','read-original.ps1','inspect.js','START-HERE.txt')) {
            Add-KitFile (Join-Path $PSScriptRoot ('pf700-original-evidence/' + $file)) ('Recovery/' + $file)
        }
        foreach ($file in @('runtime/node.exe','runtime/NODE-LICENSE.txt')) {
            $matchesInKit = @($reader.Entries | Where-Object { $_.FullName.Replace('\','/') -ceq $file })
            if ($matchesInKit.Count -ne 1 -or $matchesInKit[0].Length -eq 0) { throw 'Missing or ambiguous evidence runtime.' }
            $sourceStream = $matchesInKit[0].Open()
            try {
                $targetStream = $archive.CreateEntry(('Recovery/' + $file), $compression).Open()
                try { $sourceStream.CopyTo($targetStream) } finally { $targetStream.Dispose() }
            } finally { $sourceStream.Dispose() }
        }
    } finally { $archive.Dispose() }
    [IO.File]::Move($temp, $final)
    Write-Output $final
} finally {
    $reader.Dispose()
    if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
}
