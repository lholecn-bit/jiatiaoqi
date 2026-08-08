#!/usr/bin/env node
// 夹挑棋 · 小游戏命令行上传/预览（miniprogram-ci）
// 用法：
//   node upload.js preview   # 生成体验版二维码（手机扫码预览）
//   node upload.js upload    # 上传代码（提交审核前的版本）
//
// 前置：把你的 AppID 和上传私钥填进 private.config.js（见 private.config.example.js）
// 私钥获取：微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传密钥 → 下载（仅能下载一次，妥善保管）

const path = require('path');
const fs = require('fs');

// 读取私有配置（不进版本库）
const cfgPath = path.join(__dirname, 'private.config.js');
if (!fs.existsSync(cfgPath)) {
    console.error('[ERROR] 找不到 private.config.js');
    console.error('  请复制 private.config.example.js 为 private.config.js，');
    console.error('  并填入你的 AppID 和上传私钥路径。');
    process.exit(1);
}
const { appid, privateKeyPath } = require(cfgPath);

if (!appid || appid.startsWith('REPLACE')) {
    console.error('[ERROR] private.config.js 里的 appid 还没填');
    process.exit(1);
}
if (!privateKeyPath || !fs.existsSync(privateKeyPath)) {
    console.error('[ERROR] private.config.js 里的 privateKeyPath 无效或文件不存在：', privateKeyPath);
    console.error('  私钥下载地址：微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传密钥');
    process.exit(1);
}

// 动态引入 miniprogram-ci（已 npm i 安装）
const ci = require('miniprogram-ci');

const PROJECT_PATH = __dirname;
// 版本号：上传时用，格式 X.Y.Z；可命令行覆盖
const VERSION = process.env.VERSION || '1.0.0';
const DESC = process.env.DESC || '夹挑棋小游戏';

async function main() {
    const action = process.argv[2] || 'preview';

    const project = new ci.Project({
        appid,
        type: 'miniGame',          // ★ 关键：小游戏类型
        projectPath: PROJECT_PATH,
        privateKeyPath,
        ignores: ['node_modules/**/*', 'private.config.*', '*.example.js', 'upload.js'],
    });

    if (action === 'upload') {
        console.log(`[上传] 版本 ${VERSION} - ${DESC}`);
        const res = await ci.upload({
            project,
            version: VERSION,
            desc: DESC,
            setting: { es6: true, minify: true },
        });
        console.log('[上传完成]', res);

    } else if (action === 'preview') {
        console.log('[生成预览版二维码...]');
        const res = await ci.preview({
            project,
            desc: DESC,
            setting: { es6: true, minify: true },
            qrcodeFormat: 'image',         // 输出二维码图片
            qrcodeOutputDest: path.join(__dirname, 'preview.jpg'),
            // 在终端打印二维码（部分终端支持扫码）：
            onProgressUpdate: () => {},
        });
        const qrcodePath = path.join(__dirname, 'preview.jpg');
        console.log(`[预览二维码已生成] ${qrcodePath}`);
        console.log('  用手机微信扫描该图片，或在终端查看下方二维码。');

    } else {
        console.error('[ERROR] 未知动作：' + action);
        console.error('  用法：node upload.js [preview|upload]');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('[失败]', err && err.message ? err.message : err);
    process.exit(1);
});
