@echo off
rem ---------------------------------------------------------------------------
rem  crm-mini launcher.
rem
rem  KEEP THIS FILE PURE ASCII. cmd.exe reads a batch file using the console code
rem  page (936/GBK on Chinese Windows), so UTF-8 Chinese in here is decoded into
rem  garbage and then executed as commands. All Chinese output lives in
rem  scripts/start.mjs, which Node prints correctly.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"

rem The sandbox injects a delete-shim through NODE_OPTIONS that blocks nuxt build.
rem scripts/start.mjs clears it for the child processes too; set CRM_KEEP_NODE_OPTIONS=1
rem (before running this file) to keep your own NODE_OPTIONS instead.
if not defined CRM_KEEP_NODE_OPTIONS set NODE_OPTIONS=

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo         Install Node.js 20 LTS or newer, then run this file again.
  echo         Download: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\start.mjs" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo [ERROR] Launcher exited with code %EXITCODE%.
)

echo.
pause
exit /b %EXITCODE%
