#!/usr/bin/env bash
# 兼容保护：本脚本使用 bash 特性，请用 bash 运行（勿用 sh 执行）
if [ -z "${BASH_VERSION:-}" ]; then
    echo "[error] 请用 bash 运行本脚本：bash $0（或直接执行 ./$(basename "$0")）" >&2
    exit 1
fi
# ============================================================
# 夹挑棋 · 服务器一键更新脚本（在代码仓库目录运行，配合 release.sh）
#
# 用法（服务器上）：
#   ./update.sh                              # 自动识别部署形态
#   UPDATE_MODE=server.js  ./update.sh       # 显式指定：server.js 单端口
#   UPDATE_MODE=pm2       ./update.sh        # PM2 管理 online-server.js（deploy.sh 架构）
#   UPDATE_MODE=nginx     ./update.sh        # Nginx 静态目录（需 UPDATE_TO）
#   UPDATE_TO=/srv/jiatiaoqi ./update.sh     # 服务目录与仓库不同（deploy 副本）
#   UPDATE_PULL=0 ./update.sh                # 跳过 git pull（已拉好时）
#
# 流程：git pull → 按形态同步/重载 → curl 校验页面版本号与仓库是否一致
# ============================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

BRANCH="${UPDATE_BRANCH:-main}"
MODE="${UPDATE_MODE:-auto}"
SERVED_DIR="${UPDATE_TO:-}"
PM2_NAME="${PM2_NAME:-jiatiaoqi-ws}"
PULL="${UPDATE_PULL:-1}"
CHECK_URL="${CHECK_URL:-}"        # 默认按形态自动推导

# ---- 辅助：版本提取 ----
repo_version() {
    grep -oP "APP_VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" index.html | head -1
}
page_version() {
    curl -s -m 5 "$1" 2>/dev/null | grep -oP "APP_VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" | head -1
}
is_node_server() { # pid —— 是否为 node server.js
    local args last
    args="$(ps -o args= -p "$1" 2>/dev/null)" || return 1
    [[ "$args" =~ node[[:space:]]+ ]] || return 1
    last="${args##* }"; last="${last##*/}"
    [[ "$last" == "server.js" ]]
}
pm2_has() { # PM2 进程是否存在（pm2 pid 找不到时输出 0）
    local p
    command -v pm2 >/dev/null 2>&1 || return 1
    p="$(pm2 pid "$PM2_NAME" 2>/dev/null || true)"
    [[ "$p" =~ ^[1-9][0-9]*$ ]]
}

if [[ ! -d .git ]]; then
    echo "[update] 当前目录不是 git 仓库（脚本需放在代码仓库目录）。" >&2
    exit 1
fi

echo "[update] 仓库：$REPO_DIR  分支：$BRANCH  形态：$MODE"

# ---- 1) 拉取最新代码 ----
if (( PULL )); then
    echo "[update] git pull ..."
    if ! git pull --ff-only origin "$BRANCH"; then
        echo "[update] git pull 失败（网络/认证？）。可先手动 git pull 后加 UPDATE_PULL=0 重跑。" >&2
        exit 1
    fi
    git log -1 --oneline
else
    echo "[update] 已跳过 git pull（UPDATE_PULL=0）"
fi

# ---- 2) 按形态让新代码生效 ----
resolve_mode() {
    # 优先级：显式 UPDATE_TO(nginx 副本) > PM2 > server.js > nginx root 指向本仓库
    if pm2_has; then
        echo pm2; return
    fi
    local pid
    for pid in $(pgrep -f 'server\.js' 2>/dev/null || true); do
        is_node_server "$pid" && { echo server.js; return; }
    done
    if command -v nginx >/dev/null 2>&1; then
        nginx -T 2>/dev/null | grep -q "root[[:space:]]\+$REPO_DIR" && { echo nginx; return; }
    fi
    echo unknown
}

if [[ "$MODE" == "auto" ]]; then
    if [[ -n "$SERVED_DIR" ]]; then
        MODE="nginx"
    else
        MODE="$(resolve_mode)"
    fi
    echo "[update] 自动识别形态：$MODE"
fi

case "$MODE" in
    server.js)
        echo "[update] 重启单端口服务 server.js ..."
        if [[ -x ./restart-server.sh ]]; then
            ./restart-server.sh
        else
            ./stop-server.sh || true
            ./start-server.sh
        fi
        [[ -z "$CHECK_URL" ]] && CHECK_URL="http://127.0.0.1:8080/"
        ;;
    pm2)
        if ! pm2_has; then
            echo "[update] 未找到 PM2 进程 $PM2_NAME，请检查进程名或改用 UPDATE_MODE。" >&2
            exit 1
        fi
        echo "[update] pm2 restart $PM2_NAME ..."
        pm2 restart "$PM2_NAME"
        [[ -z "$CHECK_URL" ]] && CHECK_URL="${CHECK_URL:-http://127.0.0.1/}"
        ;;
    nginx)
        if [[ -z "$SERVED_DIR" ]]; then
            echo "[update] nginx 形态需要指定 UPDATE_TO=<服务目录>，如 UPDATE_TO=/srv/jiatiaoqi ./update.sh" >&2
            exit 1
        fi
        echo "[update] 同步代码到服务目录 $SERVED_DIR ..."
        rsync -a --delete \
            --exclude ".git" --exclude "node_modules" --exclude "archive" \
            --exclude "docs" --exclude "patent" --exclude "minigame" \
            --exclude "preview.html" --exclude "electron-main.js" --exclude "build" \
            --exclude ".server.pid" --exclude "server.log" --exclude "*.sh" \
            "$REPO_DIR/" "$SERVED_DIR/"
        if command -v nginx >/dev/null 2>&1; then
            nginx -t && (systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true)
        fi
        [[ -z "$CHECK_URL" ]] && CHECK_URL="${CHECK_URL:-http://127.0.0.1/}"
        ;;
    unknown)
        echo "[update] 未能自动识别部署形态。请显式指定：" >&2
        echo "        UPDATE_MODE=server.js|pm2|nginx ./update.sh（nginx 另需 UPDATE_TO）" >&2
        exit 1
        ;;
    *)
        echo "[update] 未知 UPDATE_MODE=$MODE" >&2
        exit 1
        ;;
esac

# ---- 3) 校验线上版本 ----
want="$(repo_version)"
got=""
for _ in $(seq 1 10); do
    got="$(page_version "$CHECK_URL")"
    [[ -n "$got" ]] && break
    sleep 1
done

echo
echo "[update] 校验：仓库 APP_VERSION = $want"
echo "[update] 页面 ${CHECK_URL} APP_VERSION = ${got:-（未读到，检查服务是否已启动）}"

if [[ -n "$got" && "$got" == "$want" ]]; then
    echo "[update] ✅ 线上已是最新 v$want"
else
    echo "[update] ⚠️ 线上版本与仓库不一致：请检查服务目录/缓存/进程是否真正更新。" >&2
    exit 1
fi
