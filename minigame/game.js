// 夹挑棋 · 微信小游戏入口
// 对照 index.html：把全局状态机模块化，平台相关部分替换为 wx API。
// 纯逻辑见 js/logic.js，渲染见 js/render.js，UI 见 js/ui.js，
// 触摸见 js/input.js，音效见 js/audio.js，广告见 js/ad.js。

const logic = require('./js/logic');
const render = require('./js/render');
const ui = require('./js/ui');
const audio = require('./js/audio');
const ad = require('./js/ad');

const { EMPTY, BLACK, WHITE, GRID } = logic;

// ========== Canvas & Hi-DPI ==========
let canvas, ctx;
let canvasW = 0, canvasH = 0; // 逻辑尺寸（CSS 像素）

function initCanvas() {
    if (typeof wx !== 'undefined') {
        canvas = wx.createCanvas();
        const info = wx.getSystemInfoSync();
        const dpr = info.pixelRatio;
        canvasW = info.windowWidth;
        canvasH = info.windowHeight;
        canvas.width = canvasW * dpr;
        canvas.height = canvasH * dpr;
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    } else {
        // 浏览器调试：复用或创建一个 canvas
        canvas = document.getElementById('gameCanvas') || document.createElement('canvas');
        canvas.id = 'gameCanvas';
        document.body.appendChild(canvas);
        canvasW = window.innerWidth;
        canvasH = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasW * dpr;
        canvas.height = canvasH * dpr;
        canvas.style.width = canvasW + 'px';
        canvas.style.height = canvasH + 'px';
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }
}

// ========== State ==========
const state = {
    board: null,
    curPlayer: BLACK,
    selPiece: null,
    validMoves: [],
    lastMove: null,
    gameOver: false,
    isAnimating: false,
    animCapture: null,
    aiThinking: false,
    winAnim: null,
    blackCount: 5,
    whiteCount: 5,
    statusText: '',
    modalText: '',
    overlayRect: null,
    gameMode: 'pvp',     // 'pvp' | 'ai'
    now: () => Date.now(), // render.drawWinAnimation 用；rAF 版本覆盖
};

const aiColor = WHITE;

// ========== Helpers ==========
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function updatePieceCounts() {
    const { bc, wc } = logic.countPieces(state.board);
    state.blackCount = bc;
    state.whiteCount = wc;
}

function isAiTurn() {
    return state.gameMode === 'ai' && state.curPlayer === aiColor;
}

function isHumanTurn() {
    return !isAiTurn();
}

function updateUI() {
    if (state.gameOver) {
        state.statusText = '游戏结束';
    } else if (state.isAnimating) {
        if (state.aiThinking) state.statusText = '白方思考中...';
    } else if (isAiTurn()) {
        state.statusText = '白方思考中...';
    } else {
        state.statusText = (state.curPlayer === BLACK ? '黑方' : '白方') + '走棋';
    }
}

// ========== 重置 / 胜负 ==========
function resetBoard() {
    state.board = logic.initialBoard();
    state.curPlayer = BLACK;
    state.selPiece = null;
    state.validMoves = [];
    state.lastMove = null;
    state.gameOver = false;
    state.isAnimating = false;
    state.aiThinking = false;
    state.animCapture = null;
    state.winAnim = null;
    state.modalText = '';
    state.overlayRect = null;
    updatePieceCounts();
    updateUI();
    renderAndSchedule();
    checkNoMoveLossForCurrentPlayer();
}

function endGame(msg, winnerPiece) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.isAnimating = false;
    state.modalText = msg;
    audio.playWinSound();
    if (winnerPiece === BLACK || winnerPiece === WHITE) {
        state.winAnim = { winner: winnerPiece, startTime: Date.now() };
        startWinAnimationLoop();
    }
    updateUI();
    renderAndSchedule();
}

function checkNoMoveLossForCurrentPlayer() {
    if (state.gameOver) return true;
    if (logic.hasAnyMove(state.board, state.curPlayer)) return false;
    const loser = state.curPlayer === BLACK ? '黑方' : '白方';
    const winner = state.curPlayer === BLACK ? '白方' : '黑方';
    const winnerPiece = state.curPlayer === BLACK ? WHITE : BLACK;
    endGame(`${loser}所有棋子均无法移动，${winner}获胜！`, winnerPiece);
    return true;
}

// ========== 吃子动画（对照 index.html playCaptureStep） ==========
async function playCaptureStep(targets, player, stepNo) {
    if (targets.length === 0) return;

    state.statusText = `连锁第${stepNo}步：即将吃子 ${targets.length} 枚`;
    renderAndSchedule();
    await sleep(260);

    for (let i = 0; i < 6; i++) {
        state.animCapture = { type: 'gray-flash', stepNo, targets, grayOn: i % 2 === 0 };
        state.statusText = `连锁第${stepNo}步：吃子 ${targets.length} 枚`;
        renderAndSchedule();
        await sleep(200);
    }

    for (const [cx, cy] of targets) {
        state.board[cx][cy] = player;
    }
    audio.playCaptureSound(targets.length);
    updatePieceCounts();

    state.animCapture = { type: 'converted', stepNo, targets, grayOn: false };
    state.statusText = `连锁第${stepNo}步：已转换 ${targets.length} 枚`;
    renderAndSchedule();
    await sleep(520);

    state.animCapture = null;
    renderAndSchedule();
    await sleep(360);
}

