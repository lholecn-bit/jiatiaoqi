// 夹挑棋 · 对局历史权限：只能看与自己相关的对局（游客亦然）
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-auth-'));
    const store = openDb(path.join(dir, 't.db'));
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..'), heartbeatMs: 0, roomKeepMs: 60000, roomIdleMs: 0 });
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
function connect(token) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(ctx.base.replace('http://', 'ws://') + '/ws');
        const inbox = [], wait = [];
        ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = wait.shift(); if (w) w(m); else inbox.push(m); });
        ws.once('open', () => resolve({
            ws, send: (o) => ws.send(JSON.stringify(o)),
            next() { if (inbox.length) return Promise.resolve(inbox.shift()); return new Promise((r) => wait.push(r)); },
            nextOf(type) { return this.next().then((m) => (m && m.type === type ? m : this.nextOf(type))); },
        }));
        ws.once('error', reject);
    });
}

test('对局历史仅对参赛双方可见（游客 C 看不到 A/B 的对局）', async () => {
    const tA = await guest(), tB = await guest();
    const a = await connect(tA), b = await connect(tB);
    a.send({ type: 'join', roomId: 'priv1', token: tA });
    await a.nextOf('joined');
    b.send({ type: 'join', roomId: 'priv1', token: tB });
    await b.nextOf('joined');
    a.send({ type: 'move', roomId: 'priv1', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');
    b.send({ type: 'surrender', roomId: 'priv1', winnerPiece: 1 });
    await a.nextOf('surrender');
    a.ws.close(); b.ws.close();
    await sleep(150);

    const listA = await api('/api/games', tA);
    assert.equal(listA.status, 200);
    assert.ok((listA.data.games || []).some((g) => g.room === 'priv1'), 'A 能看到自己的对局');

    const listB = await api('/api/games', tB);
    assert.ok((listB.data.games || []).some((g) => g.room === 'priv1'), 'B（白方）也能看到');

    const tC = await guest();
    const listC = await api('/api/games', tC);
    assert.equal(listC.status, 200);
    assert.equal((listC.data.games || []).some((g) => g.room === 'priv1'), false, '无关游客看不到该对局');

    const gameId = listA.data.games.find((g) => g.room === 'priv1').id;
    assert.equal((await api('/api/games/' + gameId, tA)).status, 200, '参赛者可见详情');
    assert.equal((await api('/api/games/' + gameId, tC)).status, 403, '无关者访问详情被拒');
    assert.equal((await api('/api/games/' + gameId)).status, 401, '未登录被拒');
});
