# 夹挑棋 部署说明

本文档说明如何部署本项目：
- 前端页面（`index.html`）
- 在线对战服务（`online-server.js`，WebSocket）

---

## 1. 环境要求

- Node.js 18+（建议 20+）
- npm 9+
- Linux / macOS / Windows 均可

检查版本：

```bash
node -v
npm -v
```

---

## 2. 获取代码并安装依赖

在项目根目录执行：

```bash
npm install
```

安装完成后会得到 `ws` 依赖（在线对战服务所需）。

---

## 3. 本地开发运行（最简单）

### 3.1 启动前端静态服务

在项目目录执行任一方式：

```bash
python3 -m http.server 8765
```

或

```bash
npx serve . -l 8765
```

浏览器访问：

- http://127.0.0.1:8765/index.html

### 3.2 启动在线对战服务（WebSocket）

新开一个终端，在项目目录执行：

```bash
npm run start:online
```

默认监听：

- `ws://127.0.0.1:8080`

### 3.3 本地联机测试

打开两个浏览器窗口：
1. 都进入 `http://127.0.0.1:8765/index.html`（或直接 `node server.js` 后访问 `http://127.0.0.1:8080`）
2. 切换到“在线对战”
3. 房间号填写相同（如 `1001`）
4. 点击“连接房间”

> 服务器地址**无需手动填写**：前端会从当前页面 URL 自动推导（同源 `/ws`）。
> 仅当 WS 服务不在同一台机器时才需要点「高级设置」展开手动填写。

### 3.4 单端口合并服务（推荐：本机 / 局域网，含启停脚本）

不想开两个进程时，可用 `server.js` 把静态页面与 WebSocket 合并到**同一个端口**（默认 8080），适合本机双开浏览器、局域网对战，以及 Tailscale Funnel / Cloudflare Tunnel 等单端口隧道方案。

项目根目录提供一键启停脚本（Linux/macOS），自动定位进程、**不依赖写死的 PID**：

```bash
./start-server.sh      # 启动（HTTP + WebSocket，默认端口 8080）
./stop-server.sh       # 停止
./restart-server.sh    # 重启
PORT=9000 ./start-server.sh   # 自定义端口（启停需保持一致）
```

等价的手动方式：

```bash
# 启动（后台运行，日志写入 server.log）
nohup node server.js > server.log 2>&1 &

# 停止（按进程名/端口定位，不要依赖固定 PID）
pkill -f "node server.js"        # 或 kill $(cat .server.pid)
```

- 日志：`server.log`（`tail -f server.log` 跟踪）
- 进程记录：`.server.pid`（由 `start-server.sh` 自动写入/清理，已加入 `.gitignore`）
- **何时需要重启**：只有改动服务端代码（`server.js` / `online-server.js`）才需重启；改动前端 `index.html` 直接刷新浏览器即可（服务端每次请求实时读文件）。

---

## 4. 生产部署（推荐：Nginx + PM2）

适用于云服务器公网部署。

### 4.1 目录准备

将项目放到例如：

- `/srv/jiaotiaoqi`

并安装依赖：

```bash
cd /srv/jiaotiaoqi
npm install --production
```

### 4.2 使用 PM2 守护 WebSocket 服务

安装 PM2：

```bash
npm i -g pm2
```

启动服务：

```bash
cd /srv/jiaotiaoqi
pm2 start online-server.js --name jiaotiaoqi-ws
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 ls
pm2 logs jiaotiaoqi-ws
```

### 4.3 Nginx 配置（静态页面 + WebSocket 反向代理）

示例域名：`game.example.com`

```nginx
server {
    listen 80;
    server_name game.example.com;

    root /srv/jiaotiaoqi;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # WebSocket 代理：前端通过 ws(s)://game.example.com/ws 连接
    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

生效配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

> 若启用 HTTPS（推荐），前端请使用 `wss://game.example.com/ws`。

---

## 5. 前端在线模式连接地址说明

前端会**自动推导** WebSocket 地址，普通用户无需手动填写：

| 部署方式 | 页面地址 | 自动推导的 WS 地址 |
|---------|---------|-------------------|
| Nginx 反代 | `http://ip` 或 `https://域名` | `ws(s)://同源/ws` |
| 单端口 server.js | `http://ip:8080` | `ws://ip:8080/ws` |
| Electron 桌面版 | `file://` | `ws://127.0.0.1:8080` |
| 本地开发静态服务器 | `http://127.0.0.1:8765` | `ws://127.0.0.1:8080` |

仅当 WS 服务与页面**不在同一台机器**时，才需点「高级设置」手动填写，如 `ws://127.0.0.1:8080`。

如使用 HTTPS 页面，务必使用 `wss://`，否则浏览器会拦截混合内容（同源推导会自动处理）。

---

## 6. 常见问题

### Q1：在线模式连接不上

检查：
1. `online-server.js` 是否在运行
2. 防火墙/安全组是否放行端口（若直连 8080）
3. 若走 Nginx，`/ws` 反代是否配置了 Upgrade 头
4. 页面是 HTTPS 时，WebSocket 地址必须是 `wss://`

### Q2：房间加入失败（房间已满）

- 每个房间最多 2 人，换一个房间号即可。

### Q3：刷新页面后断线

- 当前版本为无状态房间，刷新会断开重连。
- 断线后重新输入房间号连接即可。

### Q4：如何停止 / 重启服务？

- **本机 server.js（单端口）**：`./stop-server.sh` / `./restart-server.sh`（见 3.4）
- **生产 PM2**：`pm2 restart jiaotiaoqi-ws` / `pm2 stop jiaotiaoqi-ws`（见 4.2）
- 前端改动无需重启服务，刷新浏览器即生效。

---

## 7. 一键启动（本地）

### 方式一：单端口（推荐）

```bash
cd /home/zhouanchao/Project/ChessGame
./start-server.sh          # 或 PORT=xxxx ./start-server.sh
```

访问 http://127.0.0.1:8080。

### 方式二：双进程（静态页 + WS 分开）

终端 A：

```bash
cd /home/zhouanchao/Project/ChessGame
python3 -m http.server 8765
```

终端 B：

```bash
cd /home/zhouanchao/Project/ChessGame
npm run start:online
```

然后访问：

- http://127.0.0.1:8765/index.html

---

## 8. 当前服务端口清单

- 前端静态页面：`8765`（示例）
- 在线对战 WebSocket：`8080`（默认）

如需修改 WebSocket 端口，可这样启动：

```bash
PORT=9000 npm run start:online
```

前端在线模式地址对应改为：

- `ws://127.0.0.1:9000`
