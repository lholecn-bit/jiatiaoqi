@echo off
title 夹挑棋服务器
echo ============================
echo   夹挑棋 · 局域网对战服务
echo ============================
echo.
echo [启动] 单端口合并服务 (HTTP + WebSocket)
echo.

REM 获取局域网 IP
set IP=127.0.0.1
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr /v "169.254"') do (
    set IP=%%a
    set IP=%IP:~1%
    goto :found
)
:found

echo ============================
echo 服务已启动！访问地址:
echo.
echo   局域网: http://%IP%:8080
echo   本机:   http://127.0.0.1:8080
echo.
echo   在线模式填: ws://%IP%:8080
echo.
echo 关闭本窗口即停止服务。
echo ============================
echo.
node server.js
