// 夹挑棋 · 纯逻辑层（平台无关）
// 抽自 index.html，无任何 DOM/window 依赖。
// 小游戏版与网页版共享同一份规则实现，保证行为一致。

// ========== Constants ==========
const EMPTY = 0, BLACK = 1, WHITE = 2;
const GRID = 5;

// ========== Lines (game coords: y=0 bottom, y=4 top) ==========
const allLines = [];
const ptLines = {}; // "x,y" -> [{li, pi}]

function buildLines() {
    allLines.length = 0;
    for (const k in ptLines) delete ptLines[k];

    // Horizontal (5)
    for (let y = 0; y < GRID; y++) {
        const line = [];
        for (let x = 0; x < GRID; x++) line.push([x, y]);
        allLines.push(line);
    }
    // Vertical (5)
    for (let x = 0; x < GRID; x++) {
        const line = [];
        for (let y = 0; y < GRID; y++) line.push([x, y]);
        allLines.push(line);
    }
    // Diagonal '\' in game coords (x+, y-)
    allLines.push([[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]]);
    allLines.push([[0, 2], [1, 1], [2, 0]]);
    allLines.push([[2, 4], [3, 3], [4, 2]]);
    // Diagonal '/' in game coords (x+, y+)
    allLines.push([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
    allLines.push([[0, 2], [1, 3], [2, 4]]);
    allLines.push([[2, 0], [3, 1], [4, 2]]);

    for (let li = 0; li < allLines.length; li++) {
        const line = allLines[li];
        for (let pi = 0; pi < line.length; pi++) {
            const k = line[pi][0] + ',' + line[pi][1];
            if (!ptLines[k]) ptLines[k] = [];
            ptLines[k].push({ li, pi });
        }
    }
}

// ========== Move / capture logic ==========

// 沿连线方向的可走点（路径被棋子阻挡即停）
function getValidMoves(board, x, y) {
    const moves = [];
    const entries = ptLines[x + ',' + y] || [];
    for (const { li, pi } of entries) {
        const line = allLines[li];
        for (let i = pi + 1; i < line.length; i++) {
            if (board[line[i][0]][line[i][1]] !== EMPTY) break;
            moves.push(line[i]);
        }
        for (let i = pi - 1; i >= 0; i--) {
            if (board[line[i][0]][line[i][1]] !== EMPTY) break;
            moves.push(line[i]);
        }
    }
    return moves;
}

// 夹/挑吃子判定：返回落子在 (x,y) 时会被吃掉的敌子坐标
function findCapturesOnBoard(boardState, x, y, player) {
    const enemy = player === BLACK ? WHITE : BLACK;
    const caps = [];
    const entries = ptLines[x + ',' + y] || [];

    for (const { li, pi } of entries) {
        const L = allLines[li];

        // 夹 (+1): me(pi) - enemy(pi+1) - me(pi+2)
        if (pi + 2 < L.length) {
            const [ax, ay] = L[pi + 1];
            const [bx, by] = L[pi + 2];
            if (boardState[ax][ay] === enemy && boardState[bx][by] === player) {
                caps.push([ax, ay]);
            }
        }
        // 夹 (-1): me(pi) - enemy(pi-1) - me(pi-2)
        if (pi - 2 >= 0) {
            const [ax, ay] = L[pi - 1];
            const [bx, by] = L[pi - 2];
            if (boardState[ax][ay] === enemy && boardState[bx][by] === player) {
                caps.push([ax, ay]);
            }
        }
        // 挑: enemy(pi-1) - me(pi) - enemy(pi+1)
        if (pi - 1 >= 0 && pi + 1 < L.length) {
            const [ax, ay] = L[pi - 1];
            const [bx, by] = L[pi + 1];
            if (boardState[ax][ay] === enemy && boardState[bx][by] === enemy) {
                caps.push([ax, ay], [bx, by]);
            }
        }
    }

    // Deduplicate
    const seen = new Set();
    return caps.filter(([cx, cy]) => {
        const k = cx * GRID + cy;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// 初始棋盘：黑占底行(y=0)、白占顶行(y=4)
function initialBoard() {
    const board = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    for (let x = 0; x < GRID; x++) board[x][0] = BLACK;
    for (let x = 0; x < GRID; x++) board[x][4] = WHITE;
    return board;
}

function countPieces(board) {
    let bc = 0, wc = 0;
    for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
            if (board[x][y] === BLACK) bc++;
            if (board[x][y] === WHITE) wc++;
        }
    }
    return { bc, wc };
}

function getAllPossibleMoves(board, player) {
    const moves = [];
    for (let x = 0; x < GRID; x++) {
        for (let y = 0; y < GRID; y++) {
            if (board[x][y] !== player) continue;
            const toList = getValidMoves(board, x, y);
            for (const [tx, ty] of toList) {
                moves.push({ fx: x, fy: y, tx, ty });
            }
        }
    }
    return moves;
}

// 落子后完整连锁吃子数量预估（BFS，逐波触发）
function estimateCaptureCountAfterMove(board, move, player) {
    const boardCopy = board.map((col) => col.slice());
    boardCopy[move.fx][move.fy] = EMPTY;
    boardCopy[move.tx][move.ty] = player;

    let captured = 0;
    let queue = [[move.tx, move.ty]];
    while (queue.length > 0) {
        const next = [];
        const seen = new Set();
        for (const [qx, qy] of queue) {
            const caps = findCapturesOnBoard(boardCopy, qx, qy, player);
            for (const [cx, cy] of caps) {
                const key = cx * GRID + cy;
                if (boardCopy[cx][cy] !== player && !seen.has(key)) {
                    seen.add(key);
                    boardCopy[cx][cy] = player;
                    captured++;
                    next.push([cx, cy]);
                }
            }
        }
        queue = next;
    }
    return captured;
}

// AI 启发式：吃子收益 ×100 − 离中心距离 ×2 + 是否推进
function chooseAiMove(board, player) {
    const moves = getAllPossibleMoves(board, player);
    if (moves.length === 0) return null;

    const center = 2;
    let bestScore = -Infinity;
    let bestMoves = [];

    for (const move of moves) {
        const captureCount = estimateCaptureCountAfterMove(board, move, player);
        const centerDistance = Math.abs(move.tx - center) + Math.abs(move.ty - center);
        const progress = player === WHITE ? (move.ty < move.fy ? 1 : 0) : (move.ty > move.fy ? 1 : 0);
        const score = captureCount * 100 - centerDistance * 2 + progress;

        if (score > bestScore) {
            bestScore = score;
            bestMoves = [move];
        } else if (score === bestScore) {
            bestMoves.push(move);
        }
    }

    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function hasAnyMove(board, player) {
    for (let x = 0; x < GRID; x++)
        for (let y = 0; y < GRID; y++)
            if (board[x][y] === player && getValidMoves(board, x, y).length > 0)
                return true;
    return false;
}

module.exports = {
    EMPTY, BLACK, WHITE, GRID,
    buildLines, initialBoard, countPieces,
    getValidMoves, findCapturesOnBoard,
    getAllPossibleMoves, estimateCaptureCountAfterMove,
    chooseAiMove, hasAnyMove,
};
