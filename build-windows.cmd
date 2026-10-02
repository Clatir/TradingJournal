@echo off
rem Builds release\*.exe with the Node.js version pinned in .node-version (downloaded into .tools\,
rem the Node.js installed on this computer is not used). Double-click or run: build-windows.cmd [-SkipTests]
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-win.ps1" %*
set "code=%ERRORLEVEL%"
if not "%code%"=="0" (
  echo.
  echo Budowanie nie powiodlo sie ^(kod %code%^). Przewin wyzej, zeby zobaczyc przyczyne.
)
if not defined CI pause
exit /b %code%
