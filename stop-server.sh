#!/usr/bin/env bash
# ============================================================
# 夹挑棋 · 停止脚本（Linux/macOS）
# 停止 server.js（单端口合并服务）。自动定位进程，不依赖写死的 PID。
#
# 匹配规则（只处理真正的 server.js，绝不误伤 online-server.js）：
#   * 命令行以 node 启动，且末参数文件名恰为 server.js
#     （node server.js / node /xxx/server.js 均可；online-server.js 会被排除）
#   * 若存在多个实例（如 IPv4/IPv6 双监听或重复启动），会全部停止
#
# 用法：
#   ./stop-server.sh            # 默认端口 8080
#   PORT=9000 ./stop-server.sh  # 与启动时一致的自定义端口
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
PID_FILE="$APP_DIR/.server.pid"

# ---- 是否为"node 启动的 server.js"（精确到文件名，排除 online-server.js）----
is_node_server() {
    local pid="$1" args last
    args="$(ps -o args= -p "$pid" 2>/dev/null)" || return 1
    [[ "$args" =~ node[[:space:]]+ ]] || return 1
    last="${args##* }"
    last="${last##*/}"
    [[ "$last" == "server.js" ]]
}

# ---- cwd 是否为本项目目录（读不到时视为未知，不强制）----
cwd_matches() {
    local pid="$1" cwd
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || return 1
    [[ "$cwd" == "$APP_DIR" ]]
}

# ---- 占用目标端口的进程 PID 列表 ----
port_pids() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti "tcp:$PORT" 2>/dev/null || true
    elif command -v ss >/dev/null 2>&1; then
        ss -tlnp 2>/dev/null | grep -E ":$PORT[[:space:]]" | grep -o 'pid=[0-9]*' | cut -d= -f2 || true
    fi
}

# ---- 全部候选：按命令行找的 server.js + 占端口的 server.js ----
all_server_pids() {
    local pid
    if command -v pgrep >/dev/null 2>&1; then
        for pid in $(pgrep -f 'server\.js' 2>/dev/null || true); do
            is_node_server "$pid" && echo "$pid"
        done
    fi
    for pid in $(port_pids); do
        is_node_server "$pid" && echo "$pid"
    done
}

# ---- 端口是否被占用 ----
port_in_use() {
    [[ -n "$(port_pids | head -1)" ]]
}

pids="$(all_server_pids | sort -un)"
if [[ -z "$pids" ]]; then
    rm -f "$PID_FILE"
    echo "[stop] 未发现运行中的 server.js，无需停止。"
    exit 0
fi

n="$(echo "$pids" | wc -l)"
echo "[stop] 发现 $n 个 server.js 实例，全部停止："
for pid in $pids; do
    if cwd_matches "$pid"; then
        echo "  - PID=$pid（本目录实例）"
    else
        echo "  - PID=$pid"
    fi
    kill -TERM "$pid" 2>/dev/null || true
done

# 等待全部退出（最多 5 秒）
for _ in $(seq 1 10); do
    alive=""
    for pid in $pids; do
        kill -0 "$pid" 2>/dev/null && alive="$alive $pid"
    done
    [[ -z "$alive" ]] && break
    sleep 0.5
done
for pid in $alive; do
    echo "[stop] PID=$pid 未退出，强制结束..."
    kill -KILL "$pid" 2>/dev/null || true
done

rm -f "$PID_FILE"
sleep 0.3

if port_in_use; then
    echo "[stop] 已停止上述 server.js，但端口 $PORT 仍被占用：" >&2
    for pid in $(port_pids); do
        echo "        剩余占用者 PID=$pid : $(ps -o args= -p "$pid" 2>/dev/null | head -1)" >&2
    done
    echo "        若占用者是 online-server.js（PM2/生产部署），请改用 pm2 stop jiatiaoqi-ws。" >&2
    exit 1
fi

echo "[stop] 已停止 ✅（端口 $PORT 已释放）"
