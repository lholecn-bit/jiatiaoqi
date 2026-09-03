// 夹挑棋 · 应用工厂（静态文件 + REST /api + WebSocket 房间，共用同一 HTTP 服务）
// server.js 通过 createApp() 启动；测试可在进程内创建临时实例。

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const logic = require('./logic');

const { EMPTY, BLACK, WHITE, GRID } = logic;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.db': 'application/octet-stream',
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
        req.on('end', () => {
            try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

function createApp({ store, staticDir }) {
    if (!store) throw new Error('store 必填');
    logic.buildLines(); // 初始化棋盘拓扑索引（幂等）
    const rooms = new Map();
    const server = http.createServer((req, res) => {
        const u = new URL(req.url || '/', 'http://x');
        const pathname = decodeURIComponent(u.pathname);

        // ---------- /api ----------
        if (pathname.startsWith('/api/') || pathname === '/api') {
            return handleApi(req, res, pathname);
        }

        // ---------- 静态文件 ----------
        let filePath = pathname === '/' ? '/index.html' : pathname;
        filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(staticDir, filePath);
        if (!fullPath.startsWith(path.resolve(staticDir))) {
            res.writeHead(403); res.end('Forbidden'); return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        fs.readFile(fullPath, (err, data) => {
            if (err) { res.writeHead(404); res.end('404 Not Found'); }
            else { res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }); res.end(data); }
        });
    });

    // ---------- REST API ----------
    function json(res, code, data) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
    }
    function bearer(req) {
        const h = req.headers.authorization || '';
        return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    }
    async function handleApi(req, res, pathname) {
        try {
            if (req.method === 'POST' && (pathname === '/api/guest')) {
                const r = store.guestToken();
                return json(res, 200, { token: r.token, player: r.player });
            }
            if (req.method === 'POST' && pathname === '/api/register') {
                const b = await readBody(req);
                const name = String(b.username || '').trim();
                const pass = String(b.password || '');
                if (name.length < 2 || name.length > 20) return json(res, 400, { message: '用户名需 2~20 个字符' });
                if (pass.length < 6 || pass.length > 64) return json(res, 400, { message: '密码需 6~64 个字符' });
                if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(name)) return json(res, 400, { message: '用户名只能含中英文、数字、下划线' });
                const r = store.registerGuest(String(b.guestToken || ''), name, pass);
                if (!r.ok) return json(res, 409, { message: r.message });
                return json(res, 200, { ok: true });
            }
            if (req.method === 'POST' && pathname === '/api/login') {
                const b = await readBody(req);
                const r = store.login(String(b.username || '').trim(), String(b.password || ''));
                if (!r.ok) return json(res, 401, { message: r.message });
                return json(res, 200, { token: r.token, player: r.player });
            }
            if (req.method === 'POST' && pathname === '/api/logout') {
                const b = await readBody(req);
                const t = bearer(req) || String(b.token || '');
                if (t) store.deleteSession(t);
                return json(res, 200, { ok: true });
            }
            // 以下需要登录/游客会话
            const token = bearer(req);
            const me = token ? store.playerByToken(token) : null;
            if (!me) return json(res, 401, { message: '请先创建或登录身份' });

            if (req.method === 'GET' && pathname === '/api/me') {
                return json(res, 200, { player: me });
            }
            if (req.method === 'PATCH' && pathname === '/api/profile') {
                const b = await readBody(req);
                const player = store.updateProfile(me.id, { nick: b.nick, avatar: b.avatar });
                return json(res, 200, { player });
            }
            if (req.method === 'GET' && pathname === '/api/games') {
                const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200);
                return json(res, 200, { games: store.listGames(limit) });
            }
            const m = pathname.match(/^\/api\/games\/(\d+)$/);
            if (req.method === 'GET' && m) {
                const game = store.getGame(Number(m[1]));
                if (!game) return json(res, 404, { message: '对局不存在' });
                return json(res, 200, { game, moves: store.getMoves(game.id) });
            }
            return json(res, 404, { message: '接口不存在' });
        } catch (err) {
            json(res, 400, { message: err.message || '请求错误' });
        }
    }

    // ---------- WebSocket 房间（含对局记录）----------
    const wss = new WebSocket.Server({ server });

    function send(ws, payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }
    function broadcast(room, payload) { for (const c of room.clients) send(c, payload); }
    function broadcastExcept(room, ex, payload) { for (const c of room.clients) if (c !== ex) send(c, payload); }

    function chooseColor(room) {
        const used = new Set();
        for (const c of room.clients) if (c.meta && c.meta.color != null) used.add(c.meta.color);
        return used.has(BLACK) ? (used.has(WHITE) ? null : WHITE) : BLACK;
    }
    function ensureGame(room) {
        if (room.gameId != null) return;
        if (room.clients.size < 2) return;
        let black = null, white = null;
        for (const c of room.clients) {
            if (!c.meta || !c.meta.playerId) continue;
            if (c.meta.color === BLACK) black = c.meta.playerId;
            if (c.meta.color === WHITE) white = c.meta.playerId;
        }
        room.gameId = store.createGame({ room: room.roomId, black, white });
        room.moveSeq = 0;
        room.finalized = false;
    }
    function finalizeRoomGame(room, result, reason) {
        if (room.gameId != null && !room.finalized) {
            store.finishGame(room.gameId, { result, reason });
            room.finalized = true;
        }
    }
    function applyMove(room, move, player, ws) {
        const { fx, fy, tx, ty } = move;
        const board = room.board;
        if (![fx, fy, tx, ty].every(Number.isInteger) || fx < 0 || fx >= GRID || fy < 0 || fy >= GRID || tx < 0 || tx >= GRID || ty < 0 || ty >= GRID) {
            return { ok: false, message: '坐标非法' };
        }
        if (board[fx][fy] !== player) return { ok: false, message: '非法棋子' };
        if (board[tx][ty] !== EMPTY) return { ok: false, message: '目标位置非空' };
        const legals = logic.getValidMoves(board, fx, fy);
        if (!legals.some(([x, y]) => x === tx && y === ty)) return { ok: false, message: '移动路径非法' };

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

        // 记录走子（若有对局）
        if (room.gameId != null && !room.finalized) {
            room.moveSeq += 1;
            store.appendMove(room.gameId, { seq: room.moveSeq, color: player, fx, fy, tx, ty });
        }

        const c = logic.countPieces(board);
        let reason = null;
        if (c.bc === 0) { room.gameOver = true; reason = { result: 'white', why: 'pieces' }; }
        else if (c.wc === 0) { room.gameOver = true; reason = { result: 'black', why: 'pieces' }; }
        else if (!logic.hasAnyMove(board, 3 - player)) {
            room.gameOver = true;
            reason = { result: player === BLACK ? 'white' : 'black', why: 'nomove' };
        } else {
            room.currentPlayer = 3 - player;
        }
        if (reason) finalizeRoomGame(room, reason.result, reason.why);
        return { ok: true, gameOver: room.gameOver, currentPlayer: room.currentPlayer, reason };
    }

    wss.on('connection', (ws) => {
        ws.meta = null;
        send(ws, { type: 'hello', message: 'connected' });

        ws.on('message', (data) => {
            let p;
            try { p = JSON.parse(data.toString()); } catch (e) { return; }

            if (p.type === 'join') {
                const roomId = String(p.roomId || '').trim();
                const token = String(p.token || '');
                const player = token ? store.playerByToken(token) : null;
                if (!roomId) return send(ws, { type: 'error', message: '房间号不能为空' });
                if (!player) return send(ws, { type: 'error', message: '身份无效，请刷新页面重试' });
                let room = rooms.get(roomId);
                if (!room) {
                    room = { roomId, clients: new Set(), board: logic.initialBoard(), currentPlayer: BLACK, gameOver: false, gameId: null, moveSeq: 0, finalized: false };
                    rooms.set(roomId, room);
                }
                if (room.clients.size >= 2) return send(ws, { type: 'error', message: '房间已满' });
                const color = chooseColor(room);
                if (color == null) return send(ws, { type: 'error', message: '无法分配颜色' });
                room.clients.add(ws);
                ws.meta = { roomId, color, playerId: player.id };
                send(ws, {
                    type: 'joined', roomId, color, players: room.clients.size,
                    board: room.board, currentPlayer: room.currentPlayer, nick: player.nick, avatar: player.avatar,
                });
                broadcast(room, { type: 'room-update', roomId, players: room.clients.size });
                ensureGame(room);
                return;
            }
            if (!ws.meta || !ws.meta.roomId) return;
            const room = rooms.get(ws.meta.roomId);
            if (!room) return;

            if (p.type === 'move') {
                if (room.gameOver) return send(ws, { type: 'error', message: '对局已结束' });
                if (ws.meta.color !== room.currentPlayer) return send(ws, { type: 'error', message: '尚未轮到你' });
                const r = applyMove(room, p.move || {}, ws.meta.color, ws);
                if (!r.ok) return send(ws, { type: 'error', message: r.message });
                broadcastExcept(room, ws, { type: 'move', roomId: room.roomId, move: p.move, currentPlayer: room.currentPlayer, gameOver: room.gameOver });
            }
            if (p.type === 'restart') {
                finalizeRoomGame(room, 'abandoned', 'restart');
                room.board = logic.initialBoard();
                room.currentPlayer = BLACK;
                room.gameOver = false;
                room.gameId = null;
                room.moveSeq = 0;
                room.finalized = false;
                ensureGame(room);
                broadcastExcept(room, ws, { type: 'restart', roomId: room.roomId, board: room.board, currentPlayer: room.currentPlayer });
            }
            if (p.type === 'surrender') {
                finalizeRoomGame(room, p.winnerPiece === BLACK ? 'black' : (p.winnerPiece === WHITE ? 'white' : 'black'), 'surrender');
                room.gameOver = true;
                broadcastExcept(room, ws, { type: 'surrender', roomId: room.roomId, winnerPiece: p.winnerPiece, message: p.message || '一方认输' });
            }
        });

        ws.on('close', () => {
            if (!ws.meta || !ws.meta.roomId) return;
            const room = rooms.get(ws.meta.roomId);
            if (!room) return;
            finalizeRoomGame(room, 'abandoned', 'leave');
            room.clients.delete(ws);
            if (room.clients.size === 0) { rooms.delete(room.roomId); return; }
            broadcast(room, { type: 'peer-left', roomId: room.roomId });
            broadcast(room, { type: 'room-update', roomId: room.roomId, players: room.clients.size });
        });
    });

    return { server, wss, rooms };
}

module.exports = { createApp };
