<#
.SYNOPSIS
  Builds the Living Room Sports desktop launcher and creates its shortcuts.

.DESCRIPTION
  Draws the app icon, compiles launcher\LivingRoomSports.cs into dist\LivingRoomSports.exe with the C#
  compiler that ships with Windows, and puts a "Living Room Sports" shortcut on the Desktop and in the
  Start menu. Safe to run again (for example after moving the project folder).

.PARAMETER OutDir
  Where the .exe and .ico go. Default: <project>\dist.

.PARAMETER ShortcutDir
  Folders that get a shortcut. Default: the Desktop and the Start menu Programs folder.

.PARAMETER NoShortcuts
  Build the launcher only.
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [string[]]$ShortcutDir,
  [switch]$NoShortcuts
)
$ErrorActionPreference = 'Stop'
$AppName = 'Living Room Sports'
$project = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $project 'dist' }
if (-not $ShortcutDir) { $ShortcutDir = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$exe = Join-Path $OutDir 'LivingRoomSports.exe'
$ico = Join-Path $OutDir 'LivingRoomSports.ico'

# ---- Icon: the same artwork as public\icon.svg, drawn at each icon size ----
Add-Type -AssemblyName System.Drawing
function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $path
}
function New-IconPng([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.ScaleTransform($size / 256, $size / 256)
    $color = { param($hex) [System.Drawing.ColorTranslator]::FromHtml($hex) }
    $tile = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 8), (New-Object System.Drawing.PointF 0, 248), (& $color '#35bdee'), (& $color '#0d7fb0')
    $g.FillPath($tile, (New-RoundedRect 8 8 240 240 56))
    $g.FillPath([System.Drawing.Brushes]::White, (New-RoundedRect 94 30 68 196 32))
    $grey = New-Object System.Drawing.SolidBrush (& $color '#9ab3bf')
    $g.FillRectangle($grey, 110, 70, 36, 12)
    $g.FillRectangle($grey, 122, 58, 12, 36)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush (& $color '#139ed3')), 113, 109, 30, 30)
    $x = 102
    foreach ($hex in '#149ed4', '#ef665e', '#61b968', '#e1ab23') {
      $g.FillEllipse((New-Object System.Drawing.SolidBrush (& $color $hex)), $x, 191, 10, 10)
      $x += 14
    }
  } finally { $g.Dispose() }
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  , $stream.ToArray()
}
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($size in $sizes) { $images.Add((New-IconPng $size)) }
$file = [System.IO.File]::Create($ico)
$writer = New-Object System.IO.BinaryWriter $file
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = [byte]($sizes[$i] % 256)   # 0 means 256 in the icon directory
    $writer.Write($dimension); $writer.Write($dimension)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($image in $images) { $writer.Write($image) }
} finally { $writer.Dispose() }

# ---- Launcher .exe ----
$csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found. It ships with Windows 10 and 11.' }
$source = Join-Path $PSScriptRoot 'LivingRoomSports.cs'
$ErrorActionPreference = 'Continue'   # Windows PowerShell 5.1 would otherwise stop on compiler output
$output = & $csc /nologo /target:winexe /optimize+ "/out:$exe" "/win32icon:$ico" /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $source 2>&1
$compiled = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not $compiled) {
  $output | Write-Host
  if ($output -match 'being used by another process|Cannot open .* for writing') {
    throw "$AppName is open. Close its window, then run this again."
  }
  throw 'Building the launcher failed.'
}
Write-Host "Built $exe"

# ---- Shortcuts ----
if (-not $NoShortcuts) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($dir in $ShortcutDir) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $path = Join-Path $dir "$AppName.lnk"
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $project
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = 'Play Living Room Sports: opens the dashboard and lets phones join as remotes.'
    $shortcut.Save()
    Write-Host "Shortcut: $path"
  }
}
