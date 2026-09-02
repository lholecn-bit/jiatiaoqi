@echo off
title 夹挑棋服务器 (公网)
echo ============================
echo   夹挑棋 · 公网对战服务
echo ============================
echo.
echo [启动] 单端口合并服务 (HTTP + WebSocket, 端口 8080)
echo.

REM 获取 Tailscale 域名（如果有）
set TS_DOMAIN=
for /f "tokens=*" %%i in ('tailscale status --json 2^>nul ^| node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);console.log(j.Self.DNSName.replace(/\.$/,''))}catch{console.log('')}})"') do set TS_DOMAIN=%%i

if "%TS_DOMAIN%"=="" (
    echo [提示] 未检测到 Tailscale，仅局域网可用。
    echo   安装 Tailscale 并启用 Funnel 后，可获得公网地址:
    echo     https://you.tailnet-name.ts.net
    echo.
)

REM 局域网 IP
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
if not "%TS_DOMAIN%"=="" (
    echo   公网: https://%TS_DOMAIN%  (需要先执行: tailscale funnel 8080)
    echo   在线模式: wss://%TS_DOMAIN%
    echo.
)
echo   局域网: http://%IP%:8080
echo   本机:   http://127.0.0.1:8080
echo   在线模式: ws://%IP%:8080  (局域网)
echo.
echo 关闭本窗口即停止服务。
echo ============================
echo.
node server.js
