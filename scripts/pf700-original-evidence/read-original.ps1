# Windows PowerShell 5.1. Deny writers while SQLite inspects both originals.
$ErrorActionPreference = 'Stop'
$handles = @()
$exitCode = 1
$message = 'INCONCLUSIVE - Could not read the original records. Close Arra and its recovery tools, then try again.'
try {
    if ($args.Count -ne 0) { throw 'No arguments accepted' }
    function Test-LocalPath([string]$path) {
        if ($path -notmatch '^[A-Za-z]:\\' -or $path -cne [IO.Path]::GetFullPath($path)) { throw 'Local path required' }
        if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($path)).DriveType -ne [IO.DriveType]::Fixed) {
            throw 'Local records required'
        }
        $parts = [Collections.Generic.Stack[string]]::new()
        $cursor = $path
        while ($cursor) {
            $parts.Push($cursor)
            $cursor = [IO.Path]::GetDirectoryName($cursor)
        }
        foreach ($part in $parts) {
            try { $attributes = [IO.File]::GetAttributes($part) }
            catch {
                $reason = $_.Exception.GetBaseException()
                if ($reason -is [IO.FileNotFoundException] -or $reason -is [IO.DirectoryNotFoundException]) { return $false }
                throw
            }
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Redirected file or directory'
            }
        }
        return $true
    }
    $profileDir = [IO.Path]::Combine($env:APPDATA,'Arra POS PF700 Commissioning')
    $ledgerDir = [IO.Path]::Combine($env:LOCALAPPDATA,'Arra POS\PF700 commissioning')
    if (!(Test-LocalPath $profileDir) -or !(Test-LocalPath $ledgerDir)) {
        $message = 'MISSING - The original commissioning database or recovery journal folder was not found for this Windows user.'
        throw 'Missing folder'
    }
    $database = Join-Path $profileDir 'arra.sqlite'
    $candidates = @(Get-ChildItem -LiteralPath $ledgerDir -Filter '*.finish.sqlite' -Force)
    if ($candidates.Count -eq 0 -or !(Test-LocalPath $database)) {
        $message = 'MISSING - The original commissioning database or recovery journal was not found for this Windows user.'
        throw 'Missing file'
    }
    if ($candidates.Count -ne 1) {
        $message = 'INCONCLUSIVE - Multiple recovery journals were found.'
        throw 'Ambiguous journal'
    }
    if ($candidates[0].PSIsContainer -or $candidates[0].Name -cnotmatch '^[a-f0-9]{64}\.finish\.sqlite$') { throw 'Unexpected file' }
    $databases = @($database, $candidates[0].FullName)
    foreach ($dbPath in $databases) {
        if (!(Test-LocalPath $dbPath)) { throw 'Missing original file' }
        $handles += [IO.File]::Open($dbPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    }
    foreach ($dbPath in $databases) {
        foreach ($suffix in @('-wal','-shm','-journal')) {
            if (Test-Path -LiteralPath ($dbPath + $suffix)) {
                $message = 'INCONCLUSIVE - SQLite companion files are present. Leave all files in place.'
                throw 'Unsettled SQLite files'
            }
        }
    }
    $node = Join-Path $PSScriptRoot 'runtime\node.exe'
    $env:ARRA_EVIDENCE_LOCKED = '1'
    $env:NODE_OPTIONS = ''
    $env:NODE_PATH = ''
    $env:NODE_COMPILE_CACHE = ''
    $env:NODE_V8_COVERAGE = ''
    $messages = @{
        MATCH = 'MATCH - The original bill links all four recovery stages to the verified fiscal document and one recorded Cash A payment.'
        STAGE0 = 'INCOMPLETE - The journal contains zero of four recovery stages.'
        STAGE1 = 'INCOMPLETE - Stage 1 of 4 matched. The finisher saved the cash tender intent after checking the unpaid receipt.'
        STAGE2 = 'INCOMPLETE - Stages 1 and 2 of 4 matched. The finisher confirmed full tender before requesting closure.'
        STAGE3 = 'INCOMPLETE - Stages 1 through 3 of 4 matched. The finisher saved the close acknowledgement and counters.'
        UNSETTLED = 'INCOMPLETE - All four journal stages matched, but the final Arra result or payment is missing.'
        MISMATCH = 'INCONCLUSIVE - The original records could not be matched.'
    }
    $message = 'INCONCLUSIVE - The inspector could not run. Extract the complete ZIP and try again.'
    $inspector = Join-Path $PSScriptRoot 'inspect.js'
    if (!(Test-Path -LiteralPath $inspector -PathType Leaf)) { throw 'Missing inspector' }
    $output = @(& $node --no-warnings $inspector 2>$null)
    $code = $LASTEXITCODE
    if ($output.Count -ne 1 -or $messages.Keys -cnotcontains $output[0] -or
        ($output[0] -ceq 'MATCH' -and $code -ne 0) -or ($output[0] -cne 'MATCH' -and $code -ne 1)) {
        throw 'Unrecognized result'
    }
    Write-Output $messages[$output[0]]
    $exitCode = $code
} catch {
    Write-Output $message
} finally {
    foreach ($handle in $handles) { $handle.Dispose() }
}
exit $exitCode
