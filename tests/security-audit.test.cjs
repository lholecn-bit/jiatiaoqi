// 夹挑棋 · 服务端鉴权与安全审计回归
// 覆盖：静态敏感文件拦截、注册仅游客、资料仅账号、登录暴力破解限流
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../shared/db');
const { createApp } = require('../shared/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startApp(extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtq-sec-'));
    const store = openDb(path.join(dir, 't.db'));
    const app = createApp({ store, staticDir: path.resolve(__dirname, '..'), heartbeatMs: 0, roomKeepMs: 60000, roomIdleMs: 0, pruneMs: 0, ...extra });
    await new Promise((r) => app.server.listen(0, r));
    const port = app.server.address().port;
    return { dir, store, app, base: `http://127.0.0.1:${port}` };
}
function stopApp(x) {
    try { x.app.wss.close(); } catch (e) {}
    try { x.app.server.close(); } catch (e) {}
    try { x.store.close(); } catch (e) {}
    try { fs.rmSync(x.dir, { recursive: true, force: true }); } catch (e) {}
}
async function call(base, pathname, { token, method = 'GET', body } = {}) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.text();
    return { status: res.status, data };
}

test('静态服务不泄露敏感文件（db/服务端源码/脚本/隐藏文件）', async () => {
    const A = await startApp();
    for (const p of ['/jiatiaoqi.db', '/server.js', '/online-server.js', '/shared/db.js',
        '/shared/app.js', '/deploy.sh', '/.env', '/tests/logic.test.js', '/docs/DEPLOY.md']) {
        const r = await call(A.base, p);
        assert.equal(r.status, 404, p + ' 应被拒绝');
        assert.notEqual(r.data, '404 Not Found' && r.status !== 200 ? undefined : r.data, '');
    }
    const ok = await call(A.base, '/index.html');
    assert.equal(ok.status, 200, '正常页面可访问');
    stopApp(A);
});

test('注册仅限游客：账号 token 不可被用来注册/覆盖账号', async () => {
    const A = await startApp();
    const g1 = await (await fetch(A.base + '/api/guest', { method: 'POST' })).json();
    await call(A.base, '/api/register', { method: 'POST', body: { guestToken: g1.token, username: 'acc_owner', password: 'secret123' } });
    // acc_owner 现在已是账号，其会话 token 不能再次"注册"
    const dup = await call(A.base, '/api/register', {
        method: 'POST', body: { guestToken: g1.token, username: 'stolen_name', password: 'secret123' },
    });
    assert.equal(dup.status, 400);
    assert.ok(dup.data.includes('游客'), '提示仅游客可注册: ' + dup.data);
    // 不能覆盖已有账号的用户名
    const login1 = await (await fetch(A.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'acc_owner', password: 'secret123' }) })).json();
    assert.ok(login1.token);
    const regWithAccount = await call(A.base, '/api/register', {
        method: 'POST', body: { guestToken: login1.token, username: 'nonsense', password: 'secret123' },
    });
    assert.equal(regWithAccount.status, 400);
    assert.ok(regWithAccount.data.includes('游客'), regWithAccount.data);
    stopApp(A);
});

test('登录暴力破解限流（连续失败锁定，锁定期后恢复）', async () => {
    const A = await startApp({ loginMaxFails: 3, loginLockMs: 800 });
    const g = await (await fetch(A.base + '/api/guest', { method: 'POST' })).json();
    await call(A.base, '/api/register', { method: 'POST', body: { guestToken: g.token, username: 'lock_user', password: 'right123' } });
    for (let i = 0; i < 3; i++) {
        const r = await call(A.base, '/api/login', { method: 'POST', body: { username: 'lock_user', password: 'wrongpass' } });
        assert.equal(r.status, 401, '第 ' + (i + 1) + ' 次错误密码应 401');
    }
    const locked = await call(A.base, '/api/login', { method: 'POST', body: { username: 'lock_user', password: 'wrongpass' } });
    assert.equal(locked.status, 429, '超阈值应被限流');
    await sleep(1000);
    const ok = await call(A.base, '/api/login', { method: 'POST', body: { username: 'lock_user', password: 'right123' } });
    assert.equal(ok.status, 200, '锁定期后正确密码可登录');
    assert.ok(ok.data.includes('token'));
    stopApp(A);
});
