@echo off
title NewLife - Auto Push to GitHub
chcp 65001 >nul
echo.
echo  رفع تلقائي على GitHub - NewLife PS4 Catalog
echo  ============================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0auto-push.ps1"
pause
