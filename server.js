// 夹挑棋 · 合并服务入口（单端口：HTTP 静态 + REST /api + WebSocket /ws）
// 启动：node server.js   （自定义端口：PORT=xxxx；数据库：DB_FILE=/path/to.db）
// 本服务为推荐部署形态：本地/局域网/生产（Nginx 反代 /api 与 /ws 到本端口均可）。

const path = require('path');
const { createApp } = require('./shared/app');
const { openDb } = require('./shared/db');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'jiatiaoqi.db');

const store = openDb(DB_FILE);
const app = createApp({
    store,
    staticDir: __dirname,
    heartbeatMs: process.env.HEARTBEAT_INTERVAL ? Number(process.env.HEARTBEAT_INTERVAL) : 30000,
    roomKeepMs: process.env.ROOM_KEEP_MS ? Number(process.env.ROOM_KEEP_MS) : 300000,
    roomIdleMs: process.env.ROOM_IDLE_MS ? Number(process.env.ROOM_IDLE_MS) : 1800000,
});

app.server.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`  Local: http://127.0.0.1:${PORT}`);
    console.log(`  Database: ${DB_FILE}`);
});
