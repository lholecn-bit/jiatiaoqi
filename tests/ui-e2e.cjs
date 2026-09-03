// 夹挑棋 M1 · UI 端到端测试（headless Chrome + CDP，零新增依赖，复用 ws）
// 运行：node tests/ui-e2e.cjs
// 前置：本地 server 已启动（默认 http://127.0.0.1:8080）
'use strict';

const { spawn } = require('child_process');
const WebSocket = require('ws');
const assert = require('node:assert/strict');

const BASE = process.env.UI_BASE || 'http://127.0.0.1:8080/index.html';
const CHROME = process.env.CHROME_BIN || 'google-chrome';
const PORT = 9333;
const USER_DIR = `/tmp/m1-chrome-${process.pid}`;

// ---------- 极简 CDP 客户端 ----------
class CDP {
    constructor(wsUrl) {
        this.ws = new WebSocket(wsUrl);
        this.id = 0;
        this.pending = new Map();
        this.listeners = new Map();
        this.exceptions = [];
    }
    open() {
        return new Promise((res, rej) => {
            this.ws.on('open', res);
            this.ws.on('error', rej);
            this.ws.on('message', (buf) => {
                const msg = JSON.parse(buf.toString());
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) reject(new Error(msg.error.message));
                    else resolve(msg.result);
                    return;
                }
                if (msg.method === 'Runtime.exceptionThrown') {
                    const d = msg.params.exceptionDetails;
                    this.exceptions.push((d.exception && d.exception.description) || d.text);
                }
                const ls = this.listeners.get(msg.method);
                if (ls) ls.forEach((fn) => fn(msg.params));
            });
        });
    }
    send(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    on(method, fn) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(fn);
    }
    async evalJS(expression) {
        const r = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
            userGesture: true,
        });
        if (r.exceptionDetails) {
            throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
        }
        return r.result.value;
    }
    close() { try { this.ws.close(); } catch (e) {} }
}

// ---------- 工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
    return r.json();
}

async function waitFor(cdp, expr, timeout = 15000, label = expr) {
    const t0 = Date.now();
    for (;;) {
        const v = await cdp.evalJS(`(function(){try{return !!(${expr})}catch(e){return false}})()`);
        if (v) return;
        if (Date.now() - t0 > timeout) throw new Error('等待超时: ' + label);
        await sleep(120);
    }
}

async function clickById(cdp, id) {
    await waitFor(cdp, `document.getElementById('${id}')`, 8000, '元素 ' + id);
    await cdp.evalJS(`document.getElementById('${id}').click()`);
}

