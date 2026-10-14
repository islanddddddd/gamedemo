// ============================================================
// audio.js —— Web Audio API 程序化合成器
// BGM（五声音阶日系 orchestral：竖琴琶音 / 弦乐 pad / 木管旋律 / 木琴）
// 与全部音效，零外部音频文件。混响使用程序化生成的脉冲响应。
// 必须在用户首次交互后调用 init()（浏览器自动播放限制）。
// ============================================================

// 五声音阶（MIDI 音高）：白天 C 大调五声，夜晚 A 小调五声
const PENTA_DAY = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
const PENTA_NIGHT = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79];
const midi2f = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.vol = { master: 0.8, bgm: 0.55, sfx: 0.9 };
    this.mode = 'day';     // day / night / danger
    this.ecoHealth = 1;    // 0..1 生态健康度（驱动动态分层）
    this._step = 0;
    this._nextT = 0;
  }

  // ---------- 初始化（首次用户点击时调用） ----------
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    // 主总线：主音量 → 目的地；BGM / 音效分别控制
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol.master;
    this.master.connect(ctx.destination);
    this.bgmBus = ctx.createGain();
    this.bgmBus.gain.value = this.vol.bgm;
    this.bgmBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.vol.sfx;
    this.sfxBus.connect(this.master);

    // 程序化混响：指数衰减噪声脉冲响应（伪大厅混响）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeIR(3.0, 2.4);
    this.revBus = ctx.createGain();
    this.revBus.gain.value = 0.5;
    this.revBus.connect(this.reverb);
    this.reverb.connect(this.master);

    // 分层总线（便于昼夜/健康度动态开关）
    this.layer = {
      pluck: this._bus(0.9), pad: this._bus(0.7), melody: this._bus(0.5),
      wood: this._bus(0.5), strings: this._bus(0.0), dark: this._bus(0.0),
    };

    this.ready = true;
    this._nextT = ctx.currentTime + 0.15;
    // 预排程循环：每 60ms 检查一次，提前 250ms 排定音符
    this._timer = setInterval(() => this._schedule(), 60);
  }

  _bus(g) {
    const b = this.ctx.createGain();
    b.gain.value = g;
    b.connect(this.bgmBus);
    return b;
  }

  // ---------- 程序化脉冲响应 ----------
  _makeIR(dur, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 早期反射 + 指数衰减尾巴
        const early = i < ctx.sampleRate * 0.08 ? 0.6 : 0.0;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (0.7 + early);
      }
    }
    return buf;
  }

  // ---------- BGM 排程 ----------
  _schedule() {
    if (!this.ready || this.ctx.state !== 'running') return;
    const night = this.mode === 'night';
    const spb = night ? 60 / 58 / 4 : 60 / 92 / 4; // 16 分音符时长（秒）
    while (this._nextT < this.ctx.currentTime + 0.25) {
      this._playStep(this._step, this._nextT);
      this._nextT += spb;
      this._step++;
    }
  }

  _playStep(s, t) {
    const night = this.mode === 'night';
    const danger = this.mode === 'danger';
    const beat = s % 32;
    const scale = night ? PENTA_NIGHT : PENTA_DAY;

    // 1) 竖琴/古筝琶音层：白天活跃，夜晚稀疏
    if (night ? beat % 8 === 0 : beat % 2 === 0 || Math.random() < 0.25) {
      const m = scale[(Math.random() * scale.length) | 0];
      this._pluck(midi2f(m), t, night ? 0.45 : 0.75, night ? 0.7 : 0.5);
    }
    // 2) 木琴层：仅白天且生态健康时出现
    if (!night && this.ecoHealth > 0.55 && beat % 4 === 2 && Math.random() < 0.5) {
      const m = PENTA_DAY[4 + ((Math.random() * 5) | 0)];
      this._wood(midi2f(m), t, 0.4);
    }
    // 3) 弦乐 pad：每 32 步（两小节）换和弦
    if (beat === 0) this._pad(t, night);
    // 4) 木管旋律层：白天 + 生态健康
    if (!night && this.ecoHealth > 0.7 && beat % 8 === 0 && Math.random() < 0.6) {
      const m = scale[2 + ((Math.random() * 5) | 0)];
      this._melody(midi2f(m), t, 0.5);
    }
    // 5) 低沉预警层：危险模式或生态恶化
    if ((danger || this.ecoHealth < 0.35) && beat % 8 === 0) {
      this._dark(t);
    }
  }

  // 竖琴/古筝 pluck：三角波 + 泛音，短促包络，低通 + 混响
  _pluck(freq, t, gain, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * 0.22, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    o.connect(g); o2.connect(g); g.connect(lp);
    lp.connect(this.layer.pluck);
    const send = ctx.createGain(); send.gain.value = 0.6;
    lp.connect(send); send.connect(this.revBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  // 弦乐 pad：三和弦（根/五/八）双锯齿失谐，低通慢扫
  _pad(t, night) {
    const ctx = this.ctx;
    const root = night ? 45 : 48; // A2 / C3
    const chord = [root, root + 7, root + 12];
    const dur = 8;
    chord.forEach((m, i) => {
      const f = midi2f(m);
      [-6, 6].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * Math.pow(2, cents / 1200);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 1.6);
        g.gain.setValueAtTime(0.05, t + dur - 1.8);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(420, t);
        lp.frequency.linearRampToValueAtTime(820, t + dur * 0.6);
        lp.frequency.linearRampToValueAtTime(420, t + dur);
        // 低通慢扫 LFO
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13 + i * 0.05;
        const lg = ctx.createGain(); lg.gain.value = 140;
        lfo.connect(lg); lg.connect(lp.frequency);
        o.connect(g); g.connect(lp);
        lp.connect(this.layer.pad);
        const send = ctx.createGain(); send.gain.value = 0.7;
        lp.connect(send); send.connect(this.revBus);
        // 生态健康时追加明亮弦乐层
        const sg = ctx.createGain(); sg.gain.value = 0.5;
        lp.connect(sg); sg.connect(this.layer.strings);
        o.start(t); lfo.start(t); o.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
      });
    });
  }

  // 木管旋律：三角波 + 颤音，经混响
  _melody(freq, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.value = freq * 0.008;
    vib.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.09);
    g.gain.setValueAtTime(0.10, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.layer.melody);
    const send = ctx.createGain(); send.gain.value = 0.5;
    g.connect(send); send.connect(this.revBus);
    o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }

  // 木琴/钟琴：基频 + 非谐泛音，快速衰减
  _wood(freq, t, gain) {
    const ctx = this.ctx;
    [1, 3.2].forEach((h, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * h;
      const g = ctx.createGain();
      const d = i === 0 ? 0.4 : 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain * (i === 0 ? 0.16 : 0.05), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.layer.wood);
      const send = ctx.createGain(); send.gain.value = 0.35;
      g.connect(send); send.connect(this.revBus);
      o.start(t); o.stop(t + d + 0.05);
    });
  }

  // 低沉预警层：根音 + 三全音失谐簇，慢速不协和
  _dark(t) {
    const ctx = this.ctx;
    const root = 33; // A1
    [0, 6].forEach((iv, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = midi2f(root + iv);
      o.detune.value = i === 0 ? -7 : 7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + 3.2);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
      o.connect(g); g.connect(lp); lp.connect(this.layer.dark);
      o.start(t); o.stop(t + 3.4);
    });
  }

  // ---------- 昼夜 / 危险模式切换（增益平滑过渡） ----------
  setMode(mode) {
    if (!this.ready || this.mode === mode) return;
    this.mode = mode;
    const t = this.ctx.currentTime;
    const ramp = (bus, v) => bus.gain.setTargetAtTime(v, t, 0.8);
    if (mode === 'night') {
      ramp(this.layer.melody, 0); ramp(this.layer.wood, 0);
      ramp(this.layer.pad, 0.55); ramp(this.layer.pluck, 0.5);
      ramp(this.layer.dark, 0.3);
    } else if (mode === 'danger') {
      ramp(this.layer.melody, 0); ramp(this.layer.wood, 0);
      ramp(this.layer.pad, 0.35); ramp(this.layer.pluck, 0.4);
      ramp(this.layer.dark, 0.9);
    } else {
      ramp(this.layer.melody, 0.5); ramp(this.layer.wood, 0.5);
      ramp(this.layer.pad, 0.7); ramp(this.layer.pluck, 0.9);
      ramp(this.layer.dark, 0.25);
    }
  }

  // 生态健康度 → 动态分层
  setEcoHealth(h) {
    this.ecoHealth = h;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.layer.strings.gain.setTargetAtTime(h > 0.7 ? 0.5 : 0, t, 1.2);
    if (h < 0.3 && this.mode !== 'danger') {
      this.layer.dark.gain.setTargetAtTime(0.6, t, 1.5);
    } else if (this.mode !== 'danger') {
      this.layer.dark.gain.setTargetAtTime(this.mode === 'night' ? 0.3 : 0.25, t, 1.5);
    }
  }

  // ---------- 音量 / 静音 ----------
  setVolumes(master, bgm, sfx) {
    this.vol = { master, bgm, sfx };
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : master, t, 0.1);
    this.bgmBus.gain.setTargetAtTime(bgm, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.1);
  }
  setMuted(m) {
    this.muted = m;
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(m ? 0 : this.vol.master, this.ctx.currentTime, 0.1);
  }
  resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); }

  // ============================================================
  //  音效（全部程序化合成）
  // ============================================================
  _sfx(freq, type, t0, dur, peak, { slideTo = null, lp = null, send = 0.25, bus = null } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = g;
    if (lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
      g.connect(f); node = f;
    }
    o.connect(g);
    node.connect(bus || this.sfxBus);
    const s = ctx.createGain(); s.gain.value = send;
    node.connect(s); s.connect(this.revBus);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  _noise(t0, dur, peak, { f0 = 2000, f1 = 300, q = 1.2 } = {}) {
    const ctx = this.ctx;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0);
    bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t0);
  }

  // ---- 各类音效 ----
  ui() { if (this.ready) this._sfx(880, 'sine', this.ctx.currentTime, 0.09, 0.12, { slideTo: 1320 }); }
  select() { if (this.ready) this._sfx(520, 'sine', this.ctx.currentTime, 0.12, 0.1, { slideTo: 780 }); }
  coin() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._sfx(880, 'sine', t, 0.1, 0.1);
    this._sfx(1318, 'sine', t + 0.08, 0.14, 0.1);
  }
  // 投放落水：低频下滑 + 噪声气泡 burst
  splash() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._sfx(320, 'sine', t, 0.28, 0.22, { slideTo: 55 });
    this._noise(t, 0.22, 0.16, { f0: 1800, f1: 250 });
  }
  // 气泡：随机小 pluck
  bubble() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = 380 + Math.random() * 520;
    this._sfx(f, 'sine', t, 0.12, 0.05, { slideTo: f * 0.45, send: 0.4 });
  }
  // 进食：连续短促泡泡
  eat() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const f = 420 + Math.random() * 400;
      this._sfx(f, 'sine', t + i * 0.07, 0.07, 0.05, { slideTo: f * 0.5 });
    }
  }
  // 鱼死亡：下行小三度 + 低通
  death() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._sfx(233, 'sine', t, 0.7, 0.16, { slideTo: 175, lp: 900 });
    this._sfx(174, 'triangle', t + 0.15, 0.8, 0.1, { slideTo: 130, lp: 700 });
  }
  // 警告：两声方波
  warn() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._sfx(660, 'square', t, 0.14, 0.07, { lp: 2200 });
    this._sfx(550, 'square', t + 0.18, 0.18, 0.07, { lp: 2200 });
  }
  // 成就 / 评级提升：上行五声音阶琶音 + 铃铛
  achieve() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [72, 74, 76, 79, 81].forEach((m, i) => {
      this._sfx(midi2f(m), 'triangle', t + i * 0.09, 0.5, 0.11, { send: 0.5 });
    });
    this._sfx(2093, 'sine', t + 0.5, 1.2, 0.09, { send: 0.6 });
  }
  // 换水：水流倾泻声
  water() {
    if (!this.ready) return;
    this._noise(this.ctx.currentTime, 0.9, 0.1, { f0: 900, f1: 2400, q: 0.6 });
  }
  place() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._sfx(392, 'sine', t, 0.12, 0.1, { slideTo: 587 });
  }
}
