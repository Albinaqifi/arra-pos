# Interactive launcher for the portable paper test. Uses the installed Arra runtime.
$ErrorActionPreference = 'Stop'
try {
    $runtime = Join-Path $env:LOCALAPPDATA 'Arra POS Offline Test\1.0.3\electron.exe'
    $tool = Join-Path $PSScriptRoot 'paper-test.js'
    if (!(Test-Path -LiteralPath $runtime -PathType Leaf)) {
        throw 'Open the Arra 1.0.3 offline test on this Windows account first.'
    }
    if (!(Test-Path -LiteralPath $tool -PathType Leaf)) {
        throw 'Extract the entire paper test ZIP, then open PF700-Paper-Test.cmd again.'
    }
    Write-Host 'Synergy PF700 paper test v2 on COM3'
    Write-Host 'This prints one diagnostic slip. It records no sale and does not close the day.'
    Write-Host 'Check that the printer is idle, paper is loaded, and any earlier uncertain sale or close is resolved.'
    $confirmation = Read-Host 'Type PRINT and press Enter for one slip, or press Enter alone to cancel'
    if ($confirmation -cne 'PRINT') {
        Write-Host 'Cancelled. Nothing was sent to the printer.'
        exit 0
    }
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $runtime
    $info.Arguments = '"' + $tool + '" --print-diagnostic-slip'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $child = [Diagnostics.Process]::Start($info)
    try {
        $errors = $child.StandardError.ReadToEndAsync()
        [Console]::Write($child.StandardOutput.ReadToEnd())
        $child.WaitForExit()
        [Console]::Error.Write($errors.GetAwaiter().GetResult())
        $result = $child.ExitCode
    } finally {
        $child.Dispose()
    }
    exit $result
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
