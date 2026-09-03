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

> ⚠️ **重要**：以上启停脚本只管理 `server.js`（单端口合并服务）。
> 若该端口正被 **PM2 生产部署的 `online-server.js`** 占用（deploy.sh 架构），
> 请使用 `pm2 restart jiaotiaoqi-ws` / `pm2 stop jiaotiaoqi-ws`，
> 两种形态共用 8080，不要混用，否则脚本会提示“端口被其它程序占用”。

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

### Q5：如何确认线上跑的是最新版？

页面底部固定展示版本号「夹挑棋 vX.Y.Z」，用于核对线上代码新旧：

1. 打开线上页面，看底部版本号（部署后若还是旧号/看不到，说明是旧代码）
2. 与仓库当前版本比对：
   ```bash
   # 仓库权威版本：index.html 顶部常量
   grep "APP_VERSION" index.html
   # 线上版本：
   curl -s http://你的域名/ | grep -o "app-version"   # 有新页脚说明是新版
   # 或直接看线上 HTML 里携带的版本常量：
   curl -s http://你的域名/ | grep -o "APP_VERSION = '[^']*'"
   ```
3. 不一致的处理：`git pull` 只是更新代码目录，**正在服务的目录**需要另行同步
   （如 deploy.sh 的副本 `/srv/jiatiaoqi` 需 rsync，或 Nginx `root` 指到哪就同步哪），
   然后 `sudo nginx -t && sudo systemctl reload nginx`（或重启 PM2 进程）。

> 发版约束：页面版本号取自 `index.html` 顶部常量 `APP_VERSION`，每次发版须同步修改
> `package.json` / `package-lock.json` 的 `version` 字段（见根目录 README「版本」章节）。

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

---

## 9. 一键发布 / 一键上线（推荐）

发版与上线各一条命令，避免手动执行一长串操作（升版本、提交、推送、同步、重载、校验）。

### 9.1 发版（开发机/代码仓库目录）

```bash
./release.sh 1.2.0              # 升版本 + git commit + git push
./release.sh 1.2.0 --no-push    # 只升版本 + 提交，不推送
./release.sh 1.2.0 --dry-run    # 只预览会修改哪些文件，不写入
```

自动把版本号同步到 4 处：`index.html` 的 `APP_VERSION`、`package.json`、`package-lock.json`（根 + 根包）、`README.md`「当前版本」。

### 9.2 上线（服务器代码仓库目录，配 release.sh 使用）

```bash
./update.sh                               # 自动识别形态并上线
UPDATE_MODE=server.js ./update.sh         # 显式：单端口 server.js（重启 server.js）
UPDATE_MODE=pm2       ./update.sh         # 显式：PM2（pm2 restart jiaotiaoqi-ws）
UPDATE_MODE=nginx     ./update.sh         # 显式：Nginx 静态目录（另需 UPDATE_TO）
UPDATE_TO=/srv/jiatiaoqi ./update.sh      # 线上由 deploy 副本提供时指向服务目录
UPDATE_PULL=0 ./update.sh                 # 跳过 git pull（已手动拉过）
```

流程：`git pull` → 按形态让代码生效（server.js 重启 / `pm2 restart` / `rsync` 到服务目录 + nginx reload）→ 自动 `curl` 校验线上页面 `APP_VERSION` 与仓库是否一致，不一致则退出非 0 提醒。

> 说明：update.sh 需在**带 `.git` 的代码仓库**里运行；若线上由 deploy.sh 副本（如 `/srv/jiatiaoqi`）提供页面，用 `UPDATE_TO` 指定该目录（脚本会 rsync 并排除 .git/脚本/日志等）。
