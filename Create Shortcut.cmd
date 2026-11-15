@echo off
rem Builds the Living Room Sports launcher and adds Desktop and Start menu shortcuts.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\install.ps1"
if errorlevel 1 (
  echo.
  echo Could not create the shortcut. See the message above.
) else (
  echo.
  echo Done. Open "Living Room Sports" from your Desktop or Start menu.
)
pause