// ========== 落子（对照 index.html doMove） ==========
async function doMove(fx, fy, tx, ty) {
    const player = state.board[fx][fy];
    state.board[fx][fy] = EMPTY;
    state.board[tx][ty] = player;
    state.lastMove = { fx, fy, tx, ty };
    audio.playMoveSound();
    renderAndSchedule();
    await sleep(120);

    // 连锁吃子（BFS 逐波）
    let queue = [[tx, ty]];
    let stepNo = 1;
    while (queue.length > 0) {
        const seen = new Set();
        const next = [];
        for (const [qx, qy] of queue) {
            const caps = logic.findCapturesOnBoard(state.board, qx, qy, player);
            for (const [cx, cy] of caps) {
                const key = cx * GRID + cy;
                if (state.board[cx][cy] !== player && !seen.has(key)) {
                    seen.add(key);
                    next.push([cx, cy]);
                }
            }
        }
        await playCaptureStep(next, player, stepNo);
        queue = next;
        stepNo++;
    }

    updatePieceCounts();

    if (state.blackCount === 0) { endGame('白方获胜！', WHITE); return; }
    if (state.whiteCount === 0) { endGame('黑方获胜！', BLACK); return; }

    state.curPlayer = state.curPlayer === BLACK ? WHITE : BLACK;
    state.selPiece = null;
    state.validMoves = [];

    if (checkNoMoveLossForCurrentPlayer()) return;
    updateUI();
}

// ========== AI（对照 index.html triggerAiMoveIfNeeded） ==========
async function triggerAiMoveIfNeeded() {
    if (state.gameOver || state.isAnimating || state.aiThinking || !isAiTurn()) return;

    state.aiThinking = true;
    state.isAnimating = true;
    state.selPiece = null;
    state.validMoves = [];
    updateUI();
    renderAndSchedule();

    await sleep(450);
    const move = logic.chooseAiMove(state.board, aiColor);
    if (!move) {
        state.aiThinking = false;
        state.isAnimating = false;
        checkNoMoveLossForCurrentPlayer();
        renderAndSchedule();
        return;
    }

    await doMove(move.fx, move.fy, move.tx, move.ty);
    state.aiThinking = false;
    state.isAnimating = false;
    if (!state.gameOver) updateUI();
    renderAndSchedule();
}

// ========== 胜利动画循环 ==========
let winAnimRaf = null;
function startWinAnimationLoop() {
    if (winAnimRaf) return;
    const tick = () => {
        if (!state.gameOver || !state.winAnim) { winAnimRaf = null; return; }
        state.now = () => Date.now();
        renderNow();
        winAnimRaf = requestAnimationFrame(tick);
    };
    winAnimRaf = requestAnimationFrame(tick);
}

// ========== 渲染 ==========
function renderNow() {
    render.draw(ctx, state);
}

// 常规渲染入口：单帧。动画期间的连续帧由各自的 sleep 间 renderAndSchedule 触发，
// 或由胜利动画 RAF 接管。
function renderAndSchedule() {
    renderNow();
}

// ========== 输入 handler（供 input.js 注入） ==========
const handlers = {
    getOverlayRect: () => state.overlayRect,
    onPlayAgain: () => {
        resetBoard();
        triggerAiMoveIfNeeded();
    },
    onButton: (id) => {
        if (id === 'pvpMode') { setMode('pvp'); return; }
        if (id === 'aiMode') { setMode('ai'); return; }
        if (id === 'restart') {
            resetBoard();
            triggerAiMoveIfNeeded();
            return;
        }
        if (id === 'surrender') {
            if (state.gameOver || state.isAnimating) return;
            const winnerPiece = state.curPlayer === BLACK ? WHITE : BLACK;
            const winner = state.curPlayer === BLACK ? '白方' : '黑方';
            // 认输后植入一次激励视频（变现入口）
            ad.show((isEnded) => {
                const msg = (state.curPlayer === BLACK ? '黑方' : '白方') + '认输，' + winner + '获胜！';
                endGame(msg, winnerPiece);
            });
            return;
        }
    },
    onBoardTap: async (gx, gy) => {
        if (state.gameOver || state.isAnimating || !isHumanTurn()) return;
        // 首次触摸激活音频
        audio.unlockAudio();

        if (state.selPiece) {
            if (state.validMoves.some(([vx, vy]) => vx === gx && vy === gy)) {
                const fromX = state.selPiece[0];
                const fromY = state.selPiece[1];
                state.isAnimating = true;
                await doMove(fromX, fromY, gx, gy);
                state.isAnimating = false;
                if (!state.gameOver) updateUI();
                renderAndSchedule();
                await triggerAiMoveIfNeeded();
                return;
            }
            if (state.board[gx][gy] === state.curPlayer) {
                state.selPiece = [gx, gy];
                state.validMoves = logic.getValidMoves(state.board, gx, gy);
                renderAndSchedule();
                return;
            }
            state.selPiece = null;
            state.validMoves = [];
            renderAndSchedule();
            return;
        }

        if (state.board[gx][gy] === state.curPlayer) {
            state.selPiece = [gx, gy];
            state.validMoves = logic.getValidMoves(state.board, gx, gy);
            renderAndSchedule();
        }
    },
};

function setMode(mode) {
    if (state.gameMode === mode) return;
    state.gameMode = mode;
    resetBoard();
    triggerAiMoveIfNeeded();
}

// ========== 启动 ==========
function main() {
    logic.buildLines();
    initCanvas();
    ui.computeLayout(canvasW, canvasH);
    // 注入触摸处理器
    const input = require('./js/input');
    input.setHandler(handlers);
    input.bind();
    // 广告初始化（非小游戏环境会自动降级）
    ad.init();
    // 初始对局
    resetBoard();
}

main();