async function setValue(cdp, id, value) {
    await cdp.evalJS(`(()=>{const el=document.getElementById('${id}');el.value=${JSON.stringify(value)};
        el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}

async function clickCanvasAt(cdp, gx, gy) {
    // 把游戏逻辑坐标（x 右、y 上）换算为画布内的 clientX/Y 再派发 click
    const ox = 50 + gx * 100;
    const oy = 50 + (4 - gy) * 100;
    await cdp.evalJS(
        '(()=>{const canvas=document.getElementById("gameCanvas");' +
        'const rect=canvas.getBoundingClientRect();const S=500;const factor=S/rect.width;' +
        'const cx=rect.left+(' + ox + ')*factor;const cy=rect.top+(' + oy + ')*factor;' +
        'canvas.dispatchEvent(new MouseEvent("click",{clientX:cx,clientY:cy,bubbles:true}));})()'
    );
}

async function cellIsPiece(cdp, gx, gy) {
    // 在圆环带（避开中心高光）采样最暗像素：黑子明显暗于空点/浅色
    const xL = 50 + gx * 100;
    const yL = 50 + (4 - gy) * 100;
    return cdp.evalJS(
        '(()=>{const c=document.getElementById("gameCanvas").getContext("2d");' +
        'const fx=c.canvas.width/500, fy=c.canvas.height/500;' +
        'const cx=' + xL + '*fx, cy=' + yL + '*fy;' +
        'const pts=[[12,0],[-12,0],[0,12],[0,-12]];let ms=1e9;' +
        'for(const p of pts){const d=c.getImageData(Math.round(cx+p[0]*fx),Math.round(cy+p[1]*fy),1,1).data;' +
        'const s=d[0]+d[1]+d[2];if(s<ms)ms=s;}return ms<170;})()'
    );
}

function assertElem(cdp, selector, label) {
    return cdp.evalJS(`!!document.querySelector(${JSON.stringify(selector)})`).then((v) => {
        assert.ok(v, '应存在: ' + label);
    });
}

// ---------- 主流程 ----------
async function main() {
    let chrome = null;
    let cdp = null;
    const steps = [];
    const step = (name, fn) => steps.push({ name, fn });

    const freshUrl = (tag) => `${BASE}?t=${tag}`;

    try {
        chrome = spawn(CHROME, [
            '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
            '--user-data-dir=' + USER_DIR,
            '--remote-debugging-port=' + PORT,
            freshUrl('boot'),
        ], { stdio: 'ignore' });

        // 等调试端口就绪
        let list = [];
        for (let i = 0; i < 60; i++) {
            try { list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`); if (list.length) break; } catch (e) {}
            await sleep(200);
        }
        if (!list || !list.length) throw new Error('Chrome CDP 未就绪');

        cdp = new CDP((list.find((t) => t.type === 'page' && t.url.includes('index.html')) || list[0]).webSocketDebuggerUrl);
        await cdp.open();
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        const load = async (url) => {
            await cdp.send('Page.navigate', { url });
            await waitFor(cdp, `location.href.indexOf('index.html')>=0 && document.readyState==='complete'`, 15000, '页面加载 ' + url);
            await sleep(400);
        };

        // ---------- A1 教程：首次进入自动弹出 ----------
        step('A1 首次进入自动弹出玩法教程', async () => {
            await cdp.evalJS('localStorage.clear()');
            await load(freshUrl('a1'));
            await waitFor(cdp, `document.getElementById('tutorialOverlay').classList.contains('show')`, 8000, '教程自动弹出');
            const title = await cdp.evalJS(`document.getElementById('tutTitle').textContent`);
            assert.ok(title.includes('欢迎'), '教程标题: ' + title);
            await clickById(cdp, 'tutSkipBtn');
            await waitFor(cdp, `!document.getElementById('tutorialOverlay').classList.contains('show')`, 5000, '教程关闭');
            assert.equal(await cdp.evalJS(`localStorage.getItem('jtq-tutorial-done')`), '1');
        });

        // ---------- A2 主题：切换 + 持久化 ----------
        step('A2 亮/暗主题切换并持久化', async () => {
            await load(freshUrl('a2'));
            assert.equal(await cdp.evalJS(`document.documentElement.getAttribute('data-theme')`), null, '默认暗色');
            assert.equal(await cdp.evalJS(`document.getElementById('themeBtn').textContent`), '🌙');
            assert.equal(await cdp.evalJS(`getComputedStyle(document.body).color`), 'rgb(232, 236, 245)', '暗色正文色');
            await clickById(cdp, 'themeBtn');
            assert.equal(await cdp.evalJS(`document.documentElement.getAttribute('data-theme')`), 'light');
            assert.equal(await cdp.evalJS(`localStorage.getItem('jtq-theme')`), 'light');
            assert.equal(await cdp.evalJS(`getComputedStyle(document.body).color`), 'rgb(60, 52, 38)', '亮色正文色');
            // 刷新后保持亮色
            await load(freshUrl('a2r'));
            assert.equal(await cdp.evalJS(`document.documentElement.getAttribute('data-theme')`), 'light');
            assert.equal(await cdp.evalJS(`getComputedStyle(document.body).color`), 'rgb(60, 52, 38)');
            // 切回暗色
            await clickById(cdp, 'themeBtn');
            assert.equal(await cdp.evalJS(`localStorage.getItem('jtq-theme')`), 'dark');
            assert.equal(await cdp.evalJS(`getComputedStyle(document.body).color`), 'rgb(232, 236, 245)');
        });

        // ---------- A3 昵称头像：设置 + 持久化 ----------
        step('A3 昵称与头像设置并持久化', async () => {
            await load(freshUrl('a3'));
            await clickById(cdp, 'profileBtn');
            await waitFor(cdp, `document.getElementById('profileOverlay').classList.contains('show')`, 5000, '资料弹窗');
            await setValue(cdp, 'nickInput', '阿柒');
            await cdp.evalJS(`document.querySelectorAll('#avatarGrid button')[3].click()`);
            await clickById(cdp, 'profileSaveBtn');
            await waitFor(cdp, `document.getElementById('profileName').textContent==='阿柒'`, 5000, '昵称生效');
            const stored = await cdp.evalJS(`localStorage.getItem('jtq-profile')`);
            assert.ok(stored.includes('阿柒') && stored.includes('"avatar":3'), '存储内容: ' + stored);
            // 刷新持久化
            await load(freshUrl('a3r'));
            assert.equal(await cdp.evalJS(`document.getElementById('profileName').textContent`), '阿柒');
            assert.equal(await cdp.evalJS(`document.getElementById('profileAvatar').textContent`), '🐸');
        });

        // ---------- A4 悔棋：本地双人 ----------
        step('A4 悔棋（本地双人）', async () => {
            await load(freshUrl('a4'));
            await clickById(cdp, 'restartBtn');
            assert.equal(await cellIsPiece(cdp, 0, 0), true, '初始 (0,0) 有黑子');
            assert.equal(await cellIsPiece(cdp, 2, 2), false, '初始 (2,2) 为空');
            await clickCanvasAt(cdp, 0, 0);
            await clickCanvasAt(cdp, 2, 2);
            await waitFor(cdp, `document.getElementById('status').textContent.includes('白方')`, 8000, '轮到白方');
            assert.equal(await cellIsPiece(cdp, 0, 0), false, '走后 (0,0) 空');
            assert.equal(await cellIsPiece(cdp, 2, 2), true, '走后 (2,2) 有子');
            await clickById(cdp, 'undoBtn');
            await waitFor(cdp, `document.getElementById('status').textContent.includes('黑方')`, 8000, '悔棋后黑方');
            assert.equal(await cellIsPiece(cdp, 0, 0), true, '悔棋后 (0,0) 还原');
            assert.equal(await cellIsPiece(cdp, 2, 2), false, '悔棋后 (2,2) 空');
        });

        // ---------- A5 悔棋：人机（连 AI 应手一并撤回） ----------
        step('A5 悔棋（人机，含撤回 AI 应手）', async () => {
            await load(freshUrl('a5'));
            await clickById(cdp, 'aiModeBtn');
            assert.equal(await cellIsPiece(cdp, 0, 0), true);
            await clickCanvasAt(cdp, 0, 0);
            await clickCanvasAt(cdp, 2, 2);
            await waitFor(cdp, `!document.getElementById('undoBtn').disabled`, 20000, 'AI 走完、悔棋可用');
            assert.equal(await cellIsPiece(cdp, 0, 0), false, '人类走子已生效');
            await clickById(cdp, 'undoBtn');
            await waitFor(cdp, `document.getElementById('status').textContent.includes('黑方走棋')`, 8000, '悔棋后轮黑方');
            assert.equal(await cellIsPiece(cdp, 0, 0), true, '人类棋子回到原位');
            assert.equal(await cellIsPiece(cdp, 2, 2), false, '目标点还原为空');
            assert.equal(await cdp.evalJS(`document.getElementById('blackCount').textContent`), '5');
            assert.equal(await cdp.evalJS(`document.getElementById('whiteCount').textContent`), '5');
        });

        // ---------- A6 教程：可再次进入并翻页 ----------
        step('A6 玩法教程可再次打开并翻页', async () => {
            await load(freshUrl('a6'));
            await clickById(cdp, 'tutorialBtn');
            await waitFor(cdp, `document.getElementById('tutorialOverlay').classList.contains('show')`, 5000, '教程打开');
            assert.ok((await cdp.evalJS(`document.getElementById('tutTitle').textContent`)).includes('欢迎'));
            await clickById(cdp, 'tutNextBtn');
            assert.ok((await cdp.evalJS(`document.getElementById('tutTitle').textContent`)).includes('棋盘'));
            await clickById(cdp, 'tutSkipBtn');
        });

        // ---------- 汇总 ----------
        console.log('\n===== M1 UI E2E =====');
        for (const s of steps) {
            try {
                await s.fn();
                console.log('  PASS', s.name);
            } catch (e) {
                console.error('  FAIL', s.name);
                throw e;
            }
        }
        if (cdp.exceptions.length) {
            throw new Error('页面运行时异常:\n' + cdp.exceptions.slice(0, 5).join('\n'));
        }
        console.log('✅ UI E2E 全部通过');
    } finally {
        if (cdp) cdp.close();
        if (chrome) chrome.kill('SIGKILL');
    }
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('\n❌ UI E2E 失败：', e.message || e);
    process.exit(1);
});
