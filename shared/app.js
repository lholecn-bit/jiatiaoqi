// 夹挑棋 · 应用工厂（静态文件 + REST /api + WebSocket 房间，共用同一 HTTP 服务）
// server.js 通过 createApp() 启动；测试可在进程内创建临时实例。

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const logic = require('./logic');
const { attachHeartbeat } = require('./heartbeat');

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

// ---------- WS 生命周期日志（云上排障用）----------
// 开启方式：WS_LOG_FILE=/path/to/ws.log node server.js
// 输出 JSONL：{ t, e, ... }；未指定文件时打到 stdout。
function makeWsLogger() {
    const file = process.env.WS_LOG_FILE;
    const verbose = process.env.WS_VERBOSE === '1';
    const stream = file ? fs.createWriteStream(file, { flags: 'a' }) : null;
    let seq = 0;
    return {
        log(e, data = {}) {
            const line = JSON.stringify({ t: new Date().toISOString(), e, seq: ++seq, ...data });
            if (stream) stream.write(line + '\n');
            else if (verbose) console.log('[ws]', line);
        },
        close() { if (stream) stream.end(); },
    };
}

function isSensitivePath(p) {
    if (/^\/api(?:\/|$)/.test(p)) return false;
    if (p === '/' || p === '/index.html') return false;
    // 隐藏文件/目录
    if (/\/(\.[^/]+)/.test(p) || /^\.[^/]*$/.test(p.split('/').pop() || '')) return true;
    const lower = p.toLowerCase();
    for (const pre of ['/shared/', '/tests/', '/node_modules/', '/minigame/', '/archive/',
        '/patent/', '/docs/', '/.git/', '/build/']) {
        if (lower.startsWith(pre)) return true;
    }
    const base = (p.split('/').pop() || '').toLowerCase();
    if (/\/?(jiatiaoqi\.db|\.db(-wal|-shm)?|\.db$)/.test(base)) return true;
    if (/\.sh$|\.key$|private\.config|\.env(\.|$)|package-lock\.json/.test(base)) return true;
    if (['server.js', 'online-server.js', 'electron-main.js', 'deploy.sh', 'release.sh',
        'update.sh', 'start-server.sh', 'stop-server.sh', 'restart-server.sh'].includes(base)) return true;
    return false;
}

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

