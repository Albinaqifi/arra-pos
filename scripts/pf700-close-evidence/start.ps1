# Hold the original profile closed against writes while the Node reader
# compares the bill and, if separately authorized, captures evidence.
$ErrorActionPreference = 'Stop'
$lockedDatabase = $null
$result = 1
try {
    if ($args.Count -ne 0 -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { throw 'Use the launcher' }
    $database = [IO.Path]::Combine($env:APPDATA, 'Arra POS PF700 Commissioning', 'arra.sqlite')
    $ledger = [IO.Path]::Combine($env:LOCALAPPDATA, 'Arra POS', 'PF700 commissioning')
    foreach ($localPath in @($database, $ledger)) {
        if ($localPath -notmatch '^[A-Za-z]:\\' -or $localPath -cne [IO.Path]::GetFullPath($localPath) -or
            [IO.DriveInfo]::new([IO.Path]::GetPathRoot($localPath)).DriveType -ne [IO.DriveType]::Fixed) { throw 'Expected original local path' }
        $cursor = $localPath
        while ($cursor) {
            if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Redirected path' }
            $cursor = [IO.Path]::GetDirectoryName($cursor)
        }
    }
    if (![IO.Directory]::Exists($ledger)) { throw 'Missing commissioning directory' }
    $lockedDatabase = [IO.File]::Open($database, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    foreach ($suffix in @('-wal', '-shm', '-journal')) {
        if (Test-Path -LiteralPath ($database + $suffix)) { throw 'Database has outstanding companion files' }
    }
    $env:ARRA_CLOSE_EVIDENCE_LOCKED = '1'
    $env:NODE_OPTIONS = ''
    $env:NODE_PATH = ''
    $env:NODE_COMPILE_CACHE = ''
    $env:NODE_V8_COVERAGE = ''
    $node = Join-Path $PSScriptRoot '..\..\runtime\node.exe'
    & $node --no-warnings (Join-Path $PSScriptRoot 'collect.js')
    $result = $LASTEXITCODE
} catch {
    Write-Host 'STOP. Could not lock the original closed Arra database or start the checker. Leave all files in place.'
} finally {
    if ($lockedDatabase) { $lockedDatabase.Dispose() }
}
exit $result
