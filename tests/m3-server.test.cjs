// 夹挑棋 M3 · 观战/目录/管理员/Elo 服务端测试
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { openDb } = require('../shared/db');
const { createApp } = require('../shared/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ctx;
test.before(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-m3-'));
    const store = openDb(path.join(dir, 't.db'));
    const app = createApp({
        store, staticDir: path.resolve(__dirname, '..'), heartbeatMs: 0,
        roomKeepMs: 60000, roomIdleMs: 0,
        spectatorDelayMs: 500,        // 观战延迟（便于测试）
        adminUsernames: ['boss'],
    });
    await new Promise((r) => app.server.listen(0, r));
    const port = app.server.address().port;
    ctx = { dir, store, app, base: `http://127.0.0.1:${port}` };
});
test.after(() => {
    try { ctx.app.wss.close(); } catch (e) {}
    try { ctx.app.server.close(); } catch (e) {}
    try { ctx.store.close(); } catch (e) {}
    try { fs.rmSync(ctx.dir, { recursive: true, force: true }); } catch (e) {}
});

async function guest() {
    const r = await fetch(ctx.base + '/api/guest', { method: 'POST' });
    return (await r.json()).token;
}
async function api(pathname, token, method = 'GET', body) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(ctx.base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function registerAs(token, username) {
    const r = await api('/api/register', null, 'POST', { guestToken: token, username, password: 'secret123' });
    assert.equal(r.status, 200, '注册 ' + username);
}
function connect(token, spectate) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(ctx.base.replace('http://', 'ws://') + '/ws');
        const inbox = [], wait = [];
        ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = wait.shift(); if (w) w(m); else inbox.push(m); });
        ws.once('open', () => resolve({
            ws, send: (o) => ws.send(JSON.stringify(o)),
            next() { if (inbox.length) return Promise.resolve(inbox.shift()); return new Promise((r) => wait.push(r)); },
            nextOf(type, ms = 3000) {
                const t0 = Date.now();
                const loop = () => this.next().then((m) => {
                    if (m && m.type === type) return m;
                    if (Date.now() - t0 > ms) throw new Error('timeout waiting ' + type);
                    return loop();
                });
                return loop();
            },
            join(room) { this.send({ type: 'join', roomId: room, token, ...(spectate ? { spectate: true } : {}) }); },
        }));
        ws.once('error', reject);
    });
}

test('观战：可中途进入、只能看不能操作、走子延迟 N 毫秒后送达', async () => {
    const tA = await guest(), tB = await guest(), tC = await guest();
    const a = await connect(tA), b = await connect(tB), c = await connect(tC, true);
    a.join('sp1'); await a.nextOf('joined');
    b.join('sp1'); await b.nextOf('joined');
    a.send({ type: 'move', roomId: 'sp1', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move'); // 玩家即时收到

    c.join('sp1');
    const jc = await c.nextOf('joined');
    assert.equal(jc.spectator, true);
    assert.equal(jc.color, null);

    // 观战者不能操作
    c.send({ type: 'move', roomId: 'sp1', move: { fx: 4, fy: 4, tx: 4, ty: 2 } });
    const errC = await c.nextOf('error');
    assert.ok(errC.message.includes('观战'), errC.message);

    // 第二步：玩家即时收到，观战者延迟（≥delay）后才收到
    const t0 = Date.now();
    b.send({ type: 'move', roomId: 'sp1', move: { fx: 4, fy: 4, tx: 4, ty: 2 } });
    await a.nextOf('move'); // 玩家先收到
    const late = await c.nextOf('move', 4000);
    const latency = Date.now() - t0;
    assert.ok(late.type === 'move', '观战者收到走子');
    assert.ok(latency >= 380, '观战延迟应不小于配置(500)的近似值, 实际 ' + latency + 'ms');
    a.ws.close(); b.ws.close(); c.ws.close();
    await sleep(250);
});

test('房间目录：进行中的房间可被他人看到', async () => {
    const tA = await guest(), tB = await guest();
    const a = await connect(tA), b = await connect(tB);
    a.join('sp2'); await a.nextOf('joined');
    b.join('sp2'); await b.nextOf('joined');
    a.send({ type: 'move', roomId: 'sp2', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');

    const viewer = await guest();
    const list = await api('/api/rooms', viewer);
    assert.equal(list.status, 200);
    const room = (list.data.rooms || []).find((r) => r.roomId === 'sp2');
    assert.ok(room, '目录包含进行中房间');
    assert.equal(room.state, 'playing');
    assert.equal(room.seats, 2);
    a.ws.close(); b.ws.close();
});

test('管理员：admin 端点只有 ADMIN_USERNAMES 中的账号可访问', async () => {
    const tBoss = await guest(); await registerAs(tBoss, 'boss');
    const tUser = await guest(); await registerAs(tUser, 'normal');
    const boss = await api('/api/admin/rooms', tBoss);
    assert.equal(boss.status, 200, '管理员可见房间列表');
    const me = await api('/api/me', tBoss);
    assert.equal(me.data.player.admin, true);
    const normal = await api('/api/admin/rooms', tUser);
    assert.equal(normal.status, 403, '普通账号被拒');
    const meU = await api('/api/me', tUser);
    assert.equal(meU.data.player.admin, false);
});

test('Elo：双方账号的有效对局结束后积分/战绩更新，排行榜可见', async () => {
    const tA = await guest(); await registerAs(tA, 'alice_elo');
    const tB = await guest(); await registerAs(tB, 'bob_elo');
    const a = await connect(tA), b = await connect(tB);
    a.join('sp3'); await a.nextOf('joined');
    b.join('sp3'); await b.nextOf('joined');
    a.send({ type: 'move', roomId: 'sp3', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');
    b.send({ type: 'surrender', roomId: 'sp3', winnerPiece: 1 }); // 黑胜
    await a.nextOf('surrender');
    await sleep(150);

    const meA = await api('/api/me', tA);
    assert.equal(meA.data.player.rating, 1216, '胜方 +16(?) -> 按 Elo K32 应 1216');
    const meB = await api('/api/me', tB);
    assert.equal(meB.data.player.rating, 1184, '负方应 1184');
    assert.equal(meA.data.player.wins, 1);
    assert.equal(meB.data.player.losses, 1);

    const lb = await api('/api/leaderboard', tA);
    assert.ok((lb.data.leaderboard || []).some((p) => p.username === 'alice_elo' && p.rating === 1216), '排行榜包含胜方');
    a.ws.close(); b.ws.close();
    await sleep(150);
});
