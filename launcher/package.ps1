<#
.SYNOPSIS
  Builds the portable Living Room Sports folder and zip.

.DESCRIPTION
  Puts everything the console needs in one folder that runs from anywhere, with nothing else to install:
  the launcher ("Living Room Sports.exe"), the server and its pages, and a copy of this PC's Node.js in
  runtime\. Then zips it. Settings, saves and certificates are not part of it: they live in
  %LOCALAPPDATA%\LivingRoomSports, and Dolphin's own folders are never touched by packaging.

.PARAMETER OutDir
  Where the folder and zip go. Default: <project>\dist.

.PARAMETER Node
  The node.exe to bundle. Default: the one on PATH. Must be version 22 or newer.

.PARAMETER NoZip
  Build the folder only.
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [string]$Node,
  [switch]$NoZip
)
$ErrorActionPreference = 'Stop'
$AppName = 'Living Room Sports'
$project = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $project 'dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$version = (Get-Content -Raw (Join-Path $project 'package.json') | ConvertFrom-Json).version

# ---- Node.js to bundle ----
if (-not $Node) {
  $found = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $found) { throw 'Node.js was not found on PATH. Install Node.js 22 or newer, or pass -Node <path to node.exe>.' }
  $Node = $found.Source
}
$nodeVersion = (& $Node --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw "Node.js $nodeVersion is too old; version 22 or newer is needed." }

# ---- The folder ----
$folder = Join-Path $OutDir $AppName
if (Test-Path $folder) {
  try { Remove-Item -Recurse -Force $folder }
  catch { throw "$folder is in use. Close $AppName, then run this again." }
}
New-Item -ItemType Directory -Path $folder | Out-Null

$build = Join-Path ([IO.Path]::GetTempPath()) ("lrs-package-" + [Guid]::NewGuid().ToString('N'))
try {
  & (Join-Path $PSScriptRoot 'install.ps1') -OutDir $build -NoShortcuts 6>$null | Out-Null
  Copy-Item (Join-Path $build 'LivingRoomSports.exe') (Join-Path $folder "$AppName.exe")
} finally { Remove-Item -Recurse -Force $build -ErrorAction SilentlyContinue }

foreach ($file in 'server.js', 'qr.js', 'package.json', 'README.md') { Copy-Item (Join-Path $project $file) $folder }
foreach ($dir in 'public', 'console') { Copy-Item -Recurse (Join-Path $project $dir) (Join-Path $folder $dir) }

$runtime = New-Item -ItemType Directory -Path (Join-Path $folder 'runtime')
Copy-Item $Node (Join-Path $runtime 'node.exe')
# Node.js is MIT licensed; its notice travels with it. Installers do not always keep the LICENSE file.
$license = Join-Path (Split-Path -Parent $Node) 'LICENSE'
if (Test-Path $license) { Copy-Item $license (Join-Path $runtime 'Node.js LICENSE.txt') }
else {
  Set-Content -Path (Join-Path $runtime 'Node.js LICENSE.txt') -Encoding Ascii -Value @(
    "node.exe is Node.js $nodeVersion, copyright Node.js contributors and the OpenJS Foundation, used under the MIT license.",
    "The full license, including the licenses of the libraries it contains:",
    "https://github.com/nodejs/node/blob/$nodeVersion/LICENSE")
}

# Shortcuts for the folder wherever it ends up; run again after moving it.
$shortcutScript = @'
@echo off
rem Adds "Living Room Sports" to the Desktop and the Start menu, pointing at this folder.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$exe = Join-Path '%~dp0' 'Living Room Sports.exe'; $shell = New-Object -ComObject WScript.Shell;" ^
  "foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {" ^
  "  $s = $shell.CreateShortcut((Join-Path $dir 'Living Room Sports.lnk')); $s.TargetPath = $exe;" ^
  "  $s.WorkingDirectory = '%~dp0'.TrimEnd('\'); $s.IconLocation = $exe + ',0'; $s.Save() }"
if errorlevel 1 (echo Could not add the shortcuts.) else (echo Added "Living Room Sports" to the Desktop and the Start menu.)
pause
'@
Set-Content -Path (Join-Path $folder 'Add Shortcuts.cmd') -Value $shortcutScript -Encoding Ascii

$size = (Get-ChildItem -Recurse -File $folder | Measure-Object -Sum Length).Sum
Write-Host ("Built {0} ({1:N0} MB, Node.js {2})" -f $folder, ($size / 1MB), $nodeVersion)

# ---- The zip ----
if (-not $NoZip) {
  $zip = Join-Path $OutDir ("LivingRoomSports-{0}-portable.zip" -f $version)
  if (Test-Path $zip) { Remove-Item -Force $zip }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory($folder, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
  Write-Host ("Zipped {0} ({1:N0} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))
}
