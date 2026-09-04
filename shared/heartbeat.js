// 夹挑棋 · WebSocket 协议级心跳（服务端）
// 官方推荐模式：每 intervalMs 向所有客户端 ping（浏览器/ws 协议栈自动回 pong）；
// 若上一轮 pong 未收到（isAlive === false）判定半开连接，terminate 释放。
// 作用：
//   1) 保活：即使对局中长时间无人落子，也持续有流量，避免 Nginx/网关空闲超时掐断
//   2) 清理半开连接（网络断了但 TCP 未感知），让房间人数及时收敛
// 客户端无需为协议级 ping 写代码（自动应答）；应用层 ping/pong 另见 index.html。

function attachHeartbeat(wss, intervalMs = 30000, { onTerminate } = {}) {
    const timer = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                if (onTerminate) onTerminate(ws);
                ws.terminate();
                return;
            }
            ws.isAlive = false;
            try {
                ws.ping();
            } catch (e) { /* 连接可能已关闭 */ }
        });
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref(); // 不阻塞进程退出

    wss.on('connection', (ws) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
    });

    wss.on('close', () => clearInterval(timer));

    return timer;
}

module.exports = { attachHeartbeat };
