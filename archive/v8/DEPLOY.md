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
1. 都进入 `http://127.0.0.1:8765/index.html`
2. 切换到“在线对战”
3. 服务器地址填写：`ws://127.0.0.1:8080`
4. 房间号填写相同（如 `1001`）
5. 点击“连接房间”

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

当前前端支持直接输入 WebSocket 地址：

- 本地：`ws://127.0.0.1:8080`
- 公网（Nginx 反代）：`wss://game.example.com/ws`

如使用 HTTPS 页面，务必使用 `wss://`，否则浏览器会拦截混合内容。

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

---

## 7. 一键启动（本地）

你可以开两个终端分别执行：

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
