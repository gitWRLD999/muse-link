param(
    [string]$HomeDirectory = (Join-Path $env:LOCALAPPDATA 'MuseLink'),
    [string]$TaskName = 'Muse Link',
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$homePath = [IO.Path]::GetFullPath($HomeDirectory)
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$supervisor = Join-Path $PSScriptRoot 'Keep-Muse-Link.ps1'
foreach ($value in @($homePath, $nodePath, $supervisor)) {
    if ($value.Contains('"')) { throw 'Paths may not contain double quotes.' }
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw "Task '$TaskName' already exists. Remove it explicitly before reinstalling." }
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$supervisor`" -HomeDirectory `"$homePath`" -NodeExecutable `"$nodePath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
if ($StartNow) { Start-ScheduledTask -TaskName $TaskName }
Write-Output "Installed '$TaskName' for sign-in. Keep this package directory in place."
