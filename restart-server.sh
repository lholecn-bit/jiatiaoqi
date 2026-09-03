#!/usr/bin/env bash
# 兼容保护：本脚本使用 bash 特性，请用 bash 运行（勿用 sh 执行）
if [ -z "${BASH_VERSION:-}" ]; then
    echo "[error] 请用 bash 运行本脚本：bash $0（或直接执行 ./$(basename "$0")）" >&2
    exit 1
fi
# ============================================================
# 夹挑棋 · 重启脚本（Linux/macOS）
# 用法：
#   ./restart-server.sh             # 默认端口 8080
#   PORT=9000 ./restart-server.sh   # 自定义端口
# ============================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$DIR/stop-server.sh"
sleep 0.5
"$DIR/start-server.sh"
