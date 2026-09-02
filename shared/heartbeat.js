// 夹挑棋 · WebSocket 协议级心跳（服务端）
// 基于 ws 库官方推荐模式：
//   - 每 intervalMs 向所有客户端 ping（浏览器协议栈会自动回 pong）
//   - 若上一轮 pong 未收到（isAlive === false），判定连接已死，terminate 释放
// 作用：清理半开连接（网络断开但 TCP 未感知），让房间人数及时正确。
// 客户端无需配合（协议层自动应答），也无需在浏览器端写任何代码。

function attachHeartbeat(wss, intervalMs = 30000) {
    const timer = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                ws.terminate();
                return;
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, intervalMs);

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
    });

    wss.on('close', () => clearInterval(timer));

    return timer;
}

module.exports = { attachHeartbeat };
