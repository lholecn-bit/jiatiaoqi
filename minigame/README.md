# 夹挑棋 · 微信小游戏版

本目录是夹挑棋的**微信小游戏**实现，与网页版（根目录 `index.html`）平行存在、互不干扰。
两者**共享同一份纯规则逻辑** [`js/logic.js`](js/logic.js)，保证行为一致。

- **形态**：微信小游戏（Canvas + JS，非小程序 WXML）
- **模式**：本地双人、人机对战（暂不含在线对战）
- **变现**：激励视频广告（[`js/ad.js`](js/ad.js)）

## 目录结构

```
minigame/
├── game.js                      # 入口：Canvas 初始化、状态机、游戏循环、输入分发
├── game.json                    # 小游戏配置（竖屏、隐藏状态栏）
├── project.config.json          # 项目配置（AppID、类型 miniGame）
├── upload.js                    # ★ 命令行上传/预览脚本（miniprogram-ci）
├── private.config.example.js    # 上传配置模板（复制为 private.config.js 后填写）
├── package.json                 # npm 脚本与 miniprogram-ci 依赖
├── .gitignore                   # 保护 private.config.js / *.key
├── js/
│   ├── logic.js                 # ★ 纯规则逻辑（与网页版共享，无平台依赖）
│   ├── render.js                # 棋盘/棋子/动画绘制（draw 移植自网页版）
│   ├── ui.js                    # Canvas 内状态栏、按钮、胜负弹层 + 触摸命中
│   ├── input.js                 # wx.onTouchStart → 按钮/棋格分发
│   ├── audio.js                 # WebAudio 音效合成（wx.createWebAudioContext）
│   └── ad.js                    # 激励视频广告（wx.createRewardedVideoAd）
└── README.md
```

## 本地开发

> ⚠️ 微信开发者工具**只有 Windows / macOS 版**，无官方 Linux 版。Linux 上的完整工作流见下方「命令行上传」。

### 方式 A：开发者工具（Windows / macOS）

1. 下载稳定版：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>
2. 打开开发者工具 → 导入项目 → 目录选 **本 `minigame/` 目录** → 填入 AppID → 项目类型选**小游戏**
3. 模拟器自动加载 `game.js` 运行；真机预览点「预览」扫码

### 方式 B：命令行上传（Linux 原生支持，无需 GUI 工具）

用官方 [`miniprogram-ci`](https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html) 在 Linux 上直接生成体验版二维码 / 上传代码。**全程不依赖开发者工具。**

**一次性配置：**

```bash
cd minigame
npm install                      # 安装 miniprogram-ci

# 1. 复制配置模板
cp private.config.example.js private.config.js

# 2. 编辑 private.config.js，填入：
#    - appid：你的 AppID（wx 开头）
#    - privateKeyPath：上传私钥 .key 文件的绝对路径
#      私钥下载：微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传密钥（仅能下载一次）

# 3. 在微信公众平台「开发设置 → 小程序代码上传」里，把你的开发机 IP 加入白名单
```

**日常使用：**

```bash
# 生成体验版二维码 → 用手机微信扫码在真机预览（看不到模拟器，靠真机+日志调试）
npm run preview
# 或：node upload.js preview        # 二维码保存为 preview.jpg

# 上传代码到后台（提交审核前用）
npm run upload
# 或：VERSION=1.0.1 node upload.js upload
```

> 🔒 `private.config.js` 和 `*.key` 已被 [.gitignore](.gitignore) 排除，不会泄露。

## 浏览器快速预览（无需开发者工具）

`game.js` 与 `input.js` 内置浏览器降级分支：把 `minigame/` 目录用任意静态服务器托管后，
在浏览器访问 `minigame/game.js` 所在页面即可运行（需自行准备一个引用它的 html，或临时测试逻辑）。
纯逻辑可直接 `node -e "require('./js/logic')"` 验证。

## 上传与发布

1. 在开发者工具右上角点「上传」→ 填版本号和备注 → 生成体验版/提交审核
2. 提交审核前需完成上架资质，详见 [`../docs/MinigamePublish.md`](../docs/MinigamePublish.md)

## 关键配置项

| 位置 | 配置 | 说明 |
|------|------|------|
| [`game.json`](game.json) | `deviceOrientation` | `portrait` 竖屏；改 `landscape` 横屏需同步调整 [`js/ui.js`](js/ui.js) 布局 |
| [`project.config.json`](project.config.json) | `appid` | AppID（miniprogram-ci 通过 private.config.js 注入，此处仅占位） |
| [`private.config.js`](private.config.example.js) | `appid` / `privateKeyPath` | **本地填写**，不入库；AppID 与上传私钥 |
| [`js/ad.js`](js/ad.js) | `TEST_AD_UNIT_ID` | **发布前必须替换**为后台创建的真实广告位 ID |
| 微信公众平台 | IP 白名单 | miniprogram-ci 上传前需把本机出口 IP 加入「开发设置 → 小程序代码上传」白名单 |

## 不在本版本的功能

- ❌ **在线对战**：小游戏要求 `wss://` + 已备案域名 + 仅 443 端口。需要时另行开发，并参考根目录 `online-server.js`。
- ❌ **AI 难度分级**：沿用网页版单层启发式。
- ❌ **音效开关/设置页**：如需可在 [`js/ui.js`](js/ui.js) 增加按钮。

## 与网页版的对应关系

| 网页版 index.html | 小游戏版 |
|---|---|
| `<script>` 全局变量 | `game.js` state 对象 |
| `draw()` (1040-1201行) | `js/render.js` draw() |
| `click`/`mousemove` 事件 | `js/input.js` onTouchStart |
| `<button>` + classList | `js/ui.js` Canvas 按钮 |
| `new AudioContext()` | `wx.createWebAudioContext()` |
| `new WebSocket` | （未迁移） |
| 规则函数 (557-915行) | `js/logic.js`（共享） |
