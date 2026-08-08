// 上传配置模板 —— 复制本文件为 private.config.js 并填入真实值
//
// ⚠️ private.config.js 不要提交到版本库（已加入 .gitignore）
//
// 获取方式：
//   appid：微信公众平台 → 开发 → 开发设置 → AppID
//   私钥：微信公众平台 → 开发 → 开发设置 → 小程序代码上传 → 下载私钥（.key 文件，仅能下载一次）

module.exports = {
    // 你的小游戏 AppID（wx 开头）
    appid: 'wx REPLACE_WITH_YOUR_APPID',

    // 上传私钥文件的绝对路径（下载后的 .key 文件存放位置）
    // 建议放在项目外的安全目录，例如：
    //   '/home/yourname/keys/jiaotiaoqi.key'
    privateKeyPath: '/ABSOLUTE/PATH/TO/your-private.key',
};
