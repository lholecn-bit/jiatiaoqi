// 夹挑棋 · 音效层（微信小游戏版）
// 合成逻辑照搬 index.html 的 playMoveSound/playCaptureSound/playWinSound，
// 仅把 AudioContext 来源从 window 换成 wx.createWebAudioContext()。

let audioCtx = null;

function ensureAudioContext() {
    // 小游戏环境用 wx.createWebAudioContext；兼顾未来在浏览器里调试
    let Ctx = null;
    if (typeof wx !== 'undefined' && wx.createWebAudioContext) {
        if (!audioCtx) audioCtx = wx.createWebAudioContext();
    } else if (typeof window !== 'undefined') {
        Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !audioCtx) audioCtx = new Ctx();
    }
    if (!audioCtx) return null;
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

// 首次触摸激活（小游戏与浏览器都要求用户手势后才能发声）
function unlockAudio() {
    ensureAudioContext();
}

function playMoveSound() {
    const context = ensureAudioContext();
    if (!context) return;

    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.05);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(gain);
    gain.connect(context.destination);

    osc.start(now);
    osc.stop(now + 0.1);
}

function playCaptureSound(captureCount = 1) {
    const context = ensureAudioContext();
    if (!context) return;

    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    const countFactor = Math.min(captureCount, 4);

    osc.type = 'square';
    osc.frequency.setValueAtTime(360 + countFactor * 20, now);
    osc.frequency.exponentialRampToValueAtTime(230, now + 0.12);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12 + countFactor * 0.01, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(now);
    osc.stop(now + 0.15);
}

function playWinSound() {
    const context = ensureAudioContext();
    if (!context) return;

    const now = context.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];

    notes.forEach((freq, index) => {
        const start = now + index * 0.11;
        const end = start + 0.2;
        const osc = context.createOscillator();
        const gain = context.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(gain);
        gain.connect(context.destination);
        osc.start(start);
        osc.stop(end + 0.01);
    });
}

module.exports = {
    unlockAudio,
    playMoveSound,
    playCaptureSound,
    playWinSound,
};
