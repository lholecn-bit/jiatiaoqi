// 夹挑棋 · 渲染层（微信小游戏版）
// draw() 主体照搬 index.html，改动：
//  1) 坐标换算 g2s/s2g 改用 layout（竖屏自适应）
//  2) 顶部状态栏、底部按钮交给 ui.js 绘制
//  3) 取消 hover（触屏无 hover），保留落子高亮与选中环

const { EMPTY, BLACK, WHITE, GRID } = require('./logic');
const ui = require('./ui');

// 游戏坐标 → 屏幕坐标
function g2s(gx, gy) {
    const { boardX, boardY, pad, cell } = ui.layout;
    return [boardX + pad + gx * cell, boardY + pad + (GRID - 1 - gy) * cell];
}

// 屏幕坐标 → 游戏坐标（命中半径约 0.42 格）
function s2g(sx, sy) {
    const { pad, cell } = ui.layout;
    const gx = Math.round((sx - ui.layout.boardX - pad) / cell);
    const gy = Math.round((GRID - 1 - (sy - ui.layout.boardY - pad) / cell));
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) return null;
    const [cx, cy] = g2s(gx, gy);
    if (Math.hypot(sx - cx, sy - cy) > cell * 0.42) return null;
    return [gx, gy];
}

const RADIUS_RATIO = 0.22; // 棋子半径 = cell * 0.22

function drawBackground(ctx) {
    const { canvasW, canvasH, boardX, boardY, boardSize } = ui.layout;
    // 整屏底色
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, canvasW, canvasH);

    // 棋盘底色（木色）
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(boardX, boardY, boardSize, boardSize);

    // 木纹
    ctx.fillStyle = 'rgba(180, 140, 60, 0.15)';
    for (let i = boardX; i < boardX + boardSize; i += 6) {
        ctx.fillRect(i, boardY, 2, boardSize);
    }
}

function drawBoard(ctx) {
    const { cell } = ui.layout;
    ctx.strokeStyle = '#5a4a2a';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    // 横线
    for (let y = 0; y < GRID; y++) {
        const [x1, y1] = g2s(0, y);
        const [x2, y2] = g2s(GRID - 1, y);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // 竖线
    for (let x = 0; x < GRID; x++) {
        const [x1, y1] = g2s(x, 0);
        const [x2, y2] = g2s(x, GRID - 1);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // 对角线（按格子，交替方向）
    for (let cx = 0; cx < GRID - 1; cx++) {
        for (let cy = 0; cy < GRID - 1; cy++) {
            let sx1, sy1, sx2, sy2;
            if ((cx + cy) % 2 === 0) {
                [sx1, sy1] = g2s(cx, cy);
                [sx2, sy2] = g2s(cx + 1, cy + 1);
            } else {
                [sx1, sy1] = g2s(cx, cy + 1);
                [sx2, sy2] = g2s(cx + 1, cy);
            }
            ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
        }
    }
}

function drawEmptyDots(ctx, board) {
    const { cell } = ui.layout;
    for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
            if (board[x][y] !== EMPTY) continue;
            const [sx, sy] = g2s(x, y);
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(2, cell * 0.04), 0, Math.PI * 2);
            ctx.fillStyle = '#6b5b3a';
            ctx.fill();
        }
    }
}

