/* =============================================================================
 *  audio.js —— 声音
 *  ---------------------------------------------------------------------------
 *  没有背景音乐。只有风、一点点生长的声音、和动物。
 *
 *  风声是这个游戏里最重要的一件乐器，它有一个隐藏任务：
 *  让玩家用耳朵确认「这里变好了」。
 *
 *    荒原的风 —— 干燥、开阔、高频多、声音大、一直在刮
 *    森林的风 —— 低沉、柔和、被叶子滤过、声音小、有起伏
 *
 *  两者之间用 forestness 连续插值。玩家不一定说得出来哪里变了，
 *  但耳朵会先知道。
 *
 *  另外，风声的音量跟画面里的风（Render.wind）同步 ——
 *  刮一阵的时候，草弯下去，声音也跟着起来。
 * ========================================================================== */

const Sound = {

  ready: false,
  enabled: true,
  ctx: null,

  /* ======================================================================= */
  init() {
    // 浏览器要求：必须在用户交互之后才能出声
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ac = this.ctx;

    this.master = ac.createGain();
    this.master.gain.value = CFG.AUDIO.master;
    this.master.connect(ac.destination);

    /* ---- 风：两层噪声叠在一起 ---- */
    this.noiseBuf = this._makeNoise(4);

    // (1) 底噪层：一直有的低频空气声，穿过一切
    this.windLowSrc = ac.createBufferSource();
    this.windLowSrc.buffer = this.noiseBuf; this.windLowSrc.loop = true;
    this.windLowF = ac.createBiquadFilter();
    this.windLowF.type = 'lowpass'; this.windLowF.frequency.value = 420;
    this.windLowG = ac.createGain(); this.windLowG.gain.value = 0.18;
    this.windLowSrc.connect(this.windLowF).connect(this.windLowG).connect(this.master);

    // (2) 呼啸层：荒原上最明显的那层「干风」，森林里几乎消失
    this.windHiSrc = ac.createBufferSource();
    this.windHiSrc.buffer = this.noiseBuf; this.windHiSrc.loop = true;
    this.windHiF = ac.createBiquadFilter();
    this.windHiF.type = 'bandpass'; this.windHiF.frequency.value = 1500; this.windHiF.Q.value = 0.7;
    this.windHiG = ac.createGain(); this.windHiG.gain.value = 0.16;
    this.windHiSrc.connect(this.windHiF).connect(this.windHiG).connect(this.master);

    this.windLowSrc.start();
    this.windHiSrc.start();

    this.ready = true;
  },

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? CFG.AUDIO.master : 0, this.ctx.currentTime, 0.3);
    }
  },

  _makeNoise(sec) {
    const ac = this.ctx;
    const len = Math.floor(ac.sampleRate * sec);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    // 布朗噪声（比白噪声更像自然界的风：低频更重）
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    // 首尾交叉淡化，循环时不会有「咔」
    const fade = Math.floor(ac.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
    return buf;
  },

  /**
   * 每帧更新风声。
   * forestness 0 → 1，风从「干燥开阔」变成「柔和低沉」。
   */
  update(world, windStrength) {
    if (!this.ready || !this.enabled) return;
    const A = CFG.AUDIO.wind;
    const f = U.clamp(world.forestness / A.fullAt, 0, 1);
    const fs = U.smoothstep(0, 1, f);   // 让转变在中段更明显一点

    const t = this.ctx.currentTime, T = 0.35;
    // 呼啸层：荒原声音大、频率高；森林里几乎没了
    const hiCut = U.lerp(A.wasteland.cutoff, A.forest.cutoff, fs);
    const hiGain = U.lerp(A.wasteland.gain, A.forest.gain, fs);
    // 底噪层：森林里反而稍微明显一点（树叶摩擦的沙沙声）
    const loGain = U.lerp(0.14, 0.20, fs);

    // 再叠上当前的阵风强度（画面里草弯多少，声音就大多少）
    const gust = 0.62 + windStrength * 0.75;

    this.windHiF.frequency.setTargetAtTime(hiCut, t, T);
    this.windHiG.gain.setTargetAtTime(hiGain * gust, t, T);
    this.windLowG.gain.setTargetAtTime(loGain * gust * 0.85, t, T);
  },

  /* =======================================================================
   *  一次性音效
   * ===================================================================== */

  /** 生长提示：极轻的一声，位置决定左右声道 */
  sprout(screenXRatio) {
    if (!this.ready || !this.enabled) return;
    const ac = this.ctx, t = ac.currentTime;
    const notes = CFG.AUDIO.sprout.notes;
    const f = notes[(Math.random() * notes.length) | 0];

    const o = ac.createOscillator();
    o.type = 'sine'; o.frequency.value = f;
    // 一点点失谐让它不那么电子
    const o2 = ac.createOscillator();
    o2.type = 'sine'; o2.frequency.value = f * 2.004;

    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(CFG.AUDIO.sprout.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);

    const g2 = ac.createGain(); g2.gain.value = 0.18;

    let out = g;
    if (ac.createStereoPanner) {
      const pn = ac.createStereoPanner();
      pn.pan.value = U.clamp((screenXRatio - 0.5) * 1.6, -1, 1);
      g.connect(pn); out = pn;
    }
    o.connect(g); o2.connect(g2).connect(g);
    out.connect(this.master);
    o.start(t); o2.start(t);
    o.stop(t + 1.2); o2.stop(t + 1.2);
  },

  /** 动物叫声 */
  animal(kind) {
    if (!this.ready || !this.enabled) return;
    const ac = this.ctx, t = ac.currentTime;
    const cfgB = CFG.AUDIO.bird, cfgG = CFG.AUDIO.bug, cfgD = CFG.AUDIO.deer;

    if (kind === 'bird') {
      // 两三声短促的、频率上扬的鸣叫
      const n = 2 + ((Math.random() * 2) | 0);
      for (let k = 0; k < n; k++) {
        const t0 = t + k * (0.11 + Math.random() * 0.07);
        const base = 1900 + Math.random() * 900;
        const o = ac.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(base, t0);
        o.frequency.exponentialRampToValueAtTime(base * 1.55, t0 + 0.045);
        o.frequency.exponentialRampToValueAtTime(base * 0.92, t0 + 0.1);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(cfgB.gain, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
        o.connect(g).connect(this.master);
        o.start(t0); o.stop(t0 + 0.15);
      }
    } else if (kind === 'bug') {
      // 高频的细碎振翅
      const t0 = t + Math.random() * 0.1;
      const src = ac.createBufferSource(); src.buffer = this.noiseBuf;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 4200 + Math.random() * 1400; bp.Q.value = 12;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(cfgG.gain, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      src.connect(bp).connect(g).connect(this.master);
      src.start(t0); src.stop(t0 + 0.6);
    } else if (kind === 'deer') {
      // 低沉的一声
      const t0 = t;
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(220, t0);
      o.frequency.exponentialRampToValueAtTime(150, t0 + 0.4);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(cfgD.gain, t0 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.55);
    }
  },

  /** 水出现的那一声（很轻的一声「咚」的高频版） */
  water() {
    if (!this.ready || !this.enabled) return;
    const ac = this.ctx, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(CFG.AUDIO.water.gain, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.5);
  },
};
