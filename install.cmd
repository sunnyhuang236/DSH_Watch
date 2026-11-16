@echo off
chcp 65001 >nul
title DSH Watch 安装
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-dsh-watch.ps1"
echo.
pause