function createApp({ store, staticDir, heartbeatMs = 30000, roomKeepMs = 300000, roomIdleMs = 1800000, sweepMs = 30000, loginMaxFails = 8, loginLockMs = 900000, pruneMs = 21600000, adminUsernames = [], spectatorDelayMs = 3000 }) {
    if (!store) throw new Error('store 必填');
    logic.buildLines(); // 初始化棋盘拓扑索引（幂等）
    const rooms = new Map();
    const wsLog = makeWsLogger();
    const server = http.createServer((req, res) => {
        const u = new URL(req.url || '/', 'http://x');
        const pathname = decodeURIComponent(u.pathname);

        // ---------- /api ----------
        if (pathname.startsWith('/api/') || pathname === '/api') {
            return handleApi(req, res, pathname);
        }

        // ---------- 静态文件 ----------
        if (isSensitivePath(pathname)) {
            res.writeHead(404); res.end('Not Found'); return;
        }
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
    // 登录/注册暴力破解限流（按 IP+用户名，配置可调）
    const loginFails = new Map();
    function authKey(req, user) {
        const ip = (req.socket && req.socket.remoteAddress) || '';
        return (ip + '|' + String(user || '').toLowerCase());
    }
    function noteAuthFail(key) {
        const e = loginFails.get(key) || { count: 0, until: 0 };
        e.count += 1;
        if (e.count >= loginMaxFails) { e.until = Date.now() + loginLockMs; e.count = 0; }
        loginFails.set(key, e);
    }
    function authLocked(key) {
        const e = loginFails.get(key);
        return e && e.until > Date.now() ? e.until : 0;
    }
    function clearAuthFails(key) { loginFails.delete(key); }

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
            const q = new URL(req.url || '/', 'http://x');
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
                if (!r.ok) {
                    // 非游客身份注册属请求非法(400)；用户名冲突才 409
                    const code = r.message.indexOf('游客') >= 0 ? 400 : 409;
                    return json(res, code, { message: r.message });
                }
                return json(res, 200, { ok: true });
            }
            if (req.method === 'POST' && pathname === '/api/login') {
                const b = await readBody(req);
                const username = String(b.username || '').trim();
                const key = authKey(req, username);
                const lockedUntil = authLocked(key);
                if (lockedUntil) {
                    res.setHeader('Retry-After', Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)));
                    return json(res, 429, { message: '尝试过于频繁，请稍后再试' });
                }
                const r = store.login(username, String(b.password || ''));
                if (!r.ok) {
                    noteAuthFail(key);
                    return json(res, 401, { message: r.message });
                }
                clearAuthFails(key);
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
                return json(res, 200, { player: { ...me, admin: isAdmin(me) } });
            }
            if (req.method === 'PATCH' && pathname === '/api/profile') {
                if (me.kind !== 'account') {
                    return json(res, 403, { message: '请先注册账号（游客资料不持久化）' });
                }
                const b = await readBody(req);
                const player = store.updateProfile(me.id, { nick: b.nick, avatar: b.avatar });
                return json(res, 200, { player });
            }
            if (req.method === 'GET' && pathname === '/api/games') {
                // 权限：仅返回与当前身份相关的对局（游客也只能看自己的）
                const limit = Math.min(Number(q.searchParams.get('limit')) || 50, 200);
                return json(res, 200, { games: store.listGamesByPlayer(me.id, limit) });
            }
            const m = pathname.match(/^\/api\/games\/(\d+)$/);
            if (req.method === 'GET' && m) {
                const game = store.getGame(Number(m[1]));
                if (!game) return json(res, 404, { message: '对局不存在' });
                if (game.black_player !== me.id && game.white_player !== me.id) {
                    return json(res, 403, { message: '无权查看该对局' });
                }
                return json(res, 200, { game, moves: store.getMoves(game.id) });
            }
            if (req.method === 'GET' && pathname === '/api/rooms') {
                return json(res, 200, { rooms: roomsListForApi(false) });
            }
            if (req.method === 'GET' && pathname === '/api/leaderboard') {
                const limit = Math.min(Number(q.searchParams.get('limit')) || 20, 100);
                return json(res, 200, { leaderboard: store.leaderboard(limit) });
            }
            if (req.method === 'GET' && pathname === '/api/admin/rooms') {
                if (!isAdmin(me)) return json(res, 403, { message: '需要管理员权限' });
                return json(res, 200, { rooms: roomsListForApi(true) });
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
    function seatClients(room) { return [...room.clients].filter((c) => c.meta && c.meta.color != null); }
    function spectatorClients(room) { return [...room.clients].filter((c) => c.meta && c.meta.spectator); }
    function isAdmin(player) {
        return !!(player && (player.is_admin === 1 || adminUsernames.includes(String(player.username || ''))));
    }
    function roomNameFor(playerId) {
        const p = playerId ? store.getPlayer(playerId) : null;
        if (!p) return '游客';
        return p.nick || p.username || '游客';
    }
    function roomsListForApi(adminView) {
        const out = [];
        for (const room of rooms.values()) {
            const seats = seatClients(room);
            const specs = spectatorClients(room);
            if (seats.length === 0) continue; // 空置房间不展示（保留期内的由加入者按房号直连）
            const playing = !!(room.gameId != null && !room.gameOver && seats.length === 2);
            out.push({
                roomId: room.roomId,
                state: playing ? 'playing' : 'waiting',
                players: seats.map((c) => ({ color: c.meta.color, name: roomNameFor(c.meta.playerId) })),
                seats: seats.length,
                spectators: specs.length,
                moves: room.moveSeq,
                updatedAt: room.lastActive,
                ...(adminView ? { playerIds: seats.map((c) => c.meta.playerId) } : {}),
            });
        }
        return out;
    }
    // 对局事件广播：玩家座位即时，观战者按 spectatorDelayMs 延迟（防通风报信）
    function broadcastGameEvent(room, ex, payload) {
        seatClients(room).forEach((c) => { if (c !== ex) send(c, payload); });
        const specs = spectatorClients(room);
        if (specs.length === 0) return;
        const deliver = () => {
            if (rooms.get(room.roomId) !== room) return;
            specs.forEach((c) => send(c, payload));
        };
        if (!spectatorDelayMs) { deliver(); return; }
        const t = setTimeout(deliver, spectatorDelayMs);
        if (typeof t.unref === 'function') t.unref();
    }

    // 直接清理房间（通知类清理场景用：取消保留期定时器、补终局记录、删除）
    function cleanupRoom(room, reason) {
        cancelRoomExpiry(room);
        if (room.expireTimer) { clearTimeout(room.expireTimer); room.expireTimer = null; }
        finalizeRoomGame(room, 'abandoned', reason);
        rooms.delete(room.roomId);
    }
    // 房间保留期：无人连接时不立即删除，短暂断线可在期内重连恢复棋局
    function scheduleRoomExpiry(room) {
        if (room.expireTimer) clearTimeout(room.expireTimer);
        const timer = setTimeout(() => {
            room.expireTimer = null;
            const cur = rooms.get(room.roomId);
            if (!cur || cur !== room || cur.clients.size > 0) return;
            finalizeRoomGame(cur, 'abandoned', 'leave');
            rooms.delete(cur.roomId);
            wsLog.log('room-expired', { room: cur.roomId });
        }, roomKeepMs);
        if (typeof timer.unref === 'function') timer.unref(); // 不阻塞进程/测试退出
        room.expireTimer = timer;
    }
    function cancelRoomExpiry(room) {
        if (room.expireTimer) { clearTimeout(room.expireTimer); room.expireTimer = null; }
    }
    function chooseColor(room) {
        const used = new Set();
        for (const c of room.clients) if (c.meta && c.meta.color != null) used.add(c.meta.color);
        return used.has(BLACK) ? (used.has(WHITE) ? null : WHITE) : BLACK;
    }
    function ensureGame(room) {
        if (room.gameId != null) return;
        if (seatClients(room).length < 2) return;
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

        const before = board.map((col) => col.slice());
        const curBefore = room.currentPlayer;
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
            room.moveLog.push({ color: player, before, curBefore, move: { fx, fy, tx, ty } });
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
        ws._logId = ++connSeq;
        wsLog.log('conn', { id: ws._logId, remote: (ws._socket && ws._socket.remoteAddress) || '' });
        send(ws, { type: 'hello', message: 'connected' });

        ws.on('message', (data) => {
            let p;
            try { p = JSON.parse(data.toString()); } catch (e) { return; }

            // 应用层心跳：客户端探测连接存活，原样回 pong
            if (p.type === 'ping') {
                send(ws, { type: 'pong' });
                return;
            }

            if (p.type === 'join') {
                const roomId = String(p.roomId || '').trim();
                const token = String(p.token || '');
                const player = token ? store.playerByToken(token) : null;
                const spectate = p.spectate === true || p.type === 'watch';
                if (!roomId) return send(ws, { type: 'error', message: '房间号不能为空' });
                if (!player) return send(ws, { type: 'error', message: '身份无效，请刷新页面重试' });
                let room = rooms.get(roomId);
                if (!room) {
                    room = { roomId, clients: new Set(), board: logic.initialBoard(), currentPlayer: BLACK, gameOver: false, gameId: null, moveSeq: 0, finalized: false, expireTimer: null, lastActive: Date.now(), moveLog: [] };
                    rooms.set(roomId, room);
                }
                let color = null;
                if (!spectate) {
                    if (seatClients(room).length >= 2) return send(ws, { type: 'error', message: '房间已满，可切换到观战' });
                    color = chooseColor(room);
                    if (color == null) return send(ws, { type: 'error', message: '无法分配颜色' });
                }
                cancelRoomExpiry(room);
                room.lastActive = Date.now();
                room.clients.add(ws);
                ws.meta = spectate
                    ? { roomId, color: null, playerId: player.id, spectator: true }
                    : { roomId, color, playerId: player.id };
                wsLog.log(spectate ? 'spectate' : 'join', {
                    id: ws._logId, room: roomId, color, player: player.id,
                    seats: seatClients(room).length, spectators: spectatorClients(room).length,
                });
                const players = seatClients(room).length;
                const spectators = spectatorClients(room).length;
                send(ws, {
                    type: 'joined', roomId, color, players, spectators,
                    spectator: !!spectate,
                    board: room.board, currentPlayer: room.currentPlayer, nick: player.nick, avatar: player.avatar,
                });
                broadcast(room, { type: 'room-update', roomId, players, spectators });
                if (!spectate) ensureGame(room);
                return;
            }
            if (!ws.meta || !ws.meta.roomId) return;
            const room = rooms.get(ws.meta.roomId);
            if (!room) return;
            if (ws.meta.spectator) {
                return send(ws, { type: 'error', message: '观战者不能操作' });
            }

            if (p.type === 'move') {
                if (room.gameOver) return send(ws, { type: 'error', message: '对局已结束' });
                if (ws.meta.color !== room.currentPlayer) return send(ws, { type: 'error', message: '尚未轮到你' });
                const r = applyMove(room, p.move || {}, ws.meta.color, ws);
                if (!r.ok) return send(ws, { type: 'error', message: r.message });
                room.lastActive = Date.now();
                wsLog.log('move', { id: ws._logId, room: room.roomId, color: ws.meta.color, move: p.move });
                broadcastGameEvent(room, ws, { type: 'move', roomId: room.roomId, move: p.move, currentPlayer: room.currentPlayer, gameOver: room.gameOver });
            }
            if (p.type === 'undo') {
                if (room.gameOver) return send(ws, { type: 'error', message: '对局已结束，无法悔棋' });
                if (room.finalized) return send(ws, { type: 'error', message: '当前不可悔棋' });
                const my = ws.meta.color;
                const last = room.moveLog[room.moveLog.length - 1];
                if (!last || last.color !== my) {
                    return send(ws, { type: 'error', message: '只能撤回自己刚走的最后一步' });
                }
                if (room.currentPlayer === my) {
                    return send(ws, { type: 'error', message: '对方已行棋，不能再撤回自己的上一步' });
                }
                // 服务端权威撤销：回到该步之前的状态
                room.board = last.before.map((col) => col.slice());
                room.currentPlayer = last.curBefore;
                room.moveLog.pop();
                if (room.gameId != null) store.deleteLastMove(room.gameId);
                room.lastActive = Date.now();
                broadcastGameEvent(room, null, {
                    type: 'undo', color: my, board: room.board, currentPlayer: room.currentPlayer,
                });
                return;
            }
            if (p.type === 'restart') {
                finalizeRoomGame(room, 'abandoned', 'restart');
                room.board = logic.initialBoard();
                room.currentPlayer = BLACK;
                room.gameOver = false;
                room.gameId = null;
                room.moveSeq = 0;
                room.finalized = false;
                room.moveLog = [];
                ensureGame(room);
                room.lastActive = Date.now();
                broadcastGameEvent(room, ws, { type: 'restart', roomId: room.roomId, board: room.board, currentPlayer: room.currentPlayer });
            }
            if (p.type === 'surrender') {
                finalizeRoomGame(room, p.winnerPiece === BLACK ? 'black' : (p.winnerPiece === WHITE ? 'white' : 'black'), 'surrender');
                room.gameOver = true;
                room.lastActive = Date.now();
                broadcastGameEvent(room, ws, { type: 'surrender', roomId: room.roomId, winnerPiece: p.winnerPiece, message: p.message || '一方认输' });
            }
        });

        ws.on('error', (err) => {
            wsLog.log('error', { id: ws._logId, message: err.message || String(err) });
        });

        ws.on('close', () => {
            wsLog.log('close', { id: ws._logId, room: ws.meta && ws.meta.roomId, color: ws.meta && ws.meta.color });
            if (!ws.meta || !ws.meta.roomId) return;
            const room = rooms.get(ws.meta.roomId);
            if (!room) return;
            room.clients.delete(ws);
            if (room.clients.size === 0) {
                // 房间暂时无人：进入保留期，期内重连可恢复原棋局
                scheduleRoomExpiry(room);
                return;
            }
            // 仍有对手在场：不结束对局（不落 abandoned），等其重连继续
            broadcast(room, { type: 'peer-left', roomId: room.roomId });
            broadcast(room, { type: 'room-update', roomId: room.roomId, players: seatClients(room).length, spectators: spectatorClients(room).length });
        });
    });

    // 协议级心跳：默认 30s 保活 + 清理半开连接（可 0 关闭 / HEARTBEAT_INTERVAL 覆盖）
    const heartbeatTimer = heartbeatMs > 0 ? attachHeartbeat(wss, heartbeatMs, {
        onTerminate: (ws) => wsLog.log('hb-terminate', { id: ws._logId, room: ws.meta && ws.meta.roomId }),
    }) : null;

    // 空闲房间清理：非对局中的房间（等人/只剩一方/已终局）超过 ROOM_IDLE_MS
    // 无活动则通知并清理，避免“有人一直挂着”造成房间/内存泄漏
    let idleSweepTimer = null;
    if (roomIdleMs > 0) {
        idleSweepTimer = setInterval(() => {
            const now = Date.now();
            for (const room of rooms.values()) {
                if (room.clients.size === 0) continue; // 由保留期逻辑处理
                const inProgress = room.gameId != null && !room.gameOver && seatClients(room).length >= 2;
                if (inProgress) continue; // 对弈中的房间不清理（允许长考）
                const idle = now - (room.lastActive || now);
                if (idle <= roomIdleMs) continue;
                wsLog.log('room-idle-expire', { room: room.roomId, seats: seatClients(room).length, spectators: spectatorClients(room).length });
                try {
                    room.clients.forEach((c) => send(c, { type: 'room-expired', message: '房间长时间无对局活动，已自动关闭' }));
                } catch (e) {}
                cleanupRoom(room, 'idle');
                room.clients.forEach((c) => { try { c.close(4001, 'idle'); } catch (e) {} });
            }
        }, sweepMs);
        if (typeof idleSweepTimer.unref === 'function') idleSweepTimer.unref();
    }

    // 定期清理过期会话与孤儿游客（默认 6 小时一次，pruneMs=0 关闭）
    let pruneTimer = null;
    if (pruneMs > 0 && typeof store.pruneStale === 'function') {
        pruneTimer = setInterval(() => {
            try {
                const r = store.pruneStale({ sessionDays: 30, guestDays: 30 });
                if ((r.sessions || 0) + (r.guests || 0) > 0) wsLog.log('prune', r);
            } catch (e) {
                wsLog.log('prune-error', { message: e.message || String(e) });
            }
        }, pruneMs);
        if (typeof pruneTimer.unref === 'function') pruneTimer.unref();
    }

    return {
        server, wss, rooms, heartbeatTimer, idleSweepTimer, pruneTimer, wsLog,
        close() {
            wsLog.close();
        },
    };
}

let connSeq = 0;

module.exports = { createApp };
