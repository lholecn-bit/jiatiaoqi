// 夹挑棋 · Electron 桌面版入口
// 启动方式：npm run desktop
// 窗口内加载现有的 index.html（无需任何修改）

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// Linux 沙箱兼容：Chromium sandbox 需要 SUID 权限，本地游戏用 --no-sandbox
app.commandLine.appendSwitch('no-sandbox');

let mainWindow = null;
let wsServer = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 540,
        height: 780,
        resizable: true,
        title: '夹挑棋',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // 加载本地 index.html
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // 禁止导航到外部（保持单页应用体验）
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 启动在线对战 WebSocket 服务（可选：本地双人/人机不需要，但开着无妨）
function startWsServer() {
    try {
        // 默认端口 8080，可通过环境变量覆盖
        wsServer = fork(path.join(__dirname, 'online-server.js'), [], {
            env: { ...process.env, PORT: process.env.WS_PORT || '8080' },
            silent: true,
        });
        wsServer.stdout.on('data', (data) => {
            console.log('[ws-server]', data.toString().trim());
        });
        wsServer.stderr.on('data', (data) => {
            console.error('[ws-server]', data.toString().trim());
        });
        console.log('[desktop] WebSocket 服务已启动 (ws://127.0.0.1:8080)');
    } catch (err) {
        console.warn('[desktop] WebSocket 服务启动失败（在线对战不可用）:', err.message);
    }
}

app.whenReady().then(() => {
    startWsServer();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (wsServer) {
        wsServer.kill();
        wsServer = null;
    }
    app.quit();
});
