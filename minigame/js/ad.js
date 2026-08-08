// 夹挑棋 · 激励视频广告（微信小游戏版）
// 变现入口：认输后或主动「看广告换先手」时调用。
// adUnitId 需在小游戏后台「流量主 → 广告位管理」创建后填入。
// 开发期用测试 adUnitId；非小游戏环境（浏览器调试）优雅降级。

// 测试广告位 ID（微信官方提供的激励视频测试 ID，仅开发/演示用）
// 正式发布前在微信公众平台创建真实广告位并替换。
const TEST_AD_UNIT_ID = 'adunit-test';

let rewardedAd = null;
let ready = false;

function init() {
    if (typeof wx === 'undefined' || !wx.createRewardedVideoAd) return;
    rewardedAd = wx.createRewardedVideoAd({ adUnitId: TEST_AD_UNIT_ID });

    rewardedAd.onLoad(() => { ready = true; });
    rewardedAd.onError((err) => {
        ready = false;
        console.warn('[ad] 激励视频加载失败', err && err.errMsg);
    });
    rewardedAd.onClose((res) => {
        // res.isEnded === true 表示正常播放结束，发放奖励
        if (lastReward) {
            lastReward(res && res.isEnded);
            lastReward = null;
        }
    });
}

let lastReward = null; // onClose 回调里调用

// 展示激励视频；callback(isEnded) 通知是否发放奖励
function show(callback) {
    if (!rewardedAd) {
        // 非小游戏环境或广告未初始化：直接当作「已观看」以便调试
        if (callback) callback(true);
        return;
    }
    lastReward = callback;
    rewardedAd.show().catch(() => {
        // show 失败（常见：广告未加载好）→ 静默重载后再试一次
        rewardedAd.load().then(() => rewardedAd.show()).catch((err) => {
            console.warn('[ad] 无法展示激励视频', err && err.errMsg);
            if (callback) { callback(false); lastReward = null; }
        });
    });
}

module.exports = { init, show };
