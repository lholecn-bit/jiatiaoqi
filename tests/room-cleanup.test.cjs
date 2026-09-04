// 夹挑棋 · 空闲房间清理（防止"有人一直挂着"造成房间/内存泄漏）
// 等待/单方/已终局的房间超过 ROOM_IDLE_MS 无活动 → 服务端通知客户端
// (room-expired) 并清理房间；对弈中的房间不清理。
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

async function startApp(opts) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-idle-'));
    const store = openDb(path.join(dir, 't.db'));
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..'), ...opts });
    await new Promise((r) => app.server.listen(0, r));
    const port = app.server.address().port;
    return { dir, store, app, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
}
function stopApp(x) {
    try { clearInterval(x.app.idleSweepTimer); } catch (e) {}
    try { x.app.wss.close(); } catch (e) {}
    try { x.app.server.close(); } catch (e) {}
    try { x.store.close(); } catch (e) {}
    try { fs.rmSync(x.dir, { recursive: true, force: true }); } catch (e) {}
}

function connect(url, token) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url + '/ws');
        const inbox = [], wait = [];
        let closed = false;
        ws.on('message', (d) => {
            const m = JSON.parse(d.toString());
            const w = wait.shift();
            if (w) w(m); else inbox.push(m);
        });
        ws.on('close', () => { closed = true; });
        ws.once('open', () => resolve({
            ws, send: (o) => ws.send(JSON.stringify(o)),
            next() { if (inbox.length) return Promise.resolve(inbox.shift()); return new Promise((r) => wait.push(r)); },
            nextOf(type) { return this.next().then((m) => (m && m.type === type ? m : this.nextOf(type))); },
            isClosed: () => closed,
        }));
        ws.once('error', reject);
    });
}

test('等人房间超时 → 服务端发 room-expired 并清理房间', async () => {
    const A = await startApp({ heartbeatMs: 0, roomKeepMs: 60000, roomIdleMs: 300, sweepMs: 80 });
    const g = await (await fetch(A.base + '/api/guest', { method: 'POST' })).json();
    const c = await connect(A.wsUrl, g.token);
    c.send({ type: 'join', roomId: 'w1', token: g.token });
    await c.nextOf('joined');
    assert.ok(A.app.rooms.has('w1'));
    const msg = await c.nextOf('room-expired');
    assert.ok(msg.message && msg.message.length > 0);
    await sleep(400); // 让清理器删房、连接关闭
    assert.equal(A.app.rooms.has('w1'), false, '等待房应被清理');
    assert.ok(c.isClosed() || c.ws.readyState !== WebSocket.OPEN, '服务端应关闭该连接');
    c.ws.close();
    stopApp(A);
});

test('对弈中的房间不会被空闲清理', async () => {
    const A = await startApp({ heartbeatMs: 0, roomKeepMs: 60000, roomIdleMs: 300, sweepMs: 80 });
    const g1 = await (await fetch(A.base + '/api/guest', { method: 'POST' })).json();
    const g2 = await (await fetch(A.base + '/api/guest', { method: 'POST' })).json();
    const a = await connect(A.wsUrl, g1.token);
    const b = await connect(A.wsUrl, g2.token);
    a.send({ type: 'join', roomId: 'w2', token: g1.token });
    await a.nextOf('joined');
    b.send({ type: 'join', roomId: 'w2', token: g2.token });
    await b.nextOf('joined');
    a.send({ type: 'move', roomId: 'w2', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');
    await sleep(800); // 远超 idle 阈值，但双方在场且对局中
    assert.ok(A.app.rooms.has('w2'), '对弈中的房间不应被清理');
    // 收尾：关闭后清理
    a.ws.close(); b.ws.close();
    stopApp(A);
});
