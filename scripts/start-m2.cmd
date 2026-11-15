@echo off
setlocal
cd /d "%~dp0.."
set "STATE=%USERPROFILE%\.dsh\dsh-watch-gateway"
if not exist "%STATE%" mkdir "%STATE%" >nul 2>&1
set "NODE=D:\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

netstat -ano | findstr /C:":8787 " | findstr /I "LISTENING" >nul
if errorlevel 1 (
  start "" /B "%NODE%" "packages\gateway\bin\gateway.mjs" >> "%STATE%\gateway.log" 2>> "%STATE%\gateway.err.log"
)

tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | findstr /I "cloudflared.exe" >nul
if errorlevel 1 (
  if exist ".data\bin\cloudflared.exe" start "" /B "%NODE%" "packages\gateway\bin\tunnel.mjs" --bin ".data\bin\cloudflared.exe" >> "%STATE%\tunnel.log" 2>> "%STATE%\tunnel.err.log"
)
