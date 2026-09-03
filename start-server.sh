#!/usr/bin/env bash
# ============================================================
# 夹挑棋 · 启动脚本（Linux/macOS）
# 启动单端口合并服务 server.js（HTTP + WebSocket 共用一端口）。
#
# 用法：
#   ./start-server.sh                # 默认端口 8080
#   PORT=9000 ./start-server.sh      # 自定义端口
#
# 配套：
#   ./stop-server.sh                 # 停止（可清掉多个实例）
#   ./restart-server.sh              # 重启
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

# ---- 检测既有实例：优先本目录实例，其次 PID 文件，最后任意 server.js ----
find_existing() {
    local pid
    for pid in $(all_server_pids | sort -un); do
        cwd_matches "$pid" && { echo "$pid strict"; return 0; }
    done
    if [[ -f "$PID_FILE" ]]; then
        pid="$(tr -d ' \t\n\r' < "$PID_FILE")"
        if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && is_node_server "$pid"; then
            echo "$pid pidfile"
            return 0
        fi
    fi
    for pid in $(all_server_pids | sort -un); do
        is_node_server "$pid" && { echo "$pid loose"; return 0; }
    done
    return 1
}

read -r pid how <<<"$(find_existing || echo '')"
if [[ -n "$pid" ]]; then
    case "$how" in
        strict|pidfile)
            echo "[start] 服务已在运行（PID=$pid，端口 $PORT），无需重复启动。"
            ;;
        loose)
            echo "[start] 检测到已运行的 server.js（PID=$pid），无需重复启动。" >&2
            echo "        如需重启，请执行 ./restart-server.sh。" >&2
            ;;
    esac
    exit 0
fi

if port_in_use; then
    echo "[start] 端口 $PORT 已被其它程序占用：" >&2
    for pid in $(port_pids); do
        echo "        PID=$pid : $(ps -o args= -p "$pid" 2>/dev/null | head -1)" >&2
    done
    echo "        请先释放端口，或改用自定义端口：PORT=xxxx ./start-server.sh" >&2
    exit 1
fi

echo "[start] 启动 server.js（端口 $PORT）..."
cd "$APP_DIR"
nohup node server.js > server.log 2>&1 &
pid=$!
echo "$pid" > "$PID_FILE"

for _ in $(seq 1 25); do
    port_in_use && break
    sleep 0.2
done

if ! port_in_use; then
    echo "[start] 启动失败，请查看 server.log" >&2
    exit 1
fi

lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "[start] 启动成功 ✅  PID=$pid"
echo "  本机访问:   http://127.0.0.1:$PORT"
[[ -n "$lan_ip" ]] && echo "  局域网访问: http://$lan_ip:$PORT"
echo "  在线对战:   页面内自动连接 ws://同址/ws（无需手动填地址）"
echo "  日志:        tail -f server.log"
echo "  停止:        ./stop-server.sh"