function drawValidMoves(ctx, validMoves) {
    const { cell } = ui.layout;
    const r = Math.max(8, cell * 0.14);
    for (const [mx, my] of validMoves) {
        const [sx, sy] = g2s(mx, my);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(76, 175, 80, 0.45)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(76, 175, 80, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function getAnimTarget(state, x, y) {
    if (!state.animCapture) return null;
    return state.animCapture.targets.some(([tx, ty]) => tx === x && ty === y) ? state.animCapture : null;
}

function drawPieces(ctx, state) {
    const { board, selPiece, validMoves, lastMove, animCapture } = state;
    const { cell } = ui.layout;
    const RADIUS = Math.max(10, cell * RADIUS_RATIO);

    for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
            if (board[x][y] === EMPTY) continue;
            const [sx, sy] = g2s(x, y);
            const piece = board[x][y];
            const anim = getAnimTarget(state, x, y);

            ctx.beginPath();
            ctx.arc(sx, sy, RADIUS, 0, Math.PI * 2);

            if (anim && anim.type === 'gray-flash' && anim.grayOn) {
                const grad = ctx.createRadialGradient(sx - 5, sy - 5, 2, sx, sy, RADIUS);
                grad.addColorStop(0, '#b5b5b5');
                grad.addColorStop(1, '#6e6e6e');
                ctx.fillStyle = grad; ctx.fill();
                ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.stroke();
            } else if (piece === BLACK) {
                const grad = ctx.createRadialGradient(sx - 5, sy - 5, 2, sx, sy, RADIUS);
                grad.addColorStop(0, '#555');
                grad.addColorStop(1, '#111');
                ctx.fillStyle = grad; ctx.fill();
                ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
            } else {
                const grad = ctx.createRadialGradient(sx - 5, sy - 5, 2, sx, sy, RADIUS);
                grad.addColorStop(0, '#fff');
                grad.addColorStop(1, '#ccc');
                ctx.fillStyle = grad; ctx.fill();
                ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.stroke();
            }

            if (anim && anim.type === 'converted') {
                ctx.beginPath();
                ctx.arc(sx, sy, RADIUS + 4, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            if (lastMove && lastMove.tx === x && lastMove.ty === y) {
                ctx.beginPath();
                ctx.arc(sx, sy, 5, 0, Math.PI * 2);
                ctx.fillStyle = '#e53935';
                ctx.fill();
            }
        }
    }

    // 选中环
    if (selPiece) {
        const [sx, sy] = g2s(selPiece[0], selPiece[1]);
        ctx.beginPath();
        ctx.arc(sx, sy, RADIUS + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

function drawWinAnimation(ctx, state) {
    if (!state.gameOver || !state.winAnim) return;
    const { cell, boardX, boardY, boardSize } = ui.layout;
    const RADIUS = Math.max(10, cell * RADIUS_RATIO);

    const now = state.now(); // 由 game.js 注入 performance 等价函数
    const elapsed = (now - state.winAnim.startTime) / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 6.2);
    const winner = state.winAnim.winner;

    for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
            if (state.board[x][y] !== winner) continue;
            const [sx, sy] = g2s(x, y);
            ctx.beginPath();
            ctx.arc(sx, sy, RADIUS + 8 + pulse * 5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 215, 0, ${0.35 + pulse * 0.45})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    }

    const particleCount = 22;
    for (let i = 0; i < particleCount; i++) {
        const px = ((elapsed * 120 + i * 37) % (boardSize + 40)) - 20 + boardX;
        const py = ((elapsed * 85 + i * 57) % (boardSize + 40)) - 20 + boardY;
        const r = 2 + (i % 3);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${(i * 37 + elapsed * 90) % 360}, 95%, 62%, 0.8)`;
        ctx.fill();
    }
}

// 主绘制入口：由 game.js 调用，传入完整 state
function draw(ctx, state) {
    drawBackground(ctx);
    drawBoard(ctx);
    drawEmptyDots(ctx, state.board);
    drawValidMoves(ctx, state.validMoves);
    drawPieces(ctx, state);
    drawWinAnimation(ctx, state);

    // UI 层
    ui.drawTopBar(ctx, {
        blackCount: state.blackCount,
        whiteCount: state.whiteCount,
        curPlayer: state.curPlayer,
        gameOver: state.gameOver,
        statusText: state.statusText,
    });
    ui.drawButtons(ctx, state.gameMode);

    // 胜负弹层（仅游戏结束时）
    if (state.gameOver && state.modalText) {
        state.overlayRect = ui.drawOverlay(ctx, state.modalText);
    } else {
        state.overlayRect = null;
    }
}

module.exports = {
    draw,
    g2s,
    s2g,
};
