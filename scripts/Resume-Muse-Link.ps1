param(
    [string]$HomeDirectory = (Join-Path $env:LOCALAPPDATA 'MuseLink'),
    [string]$TaskName = 'Muse Link'
)
$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path ([IO.Path]::GetFullPath($HomeDirectory)) 'state'
$configFile = Join-Path $HomeDirectory 'config.json'
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if ($config.stateDir) { $stateDirectory = [IO.Path]::GetFullPath($config.stateDir) }
}
Remove-Item -LiteralPath (Join-Path $stateDirectory 'paused') -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
