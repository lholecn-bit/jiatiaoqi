// 夹挑棋 · 断线重连后的棋局恢复（服务端房间保留期）
// 场景：一方短暂断线重连后，应恢复原棋盘与身份，而不是初始局面。
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-rs-'));
    const store = openDb(path.join(dir, 't.db'));
    // roomKeepMs 很小：快速验证“保留期内可恢复 / 过期后重建”
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..'), heartbeatMs: 0, roomKeepMs: 400 });
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
            next() {
                if (inbox.length) return Promise.resolve(inbox.shift());
                return new Promise((r) => wait.push(r));
            },
            nextOf(type) { return this.next().then((m) => (m && m.type === type ? m : this.nextOf(type))); },
            close: () => { try { ws.close(); } catch (e) {} },
        }));
        ws.once('error', reject);
    });
}

test('重连恢复：对手在场时，断线方重连回到原棋盘与身份，对局不中断', async () => {
    const tA = await guest(), tB = await guest();
    const a = await connect(tA), b = await connect(tB);
    a.send({ type: 'join', roomId: 'rs1', token: tA });
    const ja = await a.nextOf('joined');
    assert.equal(ja.color, 1, 'A 执黑');
    b.send({ type: 'join', roomId: 'rs1', token: tB });
    await b.nextOf('joined');
    // 黑走一步 (0,0)->(0,2)
    a.send({ type: 'move', roomId: 'rs1', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');

    // A 断线，B 仍在场；短暂等待后 A 用同一身份重连
    a.close();
    await sleep(150);
    const a2 = await connect(tA);
    a2.send({ type: 'join', roomId: 'rs1', token: tA });
    const joined = await a2.nextOf('joined');
    assert.equal(joined.color, 1, '重连后仍执黑');
    assert.equal(joined.board[0][2], 1, '棋盘应保留黑子落点 (0,2)');
    assert.equal(joined.board[0][0], 0, '(0,0) 应已空');
    assert.equal(joined.players, 2, '双方重聚');
    await sleep(60);

    // 对局不应被标记为已结束（仍在进行中）
    const games = ctx.store.listGames(50);
    const g = games.find((x) => x.room === 'rs1');
    assert.ok(g, '对局有记录');
    assert.equal(g.result, null, '对局未结束（不应因离开被标 abandoned）');
    a2.close(); b.close();
    await sleep(600); // 让保留期结束后清理
});

test('保留期过期：双方离开超过保留期，房间重建为初始局面', async () => {
    const tA = await guest(), tB = await guest();
    const a = await connect(tA), b = await connect(tB);
    a.send({ type: 'join', roomId: 'rs2', token: tA });
    await a.nextOf('joined');
    b.send({ type: 'join', roomId: 'rs2', token: tB });
    await b.nextOf('joined');
    a.send({ type: 'move', roomId: 'rs2', move: { fx: 0, fy: 0, tx: 0, ty: 2 } });
    await b.nextOf('move');

    a.close(); b.close();
    await sleep(900); // 超过 roomKeepMs(400)

    // 新玩家重新加入同一房间 → 应是初始局面（旧局已清理）
    const tc = await guest();
    const c = await connect(tc);
    c.send({ type: 'join', roomId: 'rs2', token: tc });
    const joined = await c.nextOf('joined');
    assert.equal(joined.board[0][2], 0, '过期后重建，无残留落子');
    assert.equal(joined.board[0][0], 1, '初始黑子复位');
    c.close();
});
