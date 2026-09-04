// 夹挑棋 M2a · API / 数据层 / 在线对局存档 测试（进程内起临时实例）
// 运行：node --test tests/api.test.cjs
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { openDb } = require('../shared/db');
const { createApp } = require('../shared/app');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-test-'));
}
function waitMs(ms) { return new Promise((r) => setTimeout(r, ms)); }
function connectWs(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const inbox = [];
        const waiters = [];
        ws.on('message', (d) => {
            const msg = JSON.parse(d.toString());
            const w = waiters.shift();
            if (w) w(msg); else inbox.push(msg);
        });
        ws.once('open', () => resolve({
            ws,
            next() {
                if (inbox.length) return Promise.resolve(inbox.shift());
                return new Promise((r) => waiters.push(r));
            },
            nextOf(type) {
                return this.next().then((m) => (m && m.type === type ? m : this.nextOf(type)));
            },
            send(o) { ws.send(JSON.stringify(o)); },
        }));
        ws.once('error', reject);
    });
}

let ctx;

test.before(async () => {
    const dir = tmpDir();
    const dbFile = path.join(dir, 'test.db');
    const store = openDb(dbFile);
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..') });
    await new Promise((r) => app.server.listen(0, r));
    const { port } = app.server.address();
    ctx = { dir, dbFile, store, app, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
});

test.after(() => {
    if (ctx) {
        ctx.app.wss.close();
        ctx.app.server.close();
        ctx.store.close();
        fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
});

async function api(pathname, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(ctx.base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

test('游客创建 + 需要会话的接口鉴权', async () => {
    const g = await api('/api/guest', { method: 'POST' });
    assert.equal(g.status, 200);
    assert.ok(g.data.token && g.data.player && g.data.player.kind === 'guest');

    const noAuth = await api('/api/me');
    assert.equal(noAuth.status, 401);
    const me = await api('/api/me', { token: g.data.token });
    assert.equal(me.status, 200);
});

test('游客注册升级账号 + 登录 + 错误密码', async () => {
    const g = await api('/api/guest', { method: 'POST' });
    const bad = await api('/api/register', { method: 'POST', body: { guestToken: g.data.token, username: 'x', password: '123' } });
    assert.equal(bad.status, 400);

    const reg = await api('/api/register', { method: 'POST', body: { guestToken: g.data.token, username: 'alice_m2', password: 'secret123' } });
    assert.equal(reg.status, 200);
    assert.equal(reg.data.ok, true);

    // 同一 token 已升级为账号：再注册属非法请求
    const notGuest = await api('/api/register', { method: 'POST', body: { guestToken: g.data.token, username: 'alice_m2b', password: 'secret123' } });
    assert.equal(notGuest.status, 400);
    // 新游客抢注已存在的用户名 → 409
    const g2 = await api('/api/guest', { method: 'POST' });
    const dup = await api('/api/register', { method: 'POST', body: { guestToken: g2.data.token, username: 'alice_m2', password: 'secret123' } });
    assert.equal(dup.status, 409);

    const login = await api('/api/login', { method: 'POST', body: { username: 'alice_m2', password: 'secret123' } });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);
    assert.equal(login.data.player.kind, 'account');
    assert.equal(login.data.player.username, 'alice_m2');

    const wrong = await api('/api/login', { method: 'POST', body: { username: 'alice_m2', password: 'wrongpw' } });
    assert.equal(wrong.status, 401);
});

test('资料仅账号可改：游客 403，注册账号后云端持久化', async () => {
    const g = await api('/api/guest', { method: 'POST' });
    const guestPatch = await api('/api/profile', { method: 'PATCH', token: g.data.token, body: { nick: 'x', avatar: 1 } });
    assert.equal(guestPatch.status, 403, '游客不能改云端资料');
    await api('/api/register', { method: 'POST', body: { guestToken: g.data.token, username: 'prof_user', password: 'secret123' } });
    const pf = await api('/api/profile', { method: 'PATCH', token: g.data.token, body: { nick: '小云', avatar: 7 } });
    assert.equal(pf.status, 200);
    assert.equal(pf.data.player.nick, '小云');
    assert.equal(pf.data.player.avatar, 7);
    const me = await api('/api/me', { token: g.data.token });
    assert.equal(me.data.player.nick, '小云');
});

test('在线对局自动存档（games+moves），认输结束并可由 API 查询', async () => {
    const g1 = await api('/api/guest', { method: 'POST' });
    const g2 = await api('/api/guest', { method: 'POST' });
    const a = await connectWs(ctx.wsUrl + '/ws');
    const b = await connectWs(ctx.wsUrl + '/ws');
    a.send({ type: 'join', roomId: 'm2room', token: g1.data.token });
    const ja = await a.nextOf('joined');
    assert.equal(ja.color, 1); // 黑先
    b.send({ type: 'join', roomId: 'm2room', token: g2.data.token });
    const jb = await b.nextOf('joined');
    assert.equal(jb.color, 2);

    // 黑走 (0,0)->(0,2)
    a.send({ type: 'move', roomId: 'm2room', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    const gotMove = await b.nextOf('move');
    assert.equal(gotMove.type, 'move');

    // 白认输
    b.send({ type: 'surrender', roomId: 'm2room', winnerPiece: 1 });
    await waitMs(150);

    const games = ctx.store.listGames(10);
    const game = games.find((x) => x.room === 'm2room');
    assert.ok(game, '应记录对局');
    assert.equal(game.result, 'black');
    assert.equal(game.reason, 'surrender');
    assert.ok(game.move_count >= 1);

    const detail = await api('/api/games/' + game.id, { token: g1.data.token });
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.data.moves));
    assert.equal(detail.data.moves.length, game.move_count);
    assert.deepEqual(
        { fx: detail.data.moves[0].fx, fy: detail.data.moves[0].fy, tx: detail.data.moves[0].tx, ty: detail.data.moves[0].ty },
        { fx: 0, fy: 0, tx: 0, ty: 2 }
    );

    a.ws.close(); b.ws.close();
});
