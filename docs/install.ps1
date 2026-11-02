# Pocket Terminal, one-line install for Windows. In PowerShell (no admin needed):
#
#   irm https://utsavdoye20122005.github.io/pocket-terminal/install.ps1 | iex
#
# Downloads the latest version from GitHub into ~\.pocket-terminal\app, then runs its installer.
# Run it again any time to update. Your pairing stays (it lives in ~\.pocket-terminal).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # makes the download much faster
$repo = if ($env:POCKET_REPO) { $env:POCKET_REPO } else { 'UtsavDoye20122005/pocket-terminal' }
$branch = if ($env:POCKET_BRANCH) { $env:POCKET_BRANCH } else { 'main' }
$home2 = Join-Path $HOME '.pocket-terminal'
$dest = Join-Path $home2 'app'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Pocket Terminal needs Node.js 18.20 or newer. Install the LTS, then run this line again:'
  Write-Host '  https://nodejs.org   or:  winget install OpenJS.NodeJS.LTS'
  return
}

Write-Host 'Downloading Pocket Terminal...'
$tmp = Join-Path $env:TEMP ("pocket-terminal-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest "https://codeload.github.com/$repo/zip/refs/heads/$branch" -OutFile (Join-Path $tmp 'pt.zip') -UseBasicParsing
Expand-Archive (Join-Path $tmp 'pt.zip') $tmp -Force
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (-not (Test-Path (Join-Path $src.FullName 'agent\agent.js'))) { Write-Host 'The download looks wrong. Try again in a minute.'; return }

# An update: stop the running agent first (Windows locks files that are in use).
Stop-ScheduledTask -TaskName 'PocketTerminalAgent' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='wscript.exe' OR Name='node.exe' OR Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*start-agent.vbs*' -or $_.CommandLine -like '*pocket-terminal*agent.js*' -or $_.CommandLine -like '*PtIdle*' } |
  ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
Start-Sleep -Milliseconds 500

New-Item -ItemType Directory -Force $home2 | Out-Null
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Move-Item $src.FullName $dest
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Host "Installed to $dest"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'agent\install.ps1')
