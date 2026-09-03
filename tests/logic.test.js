// 夹挑棋 · 纯逻辑单元测试（node:test + shared/logic.js）
// 运行：node --test tests/logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../shared/logic');

const { EMPTY, BLACK, WHITE, GRID } = logic;

logic.buildLines();

test('初始棋盘：黑占底行、白占顶行，各 5 子', () => {
    const b = logic.initialBoard();
    for (let x = 0; x < GRID; x++) {
        assert.equal(b[x][0], BLACK);
        assert.equal(b[x][4], WHITE);
    }
    const c = logic.countPieces(b);
    assert.deepEqual(c, { bc: 5, wc: 5 });
});

test('走子：路径被阻挡即停、不能落到非空格', () => {
    const b = logic.initialBoard();
    // 初始角落黑子 (0,0)：向上 3 步 (0,1..3) + 斜线 3 步 (1,1)(2,2)(3,3) = 6
    const moves = logic.getValidMoves(b, 0, 0);
    assert.equal(moves.length, 6);
    assert.ok(moves.some(([x, y]) => x === 0 && y === 2), '可直走 (0,2)');
    assert.ok(moves.some(([x, y]) => x === 2 && y === 2), '可斜走 (2,2)');
    assert.ok(!moves.some(([x, y]) => x === 1 && y === 0), '底行被邻子阻挡 (1,0)');
    // 三方向都被堵死的角点棋子应无路可走
    const b2 = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    b2[0][0] = BLACK;
    b2[0][1] = WHITE; b2[1][0] = WHITE; b2[1][1] = WHITE;
    assert.equal(logic.getValidMoves(b2, 0, 0).length, 0);
    // 目标格有子时不可落入、也不可越过
    const b3 = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    b3[0][0] = BLACK;
    b3[0][1] = WHITE;
    const m3 = logic.getValidMoves(b3, 0, 0);
    assert.ok(!m3.some(([x, y]) => x === 0 && y === 1), '不可落入 (0,1)');
    assert.ok(!m3.some(([x, y]) => x === 0 && y === 2), '不可越过敌子');
    assert.ok(m3.some(([x, y]) => x === 2 && y === 0), '可沿空行走 (2,0)');
});

test('夹：落点两端为己-敌-己时转化中间敌子', () => {
    // 构造：黑子在 (0,1)，白子在 (1,1)，落黑子在 (2,1) → 夹住 (1,1)
    const b = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    b[0][1] = BLACK;
    b[1][1] = WHITE;
    const caps = logic.findCapturesOnBoard(b, 2, 1, BLACK);
    assert.ok(caps.some(([x, y]) => x === 1 && y === 1));
});

test('挑：落点两侧均为敌子时转化两侧', () => {
    const b = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    b[0][1] = WHITE;
    b[2][1] = WHITE;
    const caps = logic.findCapturesOnBoard(b, 1, 1, BLACK);
    assert.equal(caps.length, 2);
    assert.ok(caps.some(([x, y]) => x === 0 && y === 1));
    assert.ok(caps.some(([x, y]) => x === 2 && y === 1));
});

test('连锁预估：夹 1 子的走子估值为 1（BFS 逐波不误判）', () => {
    // 黑在 (0,1)，白在 (1,1)，黑落子 (2,1) → 夹中 (1,1)，恰好 1 枚
    const b = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
    b[0][1] = BLACK;
    b[1][1] = WHITE;
    const est = logic.estimateCaptureCountAfterMove(b, { fx: 2, fy: 1, tx: 2, ty: 1 }, BLACK);
    assert.equal(est, 1);
});

test('AI：返回的走子一定合法', () => {
    const b = logic.initialBoard();
    const m = logic.chooseAiMove(b, BLACK);
    assert.ok(m, '黑方初始必有合法着法');
    assert.equal(b[m.fx][m.fy], BLACK);
    assert.equal(b[m.tx][m.ty], EMPTY);
    const legal = logic.getValidMoves(b, m.fx, m.fy);
    assert.ok(legal.some(([x, y]) => x === m.tx && y === m.ty));
});

test('hasAnyMove：全满棋盘双方均无法移动', () => {
    const b = Array.from({ length: GRID }, () => Array(GRID).fill(BLACK));
    assert.equal(logic.hasAnyMove(b, BLACK), false);
    assert.equal(logic.hasAnyMove(b, WHITE), false);
});
