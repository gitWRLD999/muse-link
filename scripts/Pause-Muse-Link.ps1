param([string]$HomeDirectory = (Join-Path $env:LOCALAPPDATA 'MuseLink'))
$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path ([IO.Path]::GetFullPath($HomeDirectory)) 'state'
$configFile = Join-Path $HomeDirectory 'config.json'
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if ($config.stateDir) { $stateDirectory = [IO.Path]::GetFullPath($config.stateDir) }
}
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Set-Content -LiteralPath (Join-Path $stateDirectory 'paused') -Value 'Paused explicitly'
$metadata = Join-Path $stateDirectory 'broker.json'
if (!(Test-Path -LiteralPath $metadata)) { return }
$broker = Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
# Only this package's broker may be stopped, never the legacy connection or a reused PID.
if (!$broker.brokerId) { return }
$cli = Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\muse-link.mjs'
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$broker.pid)"
if (!$processInfo -or $processInfo.Name -ne 'node.exe' -or !$processInfo.CommandLine.Contains($cli) -or $processInfo.CommandLine -notmatch '\sserve(?:\s|$)') { return }
if ($processInfo.CreationDate.ToUniversalTime() -gt ([DateTime]::Parse($broker.startedAt)).ToUniversalTime()) { return }
$listener = Get-NetTCPConnection -State Listen -LocalPort ([int]$broker.port) -ErrorAction SilentlyContinue
if ($listener.OwningProcess -contains ([int]$broker.pid)) { Stop-Process -Id ([int]$broker.pid) }
