# Launch from the installed Arra program directory. The default uses an in-memory reply.
$ErrorActionPreference = 'Stop'
$diagnostic = Join-Path $PSScriptRoot 'resources\app\src\desktop\pf700-status-cli.js'
if ($args.Count -gt 0 -and ($args.Count -ne 1 -or $args[0] -cne '-ReadDeviceStatus')) {
    [Console]::Error.WriteLine('Use no arguments for the offline check, or the full -ReadDeviceStatus option for a live check.')
    exit 2
}
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = Join-Path $PSScriptRoot 'electron.exe'
$info.Arguments = '"' + $diagnostic + '"'
if ($args.Count -eq 1) { $info.Arguments += ' --read-device-status' }
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
$process = [System.Diagnostics.Process]::Start($info)
try {
    $errors = $process.StandardError.ReadToEndAsync()
    [Console]::Write($process.StandardOutput.ReadToEnd())
    $process.WaitForExit()
    [Console]::Error.Write($errors.GetAwaiter().GetResult())
    $exitCode = $process.ExitCode
} finally {
    $process.Dispose()
}
exit $exitCode
