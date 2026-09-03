# docs/ 开发文档

本目录存放面向开发、产品、测试的文档。专利申请文档在 [`../patent/`](../patent)。

## 按角色/目的索引

### 我是新人，想了解这个项目
1. 先看 [GameDesign.md](GameDesign.md) —— 游戏是什么、棋盘长什么样、规则是什么
2. 再看 [TechnicalSpec.md](TechnicalSpec.md) 的「项目结构」与「核心状态」章节

### 我要改代码
- **架构、状态模型、核心算法**：[TechnicalSpec.md](TechnicalSpec.md)
  - 棋盘拓扑（`allLines` / `ptLines`）
  - 合法移动（`getValidMoves`）、吃子判定（`findCaptures`）、连锁（BFS）
  - 在线协议（`join` / `move` / `restart` / `surrender`）
  - AI 启发式评分
- 源码：[`../index.html`](../index.html)（前端）、[`../online-server.js`](../online-server.js)（服务端）

### 我要做产品/验收
- **需求范围、交互、验收标准**：[ProductRequirements.md](ProductRequirements.md)

### 我要部署
- **本地运行 / 生产部署（Nginx + PM2）**：[DEPLOY.md](DEPLOY.md)
- 一键脚本：[`../deploy.sh`](../deploy.sh)
- 本机/局域网一键启停：[`../start-server.sh`](../start-server.sh)、[`../stop-server.sh`](../stop-server.sh)、[`../restart-server.sh`](../restart-server.sh)（见 DEPLOY.md §3.4）

### 我要上架微信小游戏
- **小游戏代码与运行**：[`../minigame/README.md`](../minigame/README.md)
- **上架资质、软著、广告位清单**：[MinigamePublish.md](MinigamePublish.md)

## 文档清单

| 文件 | 受众 | 内容 |
|------|------|------|
| [GameDesign.md](GameDesign.md) | 全员 | 游戏设计的权威定义：棋盘、规则、模式、交互、音效 |
| [GameDesign.pdf](GameDesign.pdf) | 全员 | 上者的 PDF 导出版 |
| [ProductRequirements.md](ProductRequirements.md) | 产品/测试 | 需求范围、界面交互、验收标准 |
| [TechnicalSpec.md](TechnicalSpec.md) | 开发 | 架构、状态、算法、在线协议、注意事项 |
| [DEPLOY.md](DEPLOY.md) | 运维/开发 | 本地与生产部署、端口、Nginx 配置 |
| [MinigamePublish.md](MinigamePublish.md) | 运营/开发 | 微信小游戏上架：主体、软著、类目、广告位、审核 |

## 维护约定

- 修改代码行为时，同步更新 [TechnicalSpec.md](TechnicalSpec.md) 对应章节
- 调整游戏规则或界面时，同步更新 [GameDesign.md](GameDesign.md) 与 [ProductRequirements.md](ProductRequirements.md)
- 改动部署方式时，同步更新 [DEPLOY.md](DEPLOY.md) 与根目录 `deploy.sh`
