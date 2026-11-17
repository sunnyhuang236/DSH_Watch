@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo ============================================
echo  DSH Watch 一键恢复配对
echo  适用：手机掉线 / devices=0 / 推送收不到
echo ============================================
echo.
echo [1/3] 启动局域网网关 8787...
call "scripts\start-m3-lan.cmd"
timeout /t 3 /nobreak >nul
echo.
echo 本机局域网地址（手机请用下面 IPv4）：
ipconfig | findstr /C:"IPv4"
echo.
echo [2/3] 生成配对码...
node packages\gateway\bin\pair.mjs
echo.
echo [3/3] 配对完成后，检查服务状态：
echo   curl http://127.0.0.1:8787/v1/health
echo   期望 devices ^>= 1；PWA 还需在设置里开启通知后 subscriptions ^>= 1
pause