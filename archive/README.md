# archive/ 历史版本快照

本目录保存 `index.html` 的演进历史，用于追溯功能如何逐步加入。
**这些快照仅作存档，不参与构建或部署**（`deploy.sh` 已将本目录排除）。

## 快照时间线

| 快照 | 主要内容 |
|------|---------|
| `index_v1.html` (612 行) | 基础棋盘 + 吃子判定（夹/挑），无动画、无音效 |
| `index_v2.html` (705 行) | 加入吃子动画与连锁分步播放 |
| `index_v3.html` (714 行) | 细节调整（与 v2 接近） |
| `index_v4.html` (803 行) | 加入 Web Audio 音效（落子/吃子/胜利） |
| `index_v5.html` (880 行) | 加入胜利动画（脉冲环 + 粒子 + 横幅） |
| `index_v6.html` (1049 行) | 加入人机对战（启发式 AI） |
| `v7/` (完整快照) | 加入在线对战（WebSocket 房间制），含 server/client 全套文件 |
| `v8/` (完整快照) | 文档体系成型（加 PRD/TechSpec/DEPLOY/专利），代码与 v7 相同 |

## 当前生产版本

根目录的 `index.html` 与 `v7/`、`v8/` 中的 `index.html` **内容完全一致**（已校验）。
即 v7/v8 之后的改动都是文档层面的组织，代码本身未再变化。

## 如何对比某个版本

```bash
# 例：看 v6 相比 v5 新增了什么
diff index_v5.html index_v6.html | less

# 例：看当前版本与 v8 的差异
diff ../index.html v8/index.html
```
