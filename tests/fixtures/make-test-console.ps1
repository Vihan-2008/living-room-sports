# Builds a throwaway console for manual verification: a stub Dolphin.exe (portable, so it never touches
# a real Dolphin user folder) and small disc images that carry only the headers the console reads.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests/fixtures/make-test-console.ps1 -Target <empty folder>
param([Parameter(Mandatory)] [string] $Target)
$ErrorActionPreference = 'Stop'

$dolphinDir = Join-Path $Target 'Dolphin-x64'
$games = Join-Path $Target 'Games'
New-Item -ItemType Directory -Force $dolphinDir, $games | Out-Null
Set-Content -LiteralPath (Join-Path $dolphinDir 'portable.txt') -Value '' -Encoding ascii

$csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found.' }
$source = Join-Path $PSScriptRoot 'StubDolphin.cs'
$output = & $csc /nologo /target:winexe /optimize+ "/out:$(Join-Path $dolphinDir 'Dolphin.exe')" /reference:System.Windows.Forms.dll $source 2>&1
if ($LASTEXITCODE -ne 0) { throw "Stub Dolphin did not compile:`n$output" }

# A Wii disc header: game ID at 0, the Wii magic word at 0x18, the internal name at 0x20.
function New-Disc([string] $Name, [string] $Id, [string] $Title) {
    $bytes = New-Object byte[] 0x440
    [Text.Encoding]::ASCII.GetBytes($Id).CopyTo($bytes, 0)
    [byte[]] (0x5D, 0x1C, 0x9E, 0xA3) | ForEach-Object -Begin { $i = 0x18 } -Process { $bytes[$i++] = $_ }
    [Text.Encoding]::UTF8.GetBytes($Title).CopyTo($bytes, 0x20)
    [IO.File]::WriteAllBytes((Join-Path $games $Name), $bytes)
}
New-Disc 'Mario Kart Wii (USA).iso' 'RMCE01' 'MARIO KART Wii'
New-Disc 'Wii Sports (USA).iso' 'RSPE01' 'Wii Sports'
New-Disc 'Wii Sports Resort (USA).iso' 'RZTE01' 'Wii Sports Resort'

Write-Output "Stub Dolphin: $(Join-Path $dolphinDir 'Dolphin.exe')"
Write-Output "Games folder: $games"
