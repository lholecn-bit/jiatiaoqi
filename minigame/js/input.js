// 夹挑棋 · 触摸输入层（微信小游戏版）
// 职责：把 wx.onTouchStart 翻译成「点了哪个按钮 / 哪个棋格」，
//       再交给 game.js 暴露的 handler 处理。不包含任何游戏状态/异步逻辑。
//
// 对照 index.html：原 click handler(1205-1255) 的棋盘落子逻辑、
//                  按钮 handler(1274-1345) 的模式/重开/认输逻辑，均由 game 实现并注入。

const ui = require('./ui');
const render = require('./render');

let handler = null; // 由 game.js 注入

function setHandler(h) {
    handler = h;
}

// 触摸点（逻辑坐标）→ 是否落在棋盘内
function inBoard(x, y) {
    const L = ui.layout;
    return x >= L.boardX && x <= L.boardX + L.boardSize &&
           y >= L.boardY && y <= L.boardY + L.boardSize;
}

function onTouchStart(e) {
    if (!handler) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;

    // 1) 胜负弹层的「再来一局」按钮优先
    if (handler.getOverlayRect && handler.getOverlayRect()) {
        const r = handler.getOverlayRect();
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            handler.onPlayAgain();
            return;
        }
        // 点在弹层其它位置：忽略（必须先点再来一局）
        return;
    }

    // 2) 按钮
    const btnId = ui.hitButton(x, y);
    if (btnId) {
        handler.onButton(btnId);
        return;
    }

    // 3) 棋盘落子
    if (inBoard(x, y)) {
        const pt = render.s2g(x, y);
        if (pt) handler.onBoardTap(pt[0], pt[1]);
        return;
    }
}

function bind() {
    if (typeof wx !== 'undefined') {
        wx.onTouchStart(onTouchStart);
    } else if (typeof window !== 'undefined') {
        // 浏览器调试用：鼠标点击模拟触摸
        window.addEventListener('click', (e) => {
            onTouchStart({ touches: [{ clientX: e.clientX, clientY: e.clientY }] });
        });
    }
}

module.exports = { setHandler, bind };
