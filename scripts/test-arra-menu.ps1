$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$setup = Join-Path $repo 'src\desktop\setup-arra-sample.js'
$data = Join-Path $env:APPDATA 'Arra POS Manual Menu Test Data'
if (!(Test-Path -LiteralPath $electron) -or !(Test-Path -LiteralPath (Join-Path $repo 'dist\index.html'))) {
    Write-Host 'The local Electron runtime or built app is missing. In the project folder, prepare dependencies and run npm run build first.'
    exit 1
}
if (!(Test-Path -LiteralPath $data)) {
    Write-Host 'SAMPLE TEST ONLY. Use sample credentials and no real sales.'
    $prompts = @('Restaurant account password', 'Owner A password', 'Owner B password', 'Combined owner password', 'Four-digit waiter PIN', 'Six-digit transfer manager PIN')
    $defaults = @('restaurant-arra', 'admin', 'adminB', 'dardan-admin', 'Waiter', 'Dardan')
    $roles = @('Restaurant account', 'Owner A', 'Owner B', 'Combined owner', 'Waiter', 'Transfer manager')
    $values = @()
    try {
        foreach ($prompt in $prompts) {
            $secure = Read-Host -Prompt $prompt -AsSecureString
            $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try { $values += [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
            finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
        }
        for ($i = 0; $i -lt $defaults.Count; $i++) {
            $name = Read-Host -Prompt "$($roles[$i]) username (Enter for $($defaults[$i]))"
            if ([string]::IsNullOrWhiteSpace($name)) { $name = $defaults[$i] }
            $values += $name
        }
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $electron
        $info.Arguments = '"' + $setup + '" "' + $data + '"'
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
        if ($process.ExitCode -ne 0) { if ($errorOutput) { Write-Host $errorOutput.TrimEnd() }; exit 1 }
    } finally { for ($i = 0; $i -lt $values.Count; $i++) { $values[$i] = $null } }
}
if (!(Test-Path -LiteralPath (Join-Path $data 'ARRA-SETUP-COMPLETE')) -or !(Test-Path -LiteralPath (Join-Path $data 'SAMPLE-DATA-ONLY')) -or !(Test-Path -LiteralPath (Join-Path $data 'arra.sqlite'))) {
    Write-Host "The separate test data folder is incomplete. Move it aside before retrying: $data"
    exit 1
}
Write-Host 'Opening the separate Arra menu sample.'
Start-Process -FilePath $electron -ArgumentList ('"' + $repo + '" "--sample-data-directory=' + $data + '"') -WorkingDirectory $repo
