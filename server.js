// 夹挑棋 · 合并服务（HTTP 静态文件 + WebSocket 对战，共用同一端口）
// 启动：node server.js
// 单端口部署，适配 Tailscale Funnel / Cloudflare Tunnel / ngrok 等单端口隧道方案

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const logic = require('./shared/logic');
const { attachHeartbeat } = require('./shared/heartbeat');

const { EMPTY, BLACK, WHITE, GRID } = logic;
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

logic.buildLines();

// ========== 静态文件 MIME ==========
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

// ========== 房间管理（同 online-server.js）==========
const rooms = new Map();

function createRoom(roomId) {
    return {
        roomId,
        clients: new Set(),
        board: logic.initialBoard(),
        currentPlayer: BLACK,
        gameOver: false,
    };
}

function broadcast(room, payload) {
    for (const client of room.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    }
}

function broadcastExcept(room, excludedWs, payload) {
    for (const client of room.clients) {
        if (client === excludedWs) continue;
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    }
}

function applyMove(room, move, player) {
    const { fx, fy, tx, ty } = move;
    const board = room.board;

    if (
        !Number.isInteger(fx) || !Number.isInteger(fy) ||
        !Number.isInteger(tx) || !Number.isInteger(ty) ||
        fx < 0 || fx >= GRID || fy < 0 || fy >= GRID ||
        tx < 0 || tx >= GRID || ty < 0 || ty >= GRID
    ) return { ok: false, message: '坐标非法' };

    if (board[fx][fy] !== player) return { ok: false, message: '非法棋子' };
    if (board[tx][ty] !== EMPTY) return { ok: false, message: '目标位置非空' };

    const legals = logic.getValidMoves(board, fx, fy);
    if (!legals.some(([x, y]) => x === tx && y === ty)) {
        return { ok: false, message: '移动路径非法' };
    }

    board[fx][fy] = EMPTY;
    board[tx][ty] = player;

    let queue = [[tx, ty]];
    while (queue.length > 0) {
        const next = [], seen = new Set();
        for (const [qx, qy] of queue) {
            for (const [cx, cy] of logic.findCapturesOnBoard(board, qx, qy, player)) {
                const k = cx + ',' + cy;
                if (board[cx][cy] !== player && !seen.has(k)) {
                    seen.add(k); board[cx][cy] = player; next.push([cx, cy]);
                }
            }
        }
        queue = next;
    }

    const c = logic.countPieces(board);
    if (c.bc === 0 || c.wc === 0) {
        room.gameOver = true;
    } else {
        room.currentPlayer = room.currentPlayer === BLACK ? WHITE : BLACK;
        if (!logic.hasAnyMove(board, room.currentPlayer)) room.gameOver = true;
    }
    return { ok: true };
}

function chooseColor(room) {
    const used = new Set();
    for (const c of room.clients) { if (c.meta && c.meta.color) used.add(c.meta.color); }
    return used.has(BLACK) ? (used.has(WHITE) ? null : WHITE) : BLACK;
}

function handleWsMessage(ws, raw) {
    let p;
    try { p = JSON.parse(raw); } catch { return; }

    if (p.type === 'join') {
        const roomId = String(p.roomId || '').trim();
        if (!roomId) return ws.send(JSON.stringify({ type: 'error', message: '房间号不能为空' }));
        let room = rooms.get(roomId);
        if (!room) { room = createRoom(roomId); rooms.set(roomId, room); }
        if (room.clients.size >= 2) return ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        const color = chooseColor(room);
        if (color == null) return ws.send(JSON.stringify({ type: 'error', message: '无法分配颜色' }));
        room.clients.add(ws);
        ws.meta = { roomId, color };
        ws.send(JSON.stringify({ type: 'joined', roomId, color, players: room.clients.size, board: room.board, currentPlayer: room.currentPlayer }));
        broadcast(room, { type: 'room-update', roomId, players: room.clients.size });
        return;
    }

    // 应用层心跳：客户端探测连接存活性，原样回 pong
    if (p.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
    }

    if (!ws.meta || !ws.meta.roomId) return;
    const room = rooms.get(ws.meta.roomId);
    if (!room) return;

    if (p.type === 'move') {
        if (room.gameOver) return ws.send(JSON.stringify({ type: 'error', message: '对局已结束' }));
        if (ws.meta.color !== room.currentPlayer) return ws.send(JSON.stringify({ type: 'error', message: '尚未轮到你' }));
        const r = applyMove(room, p.move || {}, ws.meta.color);
        if (!r.ok) return ws.send(JSON.stringify({ type: 'error', message: r.message }));
        broadcastExcept(room, ws, { type: 'move', roomId: room.roomId, move: p.move, currentPlayer: room.currentPlayer, gameOver: room.gameOver });
    }

    if (p.type === 'restart') {
        room.board = logic.initialBoard();
        room.currentPlayer = BLACK;
        room.gameOver = false;
        broadcastExcept(room, ws, { type: 'restart', roomId: room.roomId, board: room.board, currentPlayer: room.currentPlayer });
    }

    if (p.type === 'surrender') {
        room.gameOver = true;
        broadcastExcept(room, ws, { type: 'surrender', roomId: room.roomId, winnerPiece: p.winnerPiece, message: p.message || '一方认输' });
    }
}

function handleWsClose(ws) {
    if (!ws.meta || !ws.meta.roomId) return;
    const room = rooms.get(ws.meta.roomId);
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) { rooms.delete(room.roomId); return; }
    broadcast(room, { type: 'peer-left', roomId: room.roomId });
    broadcast(room, { type: 'room-update', roomId: room.roomId, players: room.clients.size });
}

// ========== HTTP 服务器 ==========
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    // 安全：禁止目录穿越
    filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(__dirname, filePath);

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        }
    });
});

// ========== WebSocket（挂在同一个 HTTP server 上）==========
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.meta = null;
    ws.send(JSON.stringify({ type: 'hello', message: 'connected' }));
    ws.on('message', (data) => handleWsMessage(ws, data.toString()));
    ws.on('close', () => handleWsClose(ws));
});

// ========== 启动 ==========
server.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`  Local: http://127.0.0.1:${PORT}`);
});

// 协议级心跳：清理半开连接（默认 30s，可用 HEARTBEAT_INTERVAL 覆盖）
attachHeartbeat(wss, Number(process.env.HEARTBEAT_INTERVAL) || 30000);
