// 夹挑棋 · 在线断连问题复现与心跳修复验证（进程内模拟）
// 复现：回合制对战空闲时无任何流量 → 网关/反代空闲超时掐断连接（与 Nginx
// proxy_read_timeout 同机理）。这里用一个"空闲即断"的 WS 代理来模拟该环境。
// 验证：服务端协议级心跳会持续产生流量，使连接不会被空闲超时误杀。

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { openDb } = require('../shared/db');
const { createApp } = require('../shared/app');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-hb-')); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startApp({ heartbeatMs }) {
    const dir = tmpDir();
    const store = openDb(path.join(dir, 't.db'));
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..'), heartbeatMs });
    await new Promise((r) => app.server.listen(0, r));
    const port = app.server.address().port;
    return { dir, store, app, port, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws` };
}
function stopApp(x) {
    try { x.app.wss.close(); } catch (e) {}
    try { x.app.server.close(); } catch (e) {}
    try { x.app.close && x.app.close(); } catch (e) {}
    try { x.store.close(); } catch (e) {}
    try { fs.rmSync(x.dir, { recursive: true, force: true }); } catch (e) {}
}

// 模拟反代：下游空闲 IDLE_MS 且无任何双向流量即掐断下游（等价 Nginx read timeout）
async function startDropProxy(upstreamPort, idleMs) {
    const proxy = http.createServer();
    const wssP = new WebSocket.Server({ server: proxy });
    let dropLog = { dropped: false };
    wssP.on('connection', (down) => {
        let up = null;
        let last = Date.now();
        const watch = setInterval(() => {
            if (down.readyState !== WebSocket.OPEN) { clearInterval(watch); return; }
            if (Date.now() - last > idleMs) {
                dropLog.dropped = true;
                try { down.terminate(); } catch (e) {}
                if (up && up.readyState === WebSocket.OPEN) up.terminate();
                clearInterval(watch);
            }
        }, 150);
        const touch = () => { last = Date.now(); };
        const wsup = new WebSocket('ws://127.0.0.1:' + upstreamPort + '/ws');
        wsup.on('open', () => { up = wsup; });
        wsup.on('message', (d) => { touch(); if (down.readyState === WebSocket.OPEN) down.send(d); });
        wsup.on('ping', (d) => { touch(); try { down.ping(d); } catch (e) {} }); // 转发服务端协议心跳
        wsup.on('pong', (d) => { touch(); try { down.pong(d); } catch (e) {} });
        wsup.on('close', () => { try { down.terminate(); } catch (e) {} clearInterval(watch); });
        down.on('message', (d) => { touch(); if (up && up.readyState === WebSocket.OPEN) up.send(d); });
        down.on('ping', (d) => { touch(); try { wsup.ping(d); } catch (e) {} });
        down.on('pong', (d) => { touch(); try { wsup.pong(d); } catch (e) {} });
        down.on('close', () => { try { up && up.close(); } catch (e) {} clearInterval(watch); });
    });
    await new Promise((r) => proxy.listen(0, r));
    const port = proxy.address().port;
    return { proxy, wssP, port, url: `ws://127.0.0.1:${port}`, dropLog };
}
function stopProxy(p) { try { p.wssP.close(); } catch (e) {} try { p.proxy.close(); } catch (e) {} }

function connectClient(url, token) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let opened = false, closed = false, pings = 0;
        ws.on('open', () => { opened = true; resolve({ ws, state: () => ({ opened, closed, pings }), join(room) { ws.send(JSON.stringify({ type: 'join', roomId: room, token })); } }); });
        ws.on('close', () => { closed = true; });
        ws.on('ping', () => { pings++; });
        ws.on('error', reject);
        setTimeout(() => { if (!opened) reject(new Error('client open timeout')); }, 3000);
    });
}

let apps = [];
test.after(() => { apps.forEach(stopApp); apps = []; });

test('复现：无心跳时，空闲连接被网关空闲超时掐断（问题根源）', async () => {
    const app = await startApp({ heartbeatMs: 0 }); apps.push(app);
    const guest = await (await fetch(app.base + '/api/guest', { method: 'POST' })).json();
    const proxy = await startDropProxy(app.port, 1800);
    const c = await connectClient(proxy.url, guest.token);
    c.join('idle1');
    await sleep(2600); // 超过代理空闲阈值，且服务端无心跳流量
    assert.equal(c.state().closed, true, '空闲连接应被空闲超时断开（复现随机掉线）');
    assert.equal(proxy.dropLog.dropped, true);
    stopProxy(proxy); c.ws.close();
});

test('修复：服务端协议心跳持续保活，空闲连接不再被掐断', async () => {
    const app = await startApp({ heartbeatMs: 300 }); apps.push(app); // 心跳 < 代理空闲阈值
    const guest = await (await fetch(app.base + '/api/guest', { method: 'POST' })).json();
    const proxy = await startDropProxy(app.port, 1800);
    const c = await connectClient(proxy.url, guest.token);
    c.join('idle2');
    await sleep(5000); // 远超空闲阈值
    assert.equal(c.state().closed, false, '有心跳时连接应存活');
    assert.ok(c.state().pings >= 3, '应持续收到服务端协议心跳 (' + c.state().pings + ')');
    stopProxy(proxy); c.ws.close();
});

test('应用层 ping/pong：服务端原样回应，可作客户端探活', async () => {
    const app = await startApp({ heartbeatMs: 0 }); apps.push(app);
    const guest = await (await fetch(app.base + '/api/guest', { method: 'POST' })).json();
    const ws = new WebSocket(app.wsUrl);
    await new Promise((r) => ws.on('open', r));
    let pongs = 0;
    ws.on('message', (d) => { if (JSON.parse(d.toString()).type === 'pong') pongs++; });
    ws.send(JSON.stringify({ type: 'join', roomId: 'hb3', token: guest.token }));
    ws.send(JSON.stringify({ type: 'ping' }));
    await sleep(400);
    assert.ok(pongs >= 1, 'ping 应收到 pong');
    ws.close();
});
