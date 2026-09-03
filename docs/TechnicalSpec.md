# 夹挑棋 技术版本（给开发）

## 1. 文档目标

本文件定义当前版本的实现结构、状态模型、核心算法、在线协议与部署约束，用于开发和维护。

---

## 2. 项目结构

- 前端主文件：index.html
- 在线服务：online-server.js
- 依赖定义：package.json
- 设计总览：GameDesign.md
- 部署说明：DEPLOY.md

---

## 3. 前端架构

### 3.1 技术栈

- 原生 HTML + CSS + JavaScript
- Canvas 绘制棋盘与棋子
- Web Audio API 生成音效
- WebSocket 进行在线模式通信

### 3.2 核心状态

- board：5×5 棋盘二维数组（0 空、1 黑、2 白）
- curPlayer：当前行棋方
- selPiece / validMoves：选中棋子与合法落点
- lastMove：最后一步标记
- gameOver：是否已结算
- isAnimating：是否处于动画中
- animCapture：吃子动画临时状态
- winAnim：获胜动画状态
- gameMode：pvp / ai / online
- aiThinking：AI 思考标记
- onlineSocket / onlineConnected / onlineRoomId / onlinePlayerColor / onlinePlayersCount：在线状态

> 版本常量：`index.html` 顶部 `APP_VERSION`（页面底部展示「夹挑棋 vX.Y.Z」）。
> 发版时须与 `package.json` / `package-lock.json` 的 `version` 同步（见根 README「版本」章节）。

### 3.3 棋盘拓扑

- 预构建 allLines（5 横 + 5 纵 + 6 斜）
- 预构建 ptLines（点到线索引）
- 合法移动与吃子判定均基于线性拓扑，不做几何推断

---

## 4. 核心规则实现

### 4.1 合法移动

函数：getValidMoves

- 输入：起点 (x,y)
- 沿起点所属每条线的双向扫描
- 遇阻即停止该方向
- 收集空点作为合法落点

### 4.2 吃子判定

函数：findCaptures / findCapturesOnBoard

判定模式：
- 夹：me-enemy-me（两侧方向分别判断）
- 挑：enemy-me-enemy（中心判断）

输出去重后的待转换点集合。

### 4.3 连锁处理

函数：doMove + playCaptureStep

- 移动后使用 BFS 链式处理
- 每层作为“连锁第 N 步”
- 每步执行动画：提示 -> 置灰闪烁 -> 转色 -> 停顿

### 4.4 胜负判定

- 子数判定：一方为 0 则失败
- 无路可走判定：checkNoMoveLossForCurrentPlayer

---

## 5. 模式实现

### 5.1 本地双人

- isHumanTurn 恒成立
- 本地双方均可操作

### 5.2 人机模式

- AI 颜色固定为 WHITE
- 玩家落子后触发 triggerAiMoveIfNeeded
- chooseAiMove 为启发式评分：
  - 吃子收益（高权重）
  - 中心距离
  - 前进趋势

### 5.3 在线模式

- 前端通过 WebSocket 与 online-server.js 通信
- 在线模式只允许 curPlayer === onlinePlayerColor 时落子
- 本地完成落子后发送 move 消息
- 接收对端 move 后调用 applyRemoteMove 回放

---

## 6. 在线协议（前后端）

### 6.1 客户端 -> 服务端

- join
  - 字段：type, roomId
- move
  - 字段：type, roomId, move{fx,fy,tx,ty}
- restart
  - 字段：type, roomId
- surrender
  - 字段：type, roomId, winnerPiece, message

### 6.2 服务端 -> 客户端

- hello
- joined（包含 roomId, color, players, board, currentPlayer）
- room-update（players）
- move（对手落子）
- restart（重开同步）
- surrender（认输同步）
- peer-left（对手离线）
- error（错误消息）

### 6.3 服务端约束

- 每房最多 2 人
- 服务端做移动合法性校验
- 非回合方 move 会被拒绝
- 房间无人后自动回收

---

## 7. 音效与动画实现

### 7.1 音效

- playMoveSound：落子音
- playCaptureSound：吃子音（按本步吃子数调整音效强度）
- playWinSound：获胜短旋律

### 7.2 动画

- 吃子动画：animCapture 状态驱动
- 连锁分步：按 BFS 层播放
- 获胜动画：胜方脉冲环 + 粒子 + 顶部横幅（requestAnimationFrame 循环）

---

## 8. 部署与运行

### 8.1 本地

- 静态页面：python3 -m http.server 8765
- 在线服务：npm run start:online

### 8.2 生产

- 推荐：Nginx + PM2
- WebSocket 经 /ws 反向代理
- 详见 DEPLOY.md

---

## 9. 开发注意事项

- 保持 board 状态单一来源，避免动画期间二次写入
- 在线模式必须以服务端校验为准，前端仅做交互限制
- 动画期间要锁输入（isAnimating）防止竞争条件
- 扩展 AI 时建议先保留现有启发式作为回退策略

---

## 10. 平台化层（M2，开发中，feat/m2）

### 10.1 服务架构

- `server.js`：单端口全功能入口（HTTP 静态 + REST `/api` + WebSocket `/ws`），启动时打开 SQLite
- `shared/app.js`：应用工厂 `createApp({store, staticDir})`，便于测试进程内创建实例；内含 REST 路由、房间/对局逻辑与对局落库
- `shared/db.js`：better-sqlite3 数据层，表：`players` / `sessions` / `games` / `moves`
- `online-server.js` 保留为旧版 WS-only 服务（历史兼容，新功能以 server.js 为准）

### 10.2 REST 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/guest | 创建游客身份，返回 token + player |
| POST | /api/register | 游客升级账号（username + 密码盐哈希） |
| POST | /api/login | 登录换新 token |
| POST | /api/logout | 注销会话 |
| GET | /api/me | 当前身份（Bearer token） |
| PATCH | /api/profile | 更新 nick / avatar |
| GET | /api/games | 对局列表（默认 50） |
| GET | /api/games/:id | 对局详情 + moves（回放数据源） |

### 10.3 在线对局存档

- WebSocket `join` 消息携带 `token`，服务端校验身份并记录 `playerId`（黑/白）
- 两名玩家到齐后自动创建 `games` 记录；每一步走子写入 `moves`
- 结束时机：吃光 / 无路可走 / 认输 / 重开 / 玩家离开 分别落 `result + reason`
- 前端首次进入自动 `POST /api/guest` 保持游客身份，资料保存双向同步（离线降级为本地）

---

## 11. 后续可扩展点

- AI 难度分级（随机/启发式/搜索）
- 在线断线重连与局面恢复
- 悔棋申请协议
- 对局日志与回放
- 前后端分离与类型定义共享
