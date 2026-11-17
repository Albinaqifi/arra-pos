$ErrorActionPreference = 'Stop'
$data = Join-Path $env:APPDATA 'Arra POS Sample Data'
if (Test-Path -LiteralPath $data) {
    Write-Host 'The sample data directory already exists. It was not changed.'
    exit 1
}
Write-Host 'SAMPLE DATA ONLY. Do not enter real sales or personal information.'
$prompts = @('Choose a distinct sample password for sample-restaurant', 'Choose a distinct sample password for sample-owner-a', 'Choose a distinct sample password for sample-owner-b', 'Choose a distinct sample password for sample-combined', 'Choose a four-digit sample waiter PIN', 'Choose a six-digit sample transfer manager PIN')
$values = @()
try {
    foreach ($prompt in $prompts) {
        $secure = Read-Host -Prompt $prompt -AsSecureString
        $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $values += [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
    }
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $PSScriptRoot 'electron.exe'
    $script = Join-Path $PSScriptRoot 'resources\app\src\desktop\setup-installed-sample.js'
    $info.Arguments = '"' + $script + '" "' + $data + '"'
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $process = [System.Diagnostics.Process]::Start($info)
    $json = ConvertTo-Json -InputObject $values -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    [Array]::Clear($bytes, 0, $bytes.Length)
    $json = $null
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errorOutput = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($output) { Write-Host $output.TrimEnd() }
    if ($process.ExitCode -ne 0) {
        if ($errorOutput) { Write-Host $errorOutput.TrimEnd() }
        exit 1
    }
} catch {
    Write-Host 'Sample setup failed. Existing data was not overwritten. If a new incomplete directory was created, move it aside before trying again.'
    exit 1
} finally {
    for ($i = 0; $i -lt $values.Count; $i++) { $values[$i] = $null }
}
