// 夹挑棋 · 数据层（SQLite / better-sqlite3）
// 表：players / sessions / games / moves
// 供 server.js（单端口全功能服务）使用；生产与本地同构，DB 为单文件。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SCRYPT_N = 16384; // 默认参数（scryptSync 参数上限由系统决定，适中即可）

function hashPassword(password, salt) {
    const h = crypto.scryptSync(String(password), salt, 64);
    return h.toString('hex');
}

function verifyPassword(password, salt, expectedHex) {
    const actual = Buffer.from(hashPassword(password, salt), 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function randomToken() {
    return crypto.randomBytes(24).toString('hex');
}

// 简单迁移：为 players 补充段位/战绩/管理员列（老库平滑升级）
function migratePlayers(db) {
    const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
    const add = (name, ddl) => {
        if (!cols.includes(name)) db.exec('ALTER TABLE players ADD COLUMN ' + ddl);
    };
    add('rating', 'rating INTEGER NOT NULL DEFAULT 1200');
    add('games_played', 'games_played INTEGER NOT NULL DEFAULT 0');
    add('wins', 'wins INTEGER NOT NULL DEFAULT 0');
    add('losses', 'losses INTEGER NOT NULL DEFAULT 0');
    add('draws', 'draws INTEGER NOT NULL DEFAULT 0');
    add('is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
}

// Elo：K=32，最低 100 分
function eloNew(rating, opponent, score) {
    const expected = 1 / (1 + Math.pow(10, (opponent - rating) / 400));
    return Math.max(100, Math.round(rating + 32 * (score - expected)));
}

function openDb(filePath) {
    if (filePath !== ':memory:') {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    const db = new Database(filePath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT NOT NULL,                -- guest | account
            username    TEXT UNIQUE,
            pass_salt   TEXT,
            pass_hash   TEXT,
            nick        TEXT NOT NULL DEFAULT '',
            avatar      INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            player_id   INTEGER NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS games (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            room         TEXT,
            black_player INTEGER,
            white_player INTEGER,
            result       TEXT,      -- black | white | draw | abandoned
            reason       TEXT,      -- pieces | nomove | surrender | leave | restart
            started_at   TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at     TEXT,
            move_count   INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS moves (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id    INTEGER NOT NULL,
            seq        INTEGER NOT NULL,
            color      INTEGER NOT NULL,   -- 1 黑 / 2 白
            fx INTEGER, fy INTEGER, tx INTEGER, ty INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
        CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id, seq);
    `);
    migratePlayers(db);

    const store = {
        _db: db,
        close() { db.close(); },

        // ---------- 游客 / 会话 ----------
        guestToken() {
            const token = randomToken();
            const info = db.prepare(
                'INSERT INTO players (kind, nick, avatar) VALUES (?, ?, ?)'
            ).run('guest', '', 0);
            db.prepare('INSERT INTO sessions (token, player_id) VALUES (?, ?)').run(token, info.lastInsertRowid);
            return { token, player: this.playerByToken(token) };
        },
        playerByToken(token) {
            return db.prepare(
                `SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?`
            ).get(token) || null;
        },
        deleteSession(token) {
            db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        },

        // ---------- 账号 ----------
        registerGuest(guestToken, username, password) {
            const guest = this.playerByToken(guestToken);
            if (!guest) return { ok: false, message: '游客会话无效' };
            // 仅游客身份可升级为账号；已登录账号不允许用自己的 token 覆盖账号
            if (guest.kind !== 'guest') {
                return { ok: false, message: '仅游客身份可以注册' };
            }
            const exists = db.prepare('SELECT id FROM players WHERE username = ?').get(username);
            if (exists) return { ok: false, message: '该用户名已被注册' };
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = hashPassword(password, salt);
            db.prepare(
                `UPDATE players SET kind='account', username=?, pass_salt=?, pass_hash=?, updated_at=datetime('now') WHERE id=?`
            ).run(username, salt, hash, guest.id);
            return { ok: true };
        },
        login(username, password) {
            const p = db.prepare('SELECT * FROM players WHERE username = ? AND kind = ?').get(username, 'account');
            if (!p || !verifyPassword(password, p.pass_salt, p.pass_hash)) {
                return { ok: false, message: '用户名或密码不正确' };
            }
            const token = randomToken();
            db.prepare('INSERT INTO sessions (token, player_id) VALUES (?, ?)').run(token, p.id);
            return { ok: true, token, player: p };
        },

        // ---------- 资料 ----------
        updateProfile(playerId, { nick, avatar }) {
            db.prepare(
                `UPDATE players SET nick=?, avatar=?, updated_at=datetime('now') WHERE id=?`
            ).run(nick == null ? '' : String(nick).slice(0, 14), avatar == null ? 0 : Math.max(0, Math.min(Number(avatar) || 0, 11)), playerId);
            return db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
        },

        // ---------- 对局 ----------
        createGame({ room, black, white }) {
            const info = db.prepare(
                'INSERT INTO games (room, black_player, white_player) VALUES (?, ?, ?)'
            ).run(room || null, black || null, white || null);
            return Number(info.lastInsertRowid);
        },
        appendMove(gameId, { seq, color, fx, fy, tx, ty }) {
            db.prepare(
                `INSERT INTO moves (game_id, seq, color, fx, fy, tx, ty) VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(gameId, seq, color, fx, fy, tx, ty);
            db.prepare('UPDATE games SET move_count = move_count + 1 WHERE id = ?').run(gameId);
        },
        // 在线悔棋：删除最后一步（与房间内存中的撤销一致）
        deleteLastMove(gameId) {
            const row = db.prepare('SELECT seq FROM moves WHERE game_id = ? ORDER BY seq DESC LIMIT 1').get(gameId);
            if (!row) return false;
            db.prepare('DELETE FROM moves WHERE game_id = ? AND seq = ?').run(gameId, row.seq);
            db.prepare('UPDATE games SET move_count = CASE WHEN move_count > 0 THEN move_count - 1 ELSE 0 END WHERE id = ?').run(gameId);
            return true;
        },
        finishGame(gameId, { result, reason }) {
            db.prepare(
                `UPDATE games SET result=?, reason=?, ended_at=datetime('now') WHERE id=?`
            ).run(result, reason, gameId);
            // Elo 结算（仅双方皆为账号的有效对局）
            if (result === 'black' || result === 'white') this.applyElo(gameId, result);
        },
        applyElo(gameId, winner) {
            const g = this.getGame(gameId);
            if (!g || !g.black_player || !g.white_player) return;
            const b = db.prepare('SELECT * FROM players WHERE id = ?').get(g.black_player);
            const w = db.prepare('SELECT * FROM players WHERE id = ?').get(g.white_player);
            if (!b || !w || b.kind !== 'account' || w.kind !== 'account') return; // 游客不参与段位
            const bWon = winner === 'black';
            const nb = eloNew(b.rating, w.rating, bWon ? 1 : 0);
            const nw = eloNew(w.rating, b.rating, bWon ? 0 : 1);
            const up = db.prepare(
                `UPDATE players SET rating=?, games_played=games_played+1,
                 wins=wins+?, losses=losses+?, updated_at=datetime('now') WHERE id=?`
            );
            db.transaction(() => {
                up.run(nb, bWon ? 1 : 0, bWon ? 0 : 1, b.id);
                up.run(nw, bWon ? 0 : 1, bWon ? 1 : 0, w.id);
            })();
        },
        getPlayer(id) {
            return db.prepare('SELECT * FROM players WHERE id = ?').get(id) || null;
        },
        leaderboard(limit = 20) {
            return db.prepare(
                `SELECT id, username, nick, rating, games_played, wins, losses, draws
                 FROM players WHERE kind='account' AND games_played > 0
                 ORDER BY rating DESC, wins DESC LIMIT ?`
            ).all(limit);
        },
        listGames(limit = 50) {
            return db.prepare(
                `SELECT g.*, COALESCE(NULLIF(bp.nick, ''), bp.username) AS black_name,
                        COALESCE(NULLIF(wp.nick, ''), wp.username) AS white_name,
                        bp.avatar AS black_avatar, wp.avatar AS white_avatar
                 FROM games g
                 LEFT JOIN players bp ON bp.id = g.black_player
                 LEFT JOIN players wp ON wp.id = g.white_player
                 ORDER BY g.started_at DESC, g.id DESC LIMIT ?`
            ).all(limit);
        },
        // 权限：只返回与某玩家相关（执黑或执白）的对局
        listGamesByPlayer(playerId, limit = 50) {
            return db.prepare(
                `SELECT g.*, COALESCE(NULLIF(bp.nick, ''), bp.username) AS black_name,
                        COALESCE(NULLIF(wp.nick, ''), wp.username) AS white_name,
                        bp.avatar AS black_avatar, wp.avatar AS white_avatar
                 FROM games g
                 LEFT JOIN players bp ON bp.id = g.black_player
                 LEFT JOIN players wp ON wp.id = g.white_player
                 WHERE g.black_player = ? OR g.white_player = ?
                 ORDER BY g.started_at DESC, g.id DESC LIMIT ?`
            ).all(playerId, playerId, limit);
        },
        getGame(id) {
            return db.prepare('SELECT * FROM games WHERE id = ?').get(id) || null;
        },
        getMoves(gameId) {
            return db.prepare('SELECT seq, color, fx, fy, tx, ty FROM moves WHERE game_id = ? ORDER BY seq').all(gameId);
        },
        // 过期清理：超期会话、以及无对局关联且超期的孤儿游客
        pruneStale({ sessionDays = 30, guestDays = 30 } = {}) {
            const now = Date.now();
            const cutSession = new Date(now - sessionDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
            const cutGuest = new Date(now - guestDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
            const sessions = db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutSession).changes;
            const guests = db.prepare(
                `DELETE FROM players
                 WHERE kind='guest' AND created_at < ?
                   AND id NOT IN (SELECT black_player FROM games WHERE black_player IS NOT NULL)
                   AND id NOT IN (SELECT white_player FROM games WHERE white_player IS NOT NULL)
                   AND id NOT IN (SELECT player_id FROM sessions)`
            ).run(cutGuest).changes;
            return { sessions, guests };
        },
    };
    return store;
}

module.exports = { openDb, hashPassword, verifyPassword, randomToken };
