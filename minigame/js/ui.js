// 夹挑棋 · Canvas 内 UI 层（微信小游戏版）
// 小游戏无 DOM，状态栏、按钮、胜负弹层全部在 Canvas 上绘制并自行做触摸命中。
// 本模块导出：布局计算、按钮列表、绘制函数、命中检测。

const { BLACK, WHITE } = require('./logic');

// 布局常量（在 game.js 初始化时按屏宽算出后注入）
const layout = {
    canvasW: 0,     // 画布逻辑宽（CSS 像素）
    canvasH: 0,     // 画布逻辑高
    boardSize: 0,   // 棋盘边长（正方形）
    boardX: 0,      // 棋盘左上角 x
    boardY: 0,      // 棋盘左上角 y
    cell: 0,        // 每格边长
    pad: 0,         // 棋盘内边距
};

// 按钮定义：id / 文本 / 颜色；矩形在 layoutButtons() 后填入
// modeBtn 三选一，与 gameMode 对应；actBtn 为重开/认输
const buttons = {
    pvpMode:   { id: 'pvpMode',   text: '双人',   color: '#3a3a3a', activeColor: '#5c8f2f', rect: null },
    aiMode:    { id: 'aiMode',    text: '人机',   color: '#3a3a3a', activeColor: '#5c8f2f', rect: null },
    restart:   { id: 'restart',   text: '重开',   color: '#4CAF50', activeColor: '#43a047', rect: null },
    surrender: { id: 'surrender', text: '认输',   color: '#e53935', activeColor: '#c62828', rect: null },
};

// 根据屏幕尺寸计算布局（竖屏优先）
function computeLayout(screenW, screenH) {
    layout.canvasW = screenW;
    layout.canvasH = screenH;

    // 棋盘取屏宽与（屏高 - 上下 UI 区）的较小者
    const topUI = 92;        // 顶部状态栏高度
    const bottomUI = 150;    // 底部按钮区高度
    const maxBoardByW = screenW - 16;
    const maxBoardByH = screenH - topUI - bottomUI - 16;
    layout.boardSize = Math.max(160, Math.min(maxBoardByW, maxBoardByH));
    // 让棋盘格子整齐：cell 为整数，pad = 半格
    layout.cell = Math.floor(layout.boardSize / (GRID + 2)); // 留 1 格边距
    layout.pad = layout.cell;
    layout.boardSize = layout.pad * 2 + (GRID - 1) * layout.cell; // 实际绘制边长
    layout.boardX = Math.floor((screenW - layout.boardSize) / 2);
    layout.boardY = topUI;
    layoutButtons();
}

const GRID = 5;

function layoutButtons() {
    // 底部两行：第一行 模式（双人/人机），第二行 操作（重开/认输）
    const btnH = 46;
    const gap = 12;
    const row1Y = layout.boardY + layout.boardSize + 24;
    const row2Y = row1Y + btnH + gap;

    const halfW = Math.floor((layout.canvasW - 32 - gap) / 2);
    buttons.pvpMode.rect = { x: 16, y: row1Y, w: halfW, h: btnH };
    buttons.aiMode.rect = { x: 16 + halfW + gap, y: row1Y, w: halfW, h: btnH };
    buttons.restart.rect = { x: 16, y: row2Y, w: halfW, h: btnH };
    buttons.surrender.rect = { x: 16 + halfW + gap, y: row2Y, w: halfW, h: btnH };
}

// 触摸命中检测：返回按钮 id 或 null
function hitButton(x, y) {
    for (const k in buttons) {
        const b = buttons[k];
        if (!b.rect) continue;
        if (x >= b.rect.x && x <= b.rect.x + b.rect.w &&
            y >= b.rect.y && y <= b.rect.y + b.rect.h) {
            return b.id;
        }
    }
    return null;
}

// ========== 绘制 ==========

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawTopBar(ctx, state) {
    const { blackCount, whiteCount, curPlayer, gameOver, statusText } = state;
    const y = layout.boardY - 92;

    // 标题
    ctx.fillStyle = '#f0d060';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('夹 挑 棋', layout.canvasW / 2, y);

    // 计数（左黑右白）
    ctx.textAlign = 'left';
    ctx.font = '16px sans-serif';
    const blackActive = curPlayer === BLACK && !gameOver;
    const whiteActive = curPlayer === WHITE && !gameOver;

    // 黑方
    ctx.fillStyle = blackActive ? 'rgba(255,255,255,0.12)' : 'transparent';
    roundRect(ctx, 16, y + 38, 90, 30, 6); ctx.fill();
    ctx.beginPath(); ctx.arc(34, y + 53, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#222'; ctx.fill();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#eee'; ctx.font = '15px sans-serif';
    ctx.fillText('黑 ' + blackCount, 50, y + 46);

    // 白方
    ctx.fillStyle = whiteActive ? 'rgba(255,255,255,0.12)' : 'transparent';
    roundRect(ctx, layout.canvasW - 106, y + 38, 90, 30, 6); ctx.fill();
    ctx.beginPath(); ctx.arc(layout.canvasW - 88, y + 53, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#eee'; ctx.fill();
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#eee'; ctx.font = '15px sans-serif';
    ctx.fillText('白 ' + whiteCount, layout.canvasW - 72, y + 46);

    // 状态文字
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ccc';
    ctx.font = '17px sans-serif';
    ctx.fillText(statusText || '', layout.canvasW / 2, y + 46);
}

function drawButtons(ctx, gameMode) {
    for (const k in buttons) {
        const b = buttons[k];
        if (!b.rect) continue;
        let active = false;
        if (b.id === 'pvpMode' && gameMode === 'pvp') active = true;
        if (b.id === 'aiMode' && gameMode === 'ai') active = true;

        roundRect(ctx, b.rect.x, b.rect.y, b.rect.w, b.rect.h, 8);
        ctx.fillStyle = active ? b.activeColor : b.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1; ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 17px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.text, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2);
    }
}

// 胜负弹层（半透明遮罩 + 居中卡片）
function drawOverlay(ctx, modalText) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    const w = Math.min(300, layout.canvasW - 48);
    const h = 170;
    const x = (layout.canvasW - w) / 2;
    const y = (layout.canvasH - h) / 2;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(45,45,45,0.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#f0d060';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(modalText || '', x + w / 2, y + 48);

    // 再来一局按钮
    const bw = 150, bh = 44;
    const bx = x + (w - bw) / 2;
    const by = y + h - 64;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fillStyle = '#4CAF50'; ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('再来一局', bx + bw / 2, by + bh / 2);

    return { x: bx, y: by, w: bw, h: bh }; // 供 input 命中
}

module.exports = {
    layout,
    buttons,
    computeLayout,
    hitButton,
    drawTopBar,
    drawButtons,
    drawOverlay,
    roundRect,
};
