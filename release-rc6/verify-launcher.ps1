param([Parameter(Mandatory=$true)][string]$Kit)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Kit).Path)
$launcher = Join-Path $root 'Arra POS.exe'
$assembly = [Reflection.Assembly]::LoadFile($launcher)
$release = $assembly.GetType('ReleaseFiles', $true)
$method = $release.GetMethod('Verify', [Reflection.BindingFlags]'NonPublic,Static')
if ($assembly.GetName().Version.ToString() -ne '1.0.10.6') { throw 'Wrong launcher version' }
if ($assembly.GetManifestResourceNames() -cnotcontains 'ArraPOS.RC6.sha256') { throw 'Wrong manifest name' }
[void]$method.Invoke($null, @($root))
Write-Output 'PASS RC6 launcher accepted its complete unmodified payload'
$file = Join-Path $root 'Open-Arra-Pay.cmd'
$bytes = [IO.File]::ReadAllBytes($file)
try {
    [IO.File]::WriteAllBytes($file, $bytes + [byte[]]@(13,10))
    $rejected = $false
    try { [void]$method.Invoke($null, @($root)) } catch { $rejected = $true }
    if (!$rejected) { throw 'Launcher accepted a modified payload' }
    Write-Output 'PASS RC6 launcher rejected a changed payload file'
} finally { [IO.File]::WriteAllBytes($file, $bytes) }
[void]$method.Invoke($null, @($root))
Write-Output 'PASS restored payload accepted'
