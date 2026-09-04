#!/usr/bin/env bash
# 夹挑棋 · 一键跑全部自动化测试
#   npm test 或 bash tests/run-tests.sh
# 前置：可自动拉起本地 server（默认 http://127.0.0.1:8080）
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo '[1/10] 规则逻辑单测（node:test + shared/logic.js）'
node --test tests/logic.test.js

echo
echo '[2/10] M2a API / 数据层 / 对局存档单测（进程内临时 SQLite）'
node --test tests/api.test.cjs

echo
echo '[3/10] 在线断连复现与心跳保活模拟（进程内 + 空闲超时代理）'
node --test tests/heartbeat-sim.cjs

echo
echo '[4/10] 断线重连恢复棋局（房间保留期）'
node --test tests/reconnect-state.test.cjs

echo
echo '[5/10] 空闲房间清理（防挂着不退出泄漏）'
node --test tests/room-cleanup.test.cjs

echo
echo '[6/10] 在线悔棋（服务端权威，撤回自己刚走的一步）'
node --test tests/online-undo.test.cjs

echo
echo '[7/10] 对局历史权限（仅参赛双方可见）'
node --test tests/history-auth.test.cjs

echo
echo '[8/10] 鉴权与安全审计（敏感文件/注册/资料/限流）'
node --test tests/security-audit.test.cjs

echo
echo '[9/10] M3a 观战/目录/管理员/Elo 服务端'
node --test tests/m3-server.test.cjs

echo
echo '[10/10] 界面端到端（headless Chrome + CDP，含断线自动重连）'
node tests/ui-e2e.cjs

echo
echo '✅ 全部自动化测试通过'
