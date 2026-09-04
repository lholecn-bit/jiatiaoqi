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
            const salt = crypto.randomBytes(16).toString('hex');
            const hash = hashPassword(password, salt);
            const exists = db.prepare('SELECT id FROM players WHERE username = ?').get(username);
            if (exists) return { ok: false, message: '该用户名已被注册' };
            const guest = this.playerByToken(guestToken);
            if (!guest) return { ok: false, message: '游客会话无效' };
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
    };
    return store;
}

module.exports = { openDb, hashPassword, verifyPassword, randomToken };
