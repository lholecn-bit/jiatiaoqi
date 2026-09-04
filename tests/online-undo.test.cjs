// 夹挑棋 · 在线悔棋（服务端权威：只能撤回自己刚走的最后一步，对手行棋前）
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-undo-'));
    const store = openDb(path.join(dir, 't.db'));
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..'), heartbeatMs: 0, roomKeepMs: 60000, roomIdleMs: 0 });
    await new Promise((r) => app.server.listen(0, r));
    const port = app.server.address().port;
    ctx = { dir, store, app, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}` };
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
function connect(token) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(ctx.wsUrl + '/ws');
        const inbox = [], wait = [];
        ws.on('message', (d) => {
            const m = JSON.parse(d.toString());
            const w = wait.shift();
            if (w) w(m); else inbox.push(m);
        });
        ws.once('open', () => resolve({
            ws, send: (o) => ws.send(JSON.stringify(o)),
            next() { if (inbox.length) return Promise.resolve(inbox.shift()); return new Promise((r) => wait.push(r)); },
            nextOf(type) { return this.next().then((m) => (m && m.type === type ? m : this.nextOf(type))); },
        }));
        ws.once('error', reject);
    });
}

test('在线悔棋：撤回自己刚走的一步（棋盘/轮次/落库全部回滚，双方同步）', async () => {
    const tA = await guest(), tB = await guest();
    const a = await connect(tA), b = await connect(tB);
    a.send({ type: 'join', roomId: 'uo1', token: tA });
    await a.nextOf('joined');
    b.send({ type: 'join', roomId: 'uo1', token: tB });
    await b.nextOf('joined');

    a.send({ type: 'move', roomId: 'uo1', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');
    const gameBefore = ctx.store.listGames(50).find((g) => g.room === 'uo1');
    assert.equal(gameBefore.move_count, 1);

    // 黑方悔棋：双方都收到 undo（服务端权威盘面）
    a.send({ type: 'undo', roomId: 'uo1' });
    const ua = await a.nextOf('undo');
    const ub = await b.nextOf('undo');
    assert.equal(ua.board[0][2], 0, '黑方视角落点已回滚');
    assert.equal(ub.board[0][2], 0, '白方视角同步回滚');
    assert.equal(ua.currentPlayer, 1, '回到黑方行棋');

    const gameAfter = ctx.store.listGames(50).find((g) => g.room === 'uo1');
    assert.equal(gameAfter.move_count, 0, '落库步数同步回滚');
    assert.equal(ctx.store.getMoves(gameAfter.id).length, 0);

    // 白方此时无可悔的"自己刚走的一步" → 报错
    b.send({ type: 'undo', roomId: 'uo1' });
    const errB = await b.nextOf('error');
    assert.ok(errB.message.includes('只能撤回自己刚走的最后一步'), errB.message);
    a.ws.close(); b.ws.close();
});

test('在线悔棋：对手已行棋后不可再撤回自己的上一步', async () => {
    const tA = await guest(), tB = await guest();
    const a = await connect(tA), b = await connect(tB);
    a.send({ type: 'join', roomId: 'uo2', token: tA });
    await a.nextOf('joined');
    b.send({ type: 'join', roomId: 'uo2', token: tB });
    await b.nextOf('joined');

    a.send({ type: 'move', roomId: 'uo2', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');
    b.send({ type: 'move', roomId: 'uo2', move: { fx: 4, fy: 4, tx: 4, ty: 2 } });
    await a.nextOf('move');

    // 现在轮到黑方，但最后一步是白方走的 → 黑方不能悔
    a.send({ type: 'undo', roomId: 'uo2' });
    const errA = await a.nextOf('error');
    assert.ok(errA.message.includes('只能撤回自己刚走的最后一步'), errA.message);
    a.ws.close(); b.ws.close();
});
