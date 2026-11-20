# Run with Windows PowerShell 5.1, -STA, using the built launcher executable.
param(
    [Parameter(Mandatory=$true)][string]$Launcher,
    [string]$PreviewImage
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$exe = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Launcher).Path)
$assembly = [Reflection.Assembly]::LoadFile($exe)
$appType = $assembly.GetType('ArraPos', $true)
$setupType = $assembly.GetType('PrinterSetup', $true)
$profileType = $assembly.GetType('PrinterProfile', $true)
$static = [Reflection.BindingFlags]'NonPublic,Static'
$instance = [Reflection.BindingFlags]'NonPublic,Instance'
$save = $appType.GetMethod('SaveSetup', $static)
$read = $appType.GetMethod('ReadProfile', $static)
$fixture = [IO.Path]::Combine([IO.Path]::GetTempPath(), ('arra-shortcut-' + [guid]::NewGuid().ToString('N')))
[void][IO.Directory]::CreateDirectory($fixture)

function Check([bool]$result, [string]$message) {
    if (!$result) { throw $message }
}
try {
    $store = [IO.Path]::Combine($fixture,'settings/rc4.profile')
    $desktop = [IO.Path]::Combine($fixture,'Desktop')
    [void][IO.Directory]::CreateDirectory($desktop)
    $profile = [Activator]::CreateInstance($profileType, $true)
    $profile.dataDirectory = $fixture
    $profile.operatorNumber = 2
    $profile.expectedSerial = [guid]::NewGuid().ToString('N').Substring(0,11)
    $profile.tillNumber = '1'
    $profile.operatorPassword = [string](Get-Random -Minimum 100000 -Maximum 1000000)
    $shell = New-Object -ComObject WScript.Shell
    $existing = Join-Path $desktop 'Arra POS.lnk'
    $other = $shell.CreateShortcut($existing)
    $other.TargetPath = $exe
    $other.Arguments = '--setup'
    $other.Save()
    $existingBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($existing))
    $linkPath = $save.Invoke($null, @($profile, $store, $desktop, $exe))
    Check ($linkPath -ne $existing) 'An unrelated shortcut was overwritten.'
    Check ($existingBytes -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($existing))) 'Unrelated link contents changed.'
    $link = $shell.CreateShortcut($linkPath)
    Check ($link.TargetPath -eq $exe -and $link.Arguments -ceq '--open') 'Wrong shortcut destination.'
    Check ($link.WorkingDirectory -eq [IO.Path]::GetDirectoryName($exe)) 'Wrong shortcut folder.'
    $restored = $read.Invoke($null, @($store,$fixture))
    Check ($restored.expectedSerial -ceq $profile.expectedSerial -and $restored.operatorPassword -ceq $profile.operatorPassword) 'Protected profile round trip failed.'
    $cipher = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($store))
    Check (!$cipher.Contains($profile.expectedSerial) -and !$cipher.Contains($profile.operatorPassword)) 'Profile contains cleartext fields.'
    $profile.operatorPassword = [string](Get-Random -Minimum 100000 -Maximum 1000000)
    Check ($save.Invoke($null,@($profile,$store,$desktop,$exe)) -eq $linkPath) 'Repeat setup duplicated the shortcut.'
    Check ($read.Invoke($null,@($store,$fixture)).operatorPassword -ceq $profile.operatorPassword) 'Updating settings failed.'
    $previous = [Convert]::ToBase64String([IO.File]::ReadAllBytes($store))
    $failed = $false
    try { [void]$save.Invoke($null,@($profile,$store,[IO.Path]::Combine($fixture,'unavailable-desktop'),$exe)) }
    catch { $failed = $true }
    Check ($failed -and $previous -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($store))) 'Failed setup changed previous settings.'
    $failed = $false
    try { [void]$read.Invoke($null,@($store,[IO.Path]::Combine($fixture,'different-profile'))) }
    catch { $failed = $true }
    Check $failed 'Wrong restaurant profile was accepted.'
    'PASS protected profile, exact desktop link, unrelated shortcut, repeated and failed setup'

    $form = $setupType.GetConstructor($instance,$null,@([string]),$null).Invoke(@($fixture))
    try {
        $form.ShowInTaskbar = $false
        $form.StartPosition = 'Manual'
        $form.Location = New-Object Drawing.Point(-24000,-24000)
        $form.Show()
        [Windows.Forms.Application]::DoEvents()
        $layout = $form.Controls[0]
        $fields = @($layout.Controls | Where-Object { $_ -is [Windows.Forms.TextBox] })
        $consent = $layout.Controls | Where-Object { $_ -is [Windows.Forms.CheckBox] }
        Check ($fields.Count -eq 4 -and @($fields | Where-Object UseSystemPasswordChar).Count -eq 1) 'Setup fields or password masking missing.'
        Check (!$consent.Checked -and $consent.Visible -and $consent.Text -match 'live checkout') 'Live consent must start unchecked.'
        foreach ($control in $layout.Controls) {
            Check ($layout.ClientRectangle.Contains($control.Bounds)) 'A setup control fell outside the dialog.'
        }
        if ($PreviewImage) {
            $bitmap = New-Object Drawing.Bitmap($form.Width,$form.Height)
            try {
                $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
                $bitmap.Save([IO.Path]::GetFullPath($PreviewImage), [Drawing.Imaging.ImageFormat]::Png)
            } finally { $bitmap.Dispose() }
        }
        $form.CancelButton.PerformClick()
        Check ($form.DialogResult -eq 'Cancel') 'Cancel should leave setup.'
        Check ($null -eq $setupType.GetProperty('Profile',$instance).GetValue($form)) 'Cancel produced printer settings.'
        'PASS setup layout, masked printer password, explicit live consent and cancellation'
    } finally { $form.Dispose() }
} finally {
    $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($fixture) -eq $expectedParent -and [IO.Path]::GetFileName($fixture) -match '^arra-shortcut-[0-9a-f]{32}$') {
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
