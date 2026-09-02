// 夹挑棋 · 在线对战服务端
// 规则逻辑统一引用 shared/logic.js（唯一权威源）。
// 服务端职责：房间管理、回合控制、走子合法性二次校验、状态广播。

const WebSocket = require('ws');
const logic = require('./shared/logic');

const { EMPTY, BLACK, WHITE, GRID } = logic;

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// 初始化棋盘拓扑索引
logic.buildLines();

const rooms = new Map();
const wss = new WebSocket.Server({ port: PORT });

function createRoom(roomId) {
    return {
        roomId,
        clients: new Set(),
        board: logic.initialBoard(),
        currentPlayer: BLACK,
        gameOver: false,
    };
}

// ========== 通信 ==========
function send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function broadcast(room, payload) {
    for (const client of room.clients) {
        send(client, payload);
    }
}

function broadcastExcept(room, excludedClient, payload) {
    for (const client of room.clients) {
        if (client === excludedClient) continue;
        send(client, payload);
    }
}

// ========== 走子 + 连锁（服务端 BFS 批量处理，无动画停顿）==========
function applyMove(room, move, player) {
    const { fx, fy, tx, ty } = move;
    const board = room.board;

    if (
        !Number.isInteger(fx) || !Number.isInteger(fy) ||
        !Number.isInteger(tx) || !Number.isInteger(ty) ||
        fx < 0 || fx >= GRID || fy < 0 || fy >= GRID ||
        tx < 0 || tx >= GRID || ty < 0 || ty >= GRID
    ) {
        return { ok: false, message: '坐标非法' };
    }

    if (board[fx][fy] !== player) {
        return { ok: false, message: '非法棋子' };
    }
    if (board[tx][ty] !== EMPTY) {
        return { ok: false, message: '目标位置非空' };
    }

    const legalTargets = logic.getValidMoves(board, fx, fy);
    if (!legalTargets.some(([x, y]) => x === tx && y === ty)) {
        return { ok: false, message: '移动路径非法' };
    }

    board[fx][fy] = EMPTY;
    board[tx][ty] = player;

    // 连锁吃子（BFS 批量，无逐步动画）
    let queue = [[tx, ty]];
    while (queue.length > 0) {
        const next = [];
        const seen = new Set();
        for (const [qx, qy] of queue) {
            const captures = logic.findCapturesOnBoard(board, qx, qy, player);
            for (const [cx, cy] of captures) {
                const key = `${cx},${cy}`;
                if (board[cx][cy] !== player && !seen.has(key)) {
                    seen.add(key);
                    board[cx][cy] = player;
                    next.push([cx, cy]);
                }
            }
        }
        queue = next;
    }

    const counts = logic.countPieces(board);
    if (counts.bc === 0 || counts.wc === 0) {
        room.gameOver = true;
    } else {
        room.currentPlayer = room.currentPlayer === BLACK ? WHITE : BLACK;
        if (!logic.hasAnyMove(board, room.currentPlayer)) {
            room.gameOver = true;
        }
    }

    return { ok: true };
}

// ========== 房间分配 ==========
function chooseColor(room) {
    const used = new Set();
    for (const client of room.clients) {
        if (client.meta && client.meta.color) used.add(client.meta.color);
    }
    if (!used.has(BLACK)) return BLACK;
    if (!used.has(WHITE)) return WHITE;
    return null;
}

// ========== 消息处理 ==========
function handleJoin(ws, roomIdRaw) {
    const roomId = String(roomIdRaw || '').trim();
    if (!roomId) {
        send(ws, { type: 'error', message: '房间号不能为空' });
        return;
    }

    let room = rooms.get(roomId);
    if (!room) {
        room = createRoom(roomId);
        rooms.set(roomId, room);
    }

    if (room.clients.size >= 2) {
        send(ws, { type: 'error', message: '房间已满（最多2人）' });
        return;
    }

    const color = chooseColor(room);
    if (color == null) {
        send(ws, { type: 'error', message: '无法分配棋子颜色' });
        return;
    }

    room.clients.add(ws);
    ws.meta = { roomId, color };

    send(ws, {
        type: 'joined',
        roomId,
        color,
        players: room.clients.size,
        board: room.board,
        currentPlayer: room.currentPlayer,
    });

    broadcast(room, { type: 'room-update', roomId, players: room.clients.size });
}

function handleMessage(ws, raw) {
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        send(ws, { type: 'error', message: '消息格式错误' });
        return;
    }

    if (payload.type === 'join') {
        handleJoin(ws, payload.roomId);
        return;
    }

    if (!ws.meta || !ws.meta.roomId) {
        send(ws, { type: 'error', message: '请先加入房间' });
        return;
    }

    const room = rooms.get(ws.meta.roomId);
    if (!room) {
        send(ws, { type: 'error', message: '房间不存在' });
        return;
    }

    if (payload.type === 'move') {
        if (room.gameOver) {
            send(ws, { type: 'error', message: '对局已结束，请重开' });
            return;
        }
        if (ws.meta.color !== room.currentPlayer) {
            send(ws, { type: 'error', message: '尚未轮到你走棋' });
            return;
        }
        const result = applyMove(room, payload.move || {}, ws.meta.color);
        if (!result.ok) {
            send(ws, { type: 'error', message: result.message });
            return;
        }

        broadcastExcept(room, ws, {
            type: 'move',
            roomId: room.roomId,
            move: payload.move,
            currentPlayer: room.currentPlayer,
            gameOver: room.gameOver,
        });
        return;
    }

    if (payload.type === 'restart') {
        room.board = logic.initialBoard();
        room.currentPlayer = BLACK;
        room.gameOver = false;
        broadcastExcept(room, ws, {
            type: 'restart',
            roomId: room.roomId,
            board: room.board,
            currentPlayer: room.currentPlayer,
        });
        return;
    }

    if (payload.type === 'surrender') {
        room.gameOver = true;
        broadcastExcept(room, ws, {
            type: 'surrender',
            roomId: room.roomId,
            winnerPiece: payload.winnerPiece,
            message: payload.message || '一方认输，对局结束',
        });
    }
}

function handleClose(ws) {
    if (!ws.meta || !ws.meta.roomId) return;
    const room = rooms.get(ws.meta.roomId);
    if (!room) return;

    room.clients.delete(ws);

    if (room.clients.size === 0) {
        rooms.delete(room.roomId);
        return;
    }

    broadcast(room, { type: 'peer-left', roomId: room.roomId });
    broadcast(room, { type: 'room-update', roomId: room.roomId, players: room.clients.size });
}

// ========== 启动 ==========
wss.on('connection', (ws) => {
    ws.meta = null;
    send(ws, { type: 'hello', message: 'connected' });

    ws.on('message', (data) => {
        handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
        handleClose(ws);
    });
});

console.log(`Online server is running on ws://0.0.0.0:${PORT}`);
