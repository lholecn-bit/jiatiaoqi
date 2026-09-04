#!/usr/bin/env bash
# 夹挑棋 · 一键跑全部自动化测试
#   npm test 或 bash tests/run-tests.sh
# 前置：本地 server 已启动（默认 http://127.0.0.1:8080，可用 ./start-server.sh）
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo '[1/4] 规则逻辑单测（node:test + shared/logic.js）'
node --test tests/logic.test.js

echo
echo '[2/4] M2a API / 数据层 / 对局存档单测（进程内临时 SQLite）'
node --test tests/api.test.cjs

echo
echo '[3/4] 在线断连复现与心跳保活模拟（进程内 + 空闲超时代理）'
node --test tests/heartbeat-sim.cjs

echo
echo '[4/4] 界面端到端（headless Chrome + CDP，含断线自动重连）'
node tests/ui-e2e.cjs

echo
echo '✅ 全部自动化测试通过'
