#!/usr/bin/env bash
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
