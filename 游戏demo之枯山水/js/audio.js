/* =========================================================================
 * audio.js —— 声音（全部用 WebAudio 现场合成，没有音频文件）
 *
 * 这个游戏的声音目标是"让人更安静"，所以：
 *   - 默认音量很低
 *   - 没有旋律、没有提示音、没有 UI 音效
 *   - 只有：放石头的闷响、耙砂的沙沙、水钵的水声、偶尔一阵风
 * ========================================================================= */
(function () {
  'use strict';

  let ac = null, master = null, noiseBuf = null;
  let on = true;
  let rs = null, rf = null, rg = null;     // 耙砂的持续音源

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = on ? KS.P.audio.master : 0;   // 静音状态下创建也要保持静音
    master.connect(ac.destination);
    // 2 秒白噪声，所有"沙沙"类声音都从它切片而来
    const len = ac.sampleRate * 2;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }

  function unlock() {
    const a = ensure();
    if (a && a.state === 'suspended') a.resume();
  }

  function setOn(v) {
    on = v;
    if (master) master.gain.setTargetAtTime(v ? KS.P.audio.master : 0, ac.currentTime, 0.05);
    if (!v) rakeEnd();
  }
  function isOn() { return on; }

  /* 放石头：一声很轻的闷响 */
  function thud(v) {
    if (!on) return; if (!ensure()) return;
    v = (v == null ? 1 : v) * KS.P.audio.thud;
    const t = ac.currentTime;

    // 噪声那一下"噗"
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    s.playbackRate.value = 0.5;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 430; f.Q.value = 0.6;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.26);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.3);

    // 低频那一下"咚"
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(128, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.22);
    const og = ac.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.5 * v, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    o.connect(og); og.connect(master);
    o.start(t); o.stop(t + 0.32);
  }

  /* 耙砂：持续的沙沙声，音量与音色随手势速度变化 */
  function rakeStart() { if (!on) return; if (!ensure()) return; if (rs) return;
    rs = ac.createBufferSource(); rs.buffer = noiseBuf; rs.loop = true;
    rf = ac.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 1400; rf.Q.value = 0.7;
    rg = ac.createGain(); rg.gain.value = 0;
    rs.connect(rf); rf.connect(rg); rg.connect(master);
    rs.start();
  }
  function rakeMove(speed) {
    if (!rg || !on) return;
    const s = Math.min(1, speed / 2.4);
    rg.gain.setTargetAtTime(0.17 * s * KS.P.audio.rake, ac.currentTime, 0.05);
    rf.frequency.setTargetAtTime(800 + 2500 * s, ac.currentTime, 0.08);
  }
  function rakeEnd() {
    if (!rg) return;
    rg.gain.setTargetAtTime(0, ac.currentTime, 0.06);
    const s = rs, g = rg;
    setTimeout(function () { try { s.stop(); } catch (e) {} }, 400);
    rs = null; rg = null; rf = null;
  }

  /* 水钵：偶尔一滴 */
  function water() {
    if (!on) return; if (!ensure()) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(720 + Math.random() * 160, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.16);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * KS.P.audio.water, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.55);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.6);
  }

  /* 一阵风：慢慢起来、慢慢走 */
  function wind() {
    if (!on) return; if (!ensure()) return;
    const t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = 0.35;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 620;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * KS.P.audio.wind, t + 1.2);
    g.gain.linearRampToValueAtTime(0.0001, t + 4.0);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + 4.2);
  }

  KS.Audio = {
    unlock: unlock, setOn: setOn, isOn: isOn,
    thud: thud, rakeStart: rakeStart, rakeMove: rakeMove, rakeEnd: rakeEnd,
    water: water, wind: wind,
  };
})();
