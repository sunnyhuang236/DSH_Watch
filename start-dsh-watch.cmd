@echo off
chcp 65001 >nul
title DSH Watch 启动
cd /d "%~dp0"
echo [1/3] 启动网关 8787...
start "DSH Watch Gateway" cmd /c "node packages\gateway\bin\gateway.mjs"
timeout /t 5 /nobreak >nul
echo [2/3] 启动 cloudflared tunnel...
if exist ".data\bin\cloudflared.exe" goto :tunnel
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未找到 cloudflared。先安装：
  echo   winget install --id Cloudflare.cloudflared
  echo 或把 cloudflared.exe 放到 .data\bin\cloudflared.exe
  pause
  exit /b 1
)
:tunnel
start "DSH Watch Tunnel" cmd /c "npm run tunnel"
timeout /t 10 /nobreak >nul
echo [3/3] 手机配对：扫描/输入下面显示的地址和 8 位码
node packages\gateway\bin\pair.mjs
pause