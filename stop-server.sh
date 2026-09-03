#!/usr/bin/env bash
# ============================================================
# 夹挑棋 · 停止脚本（Linux/macOS）
# 通过「本目录 + server.js 命令行 + 端口占用」自动定位进程，
# 不依赖写死的 PID（PID 每次启动都会变化）。
#
# 匹配策略（由严到宽）：
#   1) 本目录启动的 node server.js（cwd 与脚本目录一致）
#   2) PID 文件记录且确为 server.js
#   3) 兜底：命令行锚定为 node server.js（含仅占用目标端口的）
#
# 用法：
#   ./stop-server.sh            # 默认端口 8080
#   PORT=9000 ./stop-server.sh  # 与启动时一致的自定义端口
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"
PID_FILE="$APP_DIR/.server.pid"

# ---- 命令行是否为 server.js ----
has_server_js() {
    local pid="$1"
    ps -o args= -p "$pid" 2>/dev/null | grep -q 'server\.js'
}

# ---- cwd 是否为本项目目录（读不到时视为未知，不强制） ----
cwd_matches() {
    local pid="$1"
    local cwd
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || return 1
    [[ "$cwd" == "$APP_DIR" ]]
}

# ---- 候选进程：命令行锚定的 server.js + 占用目标端口的进程 ----
candidates() {
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -f '^node server\.js$' 2>/dev/null || true
    fi
    if command -v lsof >/dev/null 2>&1; then
        local pid
        for pid in $(lsof -ti "tcp:$PORT" 2>/dev/null || true); do
            has_server_js "$pid" && echo "$pid"
        done
    fi
}

# ---- 查找正在运行的实例，输出 pid 与匹配层级 ----
find_running() {
    local pid
    # 1) 精确：cwd 为本目录的 server.js
    for pid in $(candidates | sort -u); do
        cwd_matches "$pid" && { echo "$pid strict"; return 0; }
    done
    # 2) PID 文件（需仍存活且确为 server.js）
    if [[ -f "$PID_FILE" ]]; then
        pid="$(tr -d ' \t\n\r' < "$PID_FILE")"
        if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && has_server_js "$pid"; then
            echo "$pid pidfile"
            return 0
        fi
    fi
    # 3) 兜底：仅命令行匹配（可能非本目录实例，仅提示）
    for pid in $(candidates | sort -u); do
        has_server_js "$pid" && { echo "$pid loose"; return 0; }
    done
    return 1
}

# ---- 端口是否被占用 ----
port_in_use() {
    if command -v ss >/dev/null 2>&1; then
        ss -tln 2>/dev/null | grep -q ":$PORT "
    elif command -v lsof >/dev/null 2>&1; then
        lsof -i "tcp:$PORT" -sTCP:LISTEN >/dev/null 2>&1
    else
        return 1
    fi
}

read -r pid how <<<"$(find_running || echo '')"
if [[ -z "$pid" ]]; then
    rm -f "$PID_FILE"
    echo "[stop] 未发现运行中的 server.js，无需停止。"
    exit 0
fi

case "$how" in
    strict)  echo "[stop] 定位到本目录实例：PID=$pid" ;;
    pidfile) echo "[stop] 按 PID 文件定位：PID=$pid" ;;
    loose)   echo "[stop] 按命令行定位（非本目录启动的实例）：PID=$pid" ;;
esac

kill -TERM "$pid" 2>/dev/null || true
for _ in $(seq 1 10); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.3
done
if kill -0 "$pid" 2>/dev/null; then
    echo "[stop] 进程未在 3 秒内退出，强制结束..."
    kill -KILL "$pid" 2>/dev/null || true
fi
rm -f "$PID_FILE"

sleep 0.3
if port_in_use; then
    echo "[stop] 进程已结束，但端口 $PORT 仍被占用（可能被其它程序接手）。" >&2
else
    echo "[stop] 已停止 ✅（端口 $PORT 已释放）"
fi
