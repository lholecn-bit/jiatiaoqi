const WebSocket = require('ws');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const GRID = 5;

const allLines = buildLines();
const ptLines = buildPointLines(allLines);
const rooms = new Map();

const wss = new WebSocket.Server({ port: PORT });

function createInitialBoard() {
  const board = Array.from({ length: GRID }, () => Array(GRID).fill(EMPTY));
  for (let x = 0; x < GRID; x++) board[x][0] = BLACK;
  for (let x = 0; x < GRID; x++) board[x][4] = WHITE;
  return board;
}

function createRoom(roomId) {
  return {
    roomId,
    clients: new Set(),
    board: createInitialBoard(),
    currentPlayer: BLACK,
    gameOver: false,
  };
}

function buildLines() {
  const lines = [];
  for (let y = 0; y < GRID; y++) {
    const line = [];
    for (let x = 0; x < GRID; x++) line.push([x, y]);
    lines.push(line);
  }
  for (let x = 0; x < GRID; x++) {
    const line = [];
    for (let y = 0; y < GRID; y++) line.push([x, y]);
    lines.push(line);
  }
  lines.push([[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]]);
  lines.push([[0, 2], [1, 1], [2, 0]]);
  lines.push([[2, 4], [3, 3], [4, 2]]);
  lines.push([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  lines.push([[0, 2], [1, 3], [2, 4]]);
  lines.push([[2, 0], [3, 1], [4, 2]]);
  return lines;
}

function buildPointLines(lines) {
  const map = new Map();
  for (let li = 0; li < lines.length; li++) {
    for (let pi = 0; pi < lines[li].length; pi++) {
      const [x, y] = lines[li][pi];
      const key = `${x},${y}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ li, pi });
    }
  }
  return map;
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload) {
  for (const client of room.clients) {
    send(client, payload);
  }
}

function broadcastExcept(room, excludedClient, payload) {
  for (const client of room.clients) {
    if (client === excludedClient) continue;
    send(client, payload);
  }
}

function getValidMoves(board, x, y) {
  const moves = [];
  const entries = ptLines.get(`${x},${y}`) || [];
  for (const { li, pi } of entries) {
    const line = allLines[li];
    for (let i = pi + 1; i < line.length; i++) {
      const [tx, ty] = line[i];
      if (board[tx][ty] !== EMPTY) break;
      moves.push([tx, ty]);
    }
    for (let i = pi - 1; i >= 0; i--) {
      const [tx, ty] = line[i];
      if (board[tx][ty] !== EMPTY) break;
      moves.push([tx, ty]);
    }
  }
  return moves;
}

function hasAnyMove(board, player) {
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if (board[x][y] === player && getValidMoves(board, x, y).length > 0) {
        return true;
      }
    }
  }
  return false;
}

function findCaptures(board, x, y, player) {
  const enemy = player === BLACK ? WHITE : BLACK;
  const captures = [];
  const entries = ptLines.get(`${x},${y}`) || [];

  for (const { li, pi } of entries) {
    const line = allLines[li];

    if (pi + 2 < line.length) {
      const [ax, ay] = line[pi + 1];
      const [bx, by] = line[pi + 2];
      if (board[ax][ay] === enemy && board[bx][by] === player) captures.push([ax, ay]);
    }

    if (pi - 2 >= 0) {
      const [ax, ay] = line[pi - 1];
      const [bx, by] = line[pi - 2];
      if (board[ax][ay] === enemy && board[bx][by] === player) captures.push([ax, ay]);
    }

    if (pi - 1 >= 0 && pi + 1 < line.length) {
      const [ax, ay] = line[pi - 1];
      const [bx, by] = line[pi + 1];
      if (board[ax][ay] === enemy && board[bx][by] === enemy) captures.push([ax, ay], [bx, by]);
    }
  }

  const dedup = [];
  const seen = new Set();
  for (const [cx, cy] of captures) {
    const key = `${cx},${cy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push([cx, cy]);
  }
  return dedup;
}

function countPieces(board) {
  let black = 0;
  let white = 0;
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      if (board[x][y] === BLACK) black++;
      if (board[x][y] === WHITE) white++;
    }
  }
  return { black, white };
}

function applyMove(room, move, player) {
  const { fx, fy, tx, ty } = move;
  const board = room.board;

  if (
    !Number.isInteger(fx) || !Number.isInteger(fy) ||
    !Number.isInteger(tx) || !Number.isInteger(ty) ||
    fx < 0 || fx >= GRID || fy < 0 || fy >= GRID ||
    tx < 0 || tx >= GRID || ty < 0 || ty >= GRID
  ) {
    return { ok: false, message: '坐标非法' };
  }

  if (board[fx][fy] !== player) {
    return { ok: false, message: '非法棋子' };
  }
  if (board[tx][ty] !== EMPTY) {
    return { ok: false, message: '目标位置非空' };
  }

  const legalTargets = getValidMoves(board, fx, fy);
  if (!legalTargets.some(([x, y]) => x === tx && y === ty)) {
    return { ok: false, message: '移动路径非法' };
  }

  board[fx][fy] = EMPTY;
  board[tx][ty] = player;

  let queue = [[tx, ty]];
  while (queue.length > 0) {
    const next = [];
    const seen = new Set();
    for (const [qx, qy] of queue) {
      const captures = findCaptures(board, qx, qy, player);
      for (const [cx, cy] of captures) {
        const key = `${cx},${cy}`;
        if (board[cx][cy] !== player && !seen.has(key)) {
          seen.add(key);
          board[cx][cy] = player;
          next.push([cx, cy]);
        }
      }
    }
    queue = next;
  }

  const counts = countPieces(board);
  if (counts.black === 0 || counts.white === 0) {
    room.gameOver = true;
  } else {
    room.currentPlayer = room.currentPlayer === BLACK ? WHITE : BLACK;
    if (!hasAnyMove(board, room.currentPlayer)) {
      room.gameOver = true;
    }
  }

  return { ok: true };
}

function chooseColor(room) {
  const used = new Set();
  for (const client of room.clients) {
    if (client.meta && client.meta.color) used.add(client.meta.color);
  }
  if (!used.has(BLACK)) return BLACK;
  if (!used.has(WHITE)) return WHITE;
  return null;
}

function handleJoin(ws, roomIdRaw) {
  const roomId = String(roomIdRaw || '').trim();
  if (!roomId) {
    send(ws, { type: 'error', message: '房间号不能为空' });
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
    rooms.set(roomId, room);
  }

  if (room.clients.size >= 2) {
    send(ws, { type: 'error', message: '房间已满（最多2人）' });
    return;
  }

  const color = chooseColor(room);
  if (color == null) {
    send(ws, { type: 'error', message: '无法分配棋子颜色' });
    return;
  }

  room.clients.add(ws);
  ws.meta = { roomId, color };

  send(ws, {
    type: 'joined',
    roomId,
    color,
    players: room.clients.size,
    board: room.board,
    currentPlayer: room.currentPlayer,
  });

  broadcast(room, { type: 'room-update', roomId, players: room.clients.size });
}

function handleMessage(ws, raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    send(ws, { type: 'error', message: '消息格式错误' });
    return;
  }

  if (payload.type === 'join') {
    handleJoin(ws, payload.roomId);
    return;
  }

  if (!ws.meta || !ws.meta.roomId) {
    send(ws, { type: 'error', message: '请先加入房间' });
    return;
  }

  const room = rooms.get(ws.meta.roomId);
  if (!room) {
    send(ws, { type: 'error', message: '房间不存在' });
    return;
  }

  if (payload.type === 'move') {
    if (room.gameOver) {
      send(ws, { type: 'error', message: '对局已结束，请重开' });
      return;
    }
    if (ws.meta.color !== room.currentPlayer) {
      send(ws, { type: 'error', message: '尚未轮到你走棋' });
      return;
    }
    const result = applyMove(room, payload.move || {}, ws.meta.color);
    if (!result.ok) {
      send(ws, { type: 'error', message: result.message });
      return;
    }

    broadcastExcept(room, ws, {
      type: 'move',
      roomId: room.roomId,
      move: payload.move,
      currentPlayer: room.currentPlayer,
      gameOver: room.gameOver,
    });
    return;
  }

  if (payload.type === 'restart') {
    room.board = createInitialBoard();
    room.currentPlayer = BLACK;
    room.gameOver = false;
    broadcastExcept(room, ws, {
      type: 'restart',
      roomId: room.roomId,
      board: room.board,
      currentPlayer: room.currentPlayer,
    });
    return;
  }

  if (payload.type === 'surrender') {
    room.gameOver = true;
    broadcastExcept(room, ws, {
      type: 'surrender',
      roomId: room.roomId,
      winnerPiece: payload.winnerPiece,
      message: payload.message || '一方认输，对局结束',
    });
  }
}

function handleClose(ws) {
  if (!ws.meta || !ws.meta.roomId) return;
  const room = rooms.get(ws.meta.roomId);
  if (!room) return;

  room.clients.delete(ws);

  if (room.clients.size === 0) {
    rooms.delete(room.roomId);
    return;
  }

  broadcast(room, { type: 'peer-left', roomId: room.roomId });
  broadcast(room, { type: 'room-update', roomId: room.roomId, players: room.clients.size });
}

wss.on('connection', (ws) => {
  ws.meta = null;
  send(ws, { type: 'hello', message: 'connected' });

  ws.on('message', (data) => {
    handleMessage(ws, data.toString());
  });

  ws.on('close', () => {
    handleClose(ws);
  });
});

console.log(`Online server is running on ws://0.0.0.0:${PORT}`);
