param(
    [string]$HomeDirectory = (Join-Path $env:USERPROFILE 'AgentTools\MuseLink'),
    [string]$NodeExecutable = 'node.exe'
)
$ErrorActionPreference = 'Stop'
if ((Get-Process -Id $PID).SessionId -eq 0) { throw 'Run Muse Link in a signed-in user session.' }
$env:MUSE_LINK_HOME = [IO.Path]::GetFullPath($HomeDirectory)
$nodePath = (Get-Command $NodeExecutable -ErrorAction Stop).Source
$packageDirectory = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $packageDirectory 'bin\muse-link.mjs'
$stateDirectory = Join-Path $env:MUSE_LINK_HOME 'state'
$port = 18921
$configFile = Join-Path $env:MUSE_LINK_HOME 'config.json'
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    if ($config.port) { $port = [int]$config.port }
    if ($config.stateDir) { $stateDirectory = [IO.Path]::GetFullPath($config.stateDir) }
}
# A scheduled task uses only this home's config; do not inherit migration overrides.
Remove-Item Env:MUSE_LINK_CONFIG -ErrorAction SilentlyContinue
Remove-Item Env:MUSE_LINK_PORT -ErrorAction SilentlyContinue
Remove-Item Env:MUSE_LINK_STATE_DIR -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateDirectory /inheritance:r /grant:r "${account}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect Muse Link state.' }
$sha = [Security.Cryptography.SHA256]::Create()
$homeHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:MUSE_LINK_HOME.ToLowerInvariant()))).Replace('-', '').Substring(0, 16)
$sha.Dispose()
$mutex = New-Object Threading.Mutex($false, "Local\MuseLink-$homeHash")
if (!$mutex.WaitOne(0)) { $mutex.Dispose(); exit 0 }
$logFile = Join-Path $stateDirectory 'startup.log'
try {
    while (!(Test-Path -LiteralPath (Join-Path $stateDirectory 'paused'))) {
        # A running listener may be the existing Muse installation. Never replace it.
        if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
            Start-Sleep -Seconds 15
            continue
        }
        if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 2MB) {
            Move-Item -LiteralPath $logFile -Destination (Join-Path $stateDirectory 'startup.previous.log') -Force
        }
        Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) Starting Muse Link"
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try { & $nodePath $cli serve >> $logFile 2>&1 }
        finally { $ErrorActionPreference = $oldPreference }
        Start-Sleep -Seconds 10
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
