$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$setup = Join-Path $repo 'src\desktop\create-bill-history-sample.js'
if (!(Test-Path -LiteralPath $electron)) { throw 'Electron is missing. Run npm install in the project folder first.' }
Write-Host 'Creating a NEW isolated sample database. Use sample passwords only.'
Write-Host 'Choose three different passwords for sample-owner-a, sample-owner-b and sample-combined.'
$values = @()
try {
    foreach ($name in @('sample-owner-a', 'sample-owner-b', 'sample-combined')) {
        $secure = Read-Host -Prompt "Password for $name" -AsSecureString
        $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $values += [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
    }
    Push-Location $repo
    try { & npm run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed.' } }
    finally { Pop-Location }
    Write-Host 'Generating one year of sample bills; this may take a moment...'
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $electron
    $info.Arguments = '"' + $setup + '"'
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $process = [System.Diagnostics.Process]::Start($info)
    $json = ConvertTo-Json -InputObject $values -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    try { $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length) }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $json = $null; $process.StandardInput.Close() }
    $output = $process.StandardOutput.ReadToEnd()
    $errorOutput = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Sample setup failed: $errorOutput" }
    $sample = $output | ConvertFrom-Json
    Write-Host "Created $($sample.total) sample bills in $($sample.directory)"
    Write-Host 'Sign in as sample-combined for both accounts, or sample-owner-a / sample-owner-b for each account.'
    Start-Process -FilePath $electron -ArgumentList ('"' + $repo + '" "--sample-data-directory=' + $sample.directory + '"') -WorkingDirectory $repo
} finally { for ($i = 0; $i -lt $values.Count; $i++) { $values[$i] = $null } }
