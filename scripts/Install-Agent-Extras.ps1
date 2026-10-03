[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PythonExecutable,
    [string]$ToolsDirectory=(Join-Path $env:USERPROFILE 'AgentTools'),
    [string]$ConfigFile=(Join-Path $env:USERPROFILE 'AgentTools\MuseLink\config.json')
)
$ErrorActionPreference='Stop'
$tools=[IO.Path]::GetFullPath($ToolsDirectory)
function RunChecked([string]$command,[string[]]$arguments) {
    & $command @arguments
    if($LASTEXITCODE -ne 0){throw "Dependency command failed: $command"}
}
function Checkout([string]$repository,[string]$directory,[string]$revision) {
    if(Test-Path -LiteralPath $directory) {
        $actual=& git -C $directory rev-parse HEAD
        if($LASTEXITCODE -ne 0 -or $actual -ne $revision){throw "Existing $directory is not the pinned version. Preserve it and choose another ToolsDirectory."}
        $changes=& git -C $directory status --porcelain
        if($LASTEXITCODE -ne 0 -or $changes){throw "Existing $directory contains changes; preserve it and choose another ToolsDirectory."}
    }else{
        RunChecked 'git' @('clone','--filter=blob:none','--no-checkout',$repository,$directory)
        RunChecked 'git' @('-C',$directory,'checkout','--detach',$revision)
    }
}
$pythonPath=(Get-Command $PythonExecutable -ErrorAction Stop).Source
$version=& $pythonPath -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")'
if($version -ne '3.12'){throw 'Use an explicit Python 3.12 executable for the tested pinned vision wheels.'}
New-Item -ItemType Directory -Path $tools -Force | Out-Null
$winapp=Join-Path $tools 'WinApp'
if(!(Test-Path -LiteralPath (Join-Path $winapp 'winapp.exe'))) {
    $archive=Join-Path $tools 'winappcli-x64-0.7.1.zip'
    Invoke-WebRequest 'https://github.com/microsoft/winappCli/releases/download/v0.7.1/winappcli-x64.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $winapp -Force
}
$winappExe=Join-Path $winapp 'winapp.exe'
if((Get-AuthenticodeSignature -LiteralPath $winappExe).Status -ne 'Valid'){throw 'winapp signature verification failed.'}
$env:WINAPP_CLI_TELEMETRY_OPTOUT='1'
$winappVersion=& $winappExe --version
if($LASTEXITCODE -ne 0 -or $winappVersion.Trim() -ne '0.7.1'){throw 'Expected the pinned winapp 0.7.1 executable.'}
$ufo=Join-Path $tools 'UFO';$omni=Join-Path $tools 'OmniParser';$runtime=Join-Path $tools 'AgentPerception'
Checkout 'https://github.com/microsoft/UFO.git' $ufo 'a795552d976c4c019d7c2f778a0effb5cef7de6b'
Checkout 'https://github.com/microsoft/OmniParser.git' $omni '354021201345a96178360b28733573e27269f2de'
$venv=Join-Path $runtime 'venv'
if(!(Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))){RunChecked $pythonPath @('-m','venv',$venv)}
$workerPython=Join-Path $venv 'Scripts\python.exe'
$workerVersion=& $workerPython -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")'
if($LASTEXITCODE -ne 0 -or $workerVersion -ne '3.12'){throw 'Existing app venv must use Python 3.12; preserve it and choose another ToolsDirectory.'}
RunChecked $workerPython @('-m','pip','install','--disable-pip-version-check','--extra-index-url','https://download.pytorch.org/whl/cpu','-r',(Join-Path $PSScriptRoot 'requirements-agent-apps.txt'))
$env:HF_HUB_DISABLE_TELEMETRY='1'
$env:MUSE_EXTRA_HOME=$runtime
RunChecked $workerPython @('-c',"import os;from huggingface_hub import hf_hub_download;import easyocr;p=os.environ['MUSE_EXTRA_HOME'];hf_hub_download('microsoft/OmniParser-v2.0','icon_detect_v3/model.pt',revision='d10c4687d4af8245d67780ae59900f09660aad3a',local_dir=os.path.join(p,'weights'));easyocr.Reader(['en'],gpu=False,model_storage_directory=os.path.join(p,'ocr'),verbose=False)")
RunChecked $workerPython @('-m','pip','check')
$config=Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$extra=[ordered]@{kind='assist';winappBinary=$winappExe;python=$workerPython;ufoDirectory=$ufo;omniDirectory=$omni;modelFile=(Join-Path $runtime 'weights\icon_detect_v3\model.pt');ocrDirectory=(Join-Path $runtime 'ocr')}
$config.engines | Add-Member -NotePropertyName assist -NotePropertyValue $extra -Force
if(!$config.engines.agent){throw 'Configure the combined agent engine first.'}
$config.engines.agent | Add-Member -NotePropertyName assist -NotePropertyValue 'assist' -Force
Copy-Item -LiteralPath $ConfigFile -Destination ($ConfigFile+'.before-extras') -Force
[IO.File]::WriteAllText($ConfigFile,($config | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach($file in @($ConfigFile,($ConfigFile+'.before-extras'))) {
    & icacls.exe $file /inheritance:r /grant:r "${identity}:F" 'SYSTEM:F' | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Could not protect local configuration files.'}
}
Write-Host 'Installed pinned local providers and configured the combined agent channel.'
Write-Host 'Install SideScreen 0.5 or newer, then restart Muse Link once. Models stay local and load on demand.'
