# 夹挑棋（ChessGame）

一款基于 5×5 交叉点连线棋盘的双人回合制策略网页棋类游戏。核心玩法是通过 **夹**（己-敌-己）、**挑**（敌-己-敌）与 **连锁转换** 吃掉对方棋子取胜。

支持三种对战模式：本地双人、人机对战、在线对战。

- **网页版**：原生 HTML + CSS + JavaScript（Canvas 绘制）+ Web Audio API；在线服务用 Node.js + `ws`
- **桌面版**：Electron 打包，独立窗口应用（Linux），一条命令启动，含在线对战服务
- **小游戏版**：微信小游戏（Canvas + JS），共享同一份规则逻辑，见 [`minigame/`](minigame)

---

## 版本

当前版本：**v1.1.0**（页面底部展示「夹挑棋 vX.Y.Z」）。

版本号用于判断浏览器里跑的是否为最新代码——部署后若页面底部版本与仓库不一致，说明线上是旧版本，需重新部署（见 [`docs/DEPLOY.md`](docs/DEPLOY.md)）。

发版时请同步修改以下两处：
- `index.html` 顶部常量 `APP_VERSION`（权威源，页面底部自动显示）
- `package.json` / `package-lock.json` 的 `version` 字段

---

## 快速开始

### 桌面应用（推荐，最快）

```bash
# 安装依赖（首次）
npm install

# 启动桌面应用
npm run desktop
```

弹出独立窗口，直接下棋。在线对战功能也内置可用（WebSocket 服务自动随应用启动）。

### 网页版（也可以）

```bash
# 方式一：Python（任一都行）
python3 -m http.server 8765

# 方式二：npx
npx serve . -l 8765
```

浏览器访问 → http://127.0.0.1:8765/index.html

### Linux/macOS：单端口服务一键启停（推荐本机/局域网用）

页面与在线对战共用同一端口（默认 8080），自带脚本自动定位进程，不依赖写死的 PID：

```bash
./start-server.sh      # 启动（HTTP + WebSocket）
./stop-server.sh       # 停止
./restart-server.sh    # 重启
PORT=9000 ./start-server.sh   # 自定义端口（启停需保持一致）
```

启动后访问 http://127.0.0.1:8080，日志写入 `server.log`。

### 2. 启动在线对战服务（仅在线模式需要）

```bash
npm install        # 首次运行安装 ws 依赖
npm run start:online   # 默认监听 ws://127.0.0.1:8080
```

在线模式连接地址填 `ws://127.0.0.1:8080`，两个浏览器窗口用相同房间号即可对战。

> 生产部署（Nginx + PM2 + wss 反代）见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

---

## 目录结构

```
ChessGame/
├── README.md                # 本文件
├── index.html               # 前端主程序（棋盘、规则、AI、在线客户端）
├── electron-main.js         # Electron 桌面版入口
├── online-server.js         # 在线对战 WebSocket 服务端
├── package.json             # 依赖 ws + electron
├── deploy.sh                # 一键部署脚本
│
├── minigame/                # 微信小游戏版（Canvas + JS，共享规则逻辑）
│   ├── game.js              #   入口
│   └── js/                  #   logic/render/ui/input/audio/ad
│
├── docs/                    # 开发文档
│   ├── GameDesign.md        #   游戏设计（规则、棋盘、交互的完整定义）
│   ├── GameDesign.pdf       #   设计文档 PDF 版
│   ├── ProductRequirements.md   # 产品需求（面向产品/测试）
│   ├── TechnicalSpec.md     # 技术规格（面向开发：架构、算法、在线协议）
│   ├── DEPLOY.md            # 部署说明
│   └── MinigamePublish.md   # 微信小游戏上架手册（资质/软著/广告位）
│
├── patent/                  # 发明专利申请文档（独立交付物）
│   ├── 专利技术交底书_夹挑棋.md
│   ├── 发明专利权利要求书_夹挑棋.md
│   ├── 发明专利说明书_夹挑棋.md
│   ├── 专利摘要及摘要附图说明_夹挑棋.md
│   ├── 专利代理提交清单_夹挑棋.md
│   └── 专利文稿术语与编号统一规范_夹挑棋.md
│
├── archive/                 # 历史版本快照（index_v1~v6 + v7/v8）
└── node_modules/
```

---

## 文档导航

| 我想了解…… | 看哪里 |
|---|---|
| 游戏是什么、有哪些规则 | [`docs/GameDesign.md`](docs/GameDesign.md) |
| 产品范围、交互、验收标准 | [`docs/ProductRequirements.md`](docs/ProductRequirements.md) |
| 架构、核心算法、在线协议 | [`docs/TechnicalSpec.md`](docs/TechnicalSpec.md) |
| 怎么部署到服务器 | [`docs/DEPLOY.md`](docs/DEPLOY.md) |
| 怎么上架微信小游戏 | [`minigame/README.md`](minigame/README.md) + [`docs/MinigamePublish.md`](docs/MinigamePublish.md) |
| 专利申请相关 | [`patent/`](patent) 目录下 6 份文稿 |

---

## 核心规则速览

- **棋盘**：5×5 交叉点，含横线、纵线、交替对角线；黑方占底行、白方占顶行，黑先手
- **移动**：沿有连线方向走任意距离，路径不能被棋子阻挡，落点必须为空
- **吃子**：
  - **夹**：落子形成「己-敌-己」，中间敌子变己方
  - **挑**：落子形成「敌-己-敌」，两侧敌子变己方
  - **连锁**：新转换的棋子若再形成夹/挑，继续触发，直至无新增
- **胜负**：一方棋子被吃光，或轮到该方时所有棋子都无路可走，则该方负

完整规则与图示见 [`docs/GameDesign.md`](docs/GameDesign.md)。
