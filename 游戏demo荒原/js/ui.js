/* =============================================================================
 *  ui.js —— 界面与输入
 *  ---------------------------------------------------------------------------
 *  能藏就藏：大部分时间画面里只有那片地。
 *  没有分数、没有进度条、没有百分比。
 *  如果一定要给反馈，用画面本身给 —— 地绿了就是反馈。
 *
 *  操作：
 *    左键点/拖   放下东西（拖着可以连着放一片）
 *    右键/中键拖 平移；空格 + 左键拖 也一样
 *    滚轮         缩放
 *    触屏         单指拖 = 平移，点一下 = 放下，双指 = 缩放
 *    数字键 1~9   选手边的东西
 *    H            藏起界面      S  声音      R  换一片荒原
 * ========================================================================== */

const UI = {

  game: null,
  selected: null,
  unlocked: new Set(),
  hoverCell: null,
  uiVisible: true,
  idle: 0,
  overBar: false,

  /* ======================================================================= */
  init(game) {
    this.game = game;
    this.el = {
      ui: document.getElementById('ui'),
      bar: document.getElementById('seedbar'),
      toast: document.getElementById('toast'),
      hint: document.getElementById('hint'),
      clock: document.getElementById('clock'),
      btnSound: document.getElementById('btnSound'),
      btnHide: document.getElementById('btnHide'),
      btnReset: document.getElementById('btnReset'),
      gate: document.getElementById('gate'),
      btnBegin: document.getElementById('btnBegin'),
    };

    this.buildBar();
    this.bindInput();
    this.bindButtons();
  },

  /* =======================================================================
   *  手边的东西
   * ===================================================================== */
  buildBar() {
    this.el.bar.innerHTML = '';
    this.seedEls = {};
    for (const sp of CFG.SPECIES) {
      if (!sp.plantable) continue;         // 惊喜物种永远不出现在手边
      const b = document.createElement('button');
      b.className = 'seed';
      b.dataset.id = sp.id;

      const cv = document.createElement('canvas');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const S = 38;
      cv.width = S * dpr; cv.height = S * dpr;
      cv.style.width = S + 'px'; cv.style.height = S + 'px';
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      this.drawIcon(g, sp, S);

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = sp.name;

      b.appendChild(cv); b.appendChild(nm);
      b.title = sp.tip || '';

      b.addEventListener('click', () => this.select(sp.id));
      b.addEventListener('pointerenter', () => { this.overBar = true; this.idle = 0; });
      b.addEventListener('pointerleave', () => { this.overBar = false; });

      this.el.bar.appendChild(b);
      this.seedEls[sp.id] = b;
    }
  },

  /** 刷新哪些能用、哪个正被选中。newly 是刚解锁的，会闪一下 */
  refresh(unlocked, newly, keepSelection) {
    this.unlocked = unlocked;
    let first = null;
    for (const id in this.seedEls) {
      const el = this.seedEls[id];
      const on = unlocked.has(id);
      el.style.display = on ? '' : 'none';
      el.classList.toggle('on', this.selected && this.selected.id === id);
      if (on && !first) first = id;
      if (newly && newly.indexOf(id) >= 0) {
        el.classList.remove('fresh');
        void el.offsetWidth;      // 强制重排，好让动画重播
        el.classList.add('fresh');
      }
    }
    // 当前选的还没解锁，或者压根没选 → 自动选第一个
    if (!this.selected || !unlocked.has(this.selected.id)) {
      if (first) this.selected = SP_BY_ID[first];
    } else if (!keepSelection) {
      /* 保持 */
    }
    for (const id in this.seedEls) {
      this.seedEls[id].classList.toggle('on', !!this.selected && this.selected.id === id);
    }
  },

  select(id) {
    if (!this.unlocked.has(id)) return;
    this.selected = SP_BY_ID[id];
    for (const k in this.seedEls) this.seedEls[k].classList.toggle('on', k === id);
    this.idle = 0;
  },

  /** 种子栏的小图标：和地里长出来的是一个风格，只是更小 */
  drawIcon(g, sp, S) {
    g.clearRect(0, 0, S, S);
    const cx = S * 0.5, base = S * 0.80;
    const col = (l, a = 1) => `hsla(${sp.h},${sp.s}%,${l}%,${a})`;

    // 一点地面
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.beginPath(); g.ellipse(cx, base + 1, S * 0.36, S * 0.09, 0, 0, 6.2832); g.fill();

    g.lineCap = 'round'; g.lineJoin = 'round';

    switch (sp.id) {
      case 'lichen':
        for (let k = 0; k < 4; k++) {
          const a = k * 1.9 + 0.4;
          g.fillStyle = col(sp.l + 8, 0.85);
          g.beginPath();
          g.ellipse(cx + Math.cos(a) * S * 0.15, base - 2 + Math.sin(a) * S * 0.05, S * 0.09, S * 0.055, 0, 0, 6.2832);
          g.fill();
        }
        break;
      case 'moss':
        for (let k = 0; k < 6; k++) {
          const a = k * 1.05;
          g.fillStyle = col(sp.l + (k % 2) * 8, 0.9);
          g.beginPath();
          g.ellipse(cx + Math.cos(a) * S * 0.16, base - 3 + Math.sin(a) * S * 0.06, S * 0.075, S * 0.05, 0, 0, 6.2832);
          g.fill();
        }
        break;
      case 'grass':
        for (let k = -2; k <= 2; k++) {
          const ox = k * S * 0.075;
          const bend = k * S * 0.035;
          g.strokeStyle = col(sp.l + (k % 2) * 7, 0.92);
          g.lineWidth = 1.7;
          g.beginPath();
          g.moveTo(cx + ox, base);
          g.quadraticCurveTo(cx + ox + bend, base - S * 0.2, cx + ox + bend * 2.4, base - S * (0.42 - Math.abs(k) * 0.045));
          g.stroke();
        }
        break;
      case 'mushroom':
        for (let k = -1; k <= 1; k += 2) {
          const ox = k * S * 0.13;
          g.fillStyle = 'hsla(40,12%,72%,1)';
          g.fillRect(cx + ox - 1, base - S * 0.16, 2, S * 0.16);
          g.fillStyle = col(sp.l, 1);
          g.beginPath(); g.ellipse(cx + ox, base - S * 0.16, S * 0.10, S * 0.072, 0, Math.PI, 0); g.fill();
        }
        break;
      case 'rock':
        g.fillStyle = col(sp.l + 6, 1);
        g.beginPath();
        for (let q = 0; q <= 7; q++) {
          const a = q / 7 * 6.2832;
          const wob = 1 + (U.hash01(q * 3.3) - 0.5) * 0.4;
          const px = cx + Math.cos(a) * S * 0.17 * wob;
          const py = base - S * 0.09 + Math.sin(a) * S * 0.11 * wob;
          q === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.beginPath(); g.ellipse(cx - S * 0.05, base - S * 0.15, S * 0.06, S * 0.03, -0.4, 0, 6.2832); g.fill();
        break;
      case 'flower':
        g.strokeStyle = 'hsla(96,26%,38%,1)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(cx, base); g.quadraticCurveTo(cx + 2, base - S * 0.2, cx + 1, base - S * 0.36); g.stroke();
        for (let k = 0; k < 5; k++) {
          const a = k / 5 * 6.2832;
          g.fillStyle = col(sp.l + 8, 0.95);
          g.beginPath();
          g.ellipse(cx + 1 + Math.cos(a) * S * 0.07, base - S * 0.36 + Math.sin(a) * S * 0.07, S * 0.055, S * 0.045, a, 0, 6.2832);
          g.fill();
        }
        g.fillStyle = 'hsla(48,70%,66%,1)';
        g.beginPath(); g.arc(cx + 1, base - S * 0.36, S * 0.042, 0, 6.2832); g.fill();
        break;
      case 'shrub':
        g.fillStyle = col(sp.l - 6, 1);
        g.beginPath(); g.ellipse(cx - S * 0.09, base - S * 0.15, S * 0.14, S * 0.115, 0, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(cx + S * 0.09, base - S * 0.13, S * 0.12, S * 0.10, 0, 0, 6.2832); g.fill();
        g.fillStyle = col(sp.l + 8, 0.95);
        g.beginPath(); g.ellipse(cx, base - S * 0.26, S * 0.13, S * 0.10, 0, 0, 6.2832); g.fill();
        break;
      case 'fern':
        g.strokeStyle = col(sp.l, 0.95); g.lineWidth = 1.5;
        for (let k = -2; k <= 2; k++) {
          const a = -Math.PI / 2 + k * 0.42;
          g.beginPath();
          g.moveTo(cx, base);
          g.quadraticCurveTo(cx + Math.cos(a) * S * 0.14, base - S * 0.24, cx + Math.cos(a) * S * 0.26, base + Math.sin(a) * S * 0.42);
          g.stroke();
        }
        break;
      case 'reed':
        g.strokeStyle = col(sp.l, 0.95); g.lineWidth = 1.5;
        for (let k = -1; k <= 1; k++) {
          const ox = k * S * 0.08;
          g.beginPath(); g.moveTo(cx + ox, base);
          g.quadraticCurveTo(cx + ox + k * 3, base - S * 0.3, cx + ox + k * 6, base - S * 0.55); g.stroke();
          g.fillStyle = 'hsla(34,30%,42%,1)';
          g.beginPath(); g.ellipse(cx + ox + k * 6, base - S * 0.57, 1.8, 4, 0, 0, 6.2832); g.fill();
        }
        break;
      case 'berry':
        g.fillStyle = 'hsla(108,30%,32%,1)';
        g.beginPath(); g.ellipse(cx, base - S * 0.2, S * 0.19, S * 0.15, 0, 0, 6.2832); g.fill();
        for (let k = 0; k < 4; k++) {
          const a = k * 1.7 + 0.5;
          g.fillStyle = col(sp.l + 10, 0.95);
          g.beginPath();
          g.arc(cx + Math.cos(a) * S * 0.11, base - S * 0.2 + Math.sin(a) * S * 0.08, S * 0.028, 0, 6.2832);
          g.fill();
        }
        break;
      case 'tree':
        g.fillStyle = 'hsla(26,22%,28%,1)';
        g.fillRect(cx - S * 0.035, base - S * 0.34, S * 0.07, S * 0.34);
        g.fillStyle = col(sp.l - 4, 1);
        g.beginPath(); g.ellipse(cx - S * 0.10, base - S * 0.36, S * 0.13, S * 0.11, 0, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(cx + S * 0.10, base - S * 0.33, S * 0.12, S * 0.10, 0, 0, 6.2832); g.fill();
        g.fillStyle = col(sp.l + 7, 0.97);
        g.beginPath(); g.ellipse(cx, base - S * 0.50, S * 0.15, S * 0.12, 0, 0, 6.2832); g.fill();
        break;
      case 'birch':
        g.fillStyle = 'hsla(40,10%,76%,1)';
        g.fillRect(cx - S * 0.028, base - S * 0.38, S * 0.056, S * 0.38);
        g.strokeStyle = 'hsla(30,8%,34%,0.6)'; g.lineWidth = 0.9;
        for (let k = 1; k <= 3; k++) {
          g.beginPath(); g.moveTo(cx - S * 0.028, base - S * 0.38 * k / 4); g.lineTo(cx + S * 0.028, base - S * 0.38 * k / 4 - 1); g.stroke();
        }
        g.fillStyle = col(sp.l, 0.95);
        g.beginPath(); g.ellipse(cx - S * 0.08, base - S * 0.44, S * 0.11, S * 0.09, 0, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(cx + S * 0.08, base - S * 0.41, S * 0.10, S * 0.08, 0, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(cx, base - S * 0.55, S * 0.11, S * 0.09, 0, 0, 6.2832); g.fill();
        break;
    }
  },

  /* =======================================================================
   *  一句话提示
   * ===================================================================== */
  toast(text, ms = 4200) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('hide');
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => {
      t.classList.remove('show');
      t.classList.add('hide');
    }, ms);
  },

  showHint(text) {
    const h = this.el.hint;
    if (text) h.textContent = text;
    h.classList.add('show');
  },
  hideHint() { this.el.hint.classList.remove('show'); },

  /** 左上角那个点：颜色是季节，明暗是昼夜 */
  setClock(season, dayFrac) {
    const SEASON_COL = ['#a8d07a', '#5fa845', '#d99a45', '#cfe0ea'];
    const sun = Math.sin((dayFrac - 0.25) * Math.PI * 2);
    const lum = U.lerp(0.34, 1.0, U.clamp(sun * 1.4 + 0.42, 0, 1));
    const c = SEASON_COL[season];
    // 把季节色往夜色里压
    const hex = c.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16), gg = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    const nr = U.lerp(28, r, lum), ng = U.lerp(34, gg, lum), nb = U.lerp(52, b, lum);
    this.el.clock.style.background = `rgb(${nr | 0},${ng | 0},${nb | 0})`;
    this.el.clock.style.boxShadow = `0 0 0 1px rgba(255,255,255,${0.10 + lum * 0.22}), 0 1px 8px rgba(0,0,0,${0.18 + (1 - lum) * 0.2})`;
  },

  /* =======================================================================
   *  输入
   * ===================================================================== */
  bindInput() {
    const cv = Render.canvas;
    this.pointers = new Map();
    this.spaceDown = false;
    this.panning = false;
    this.painting = false;
    this.lastPaint = { gx: -1, gy: -1 };
    this._pinch = 0;

    const isTouch = () => this.pointers.size > 0 && [...this.pointers.values()][0].type === 'touch';

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, {
        type: e.pointerType, x0: e.clientX, y0: e.clientY,
        x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), pan: false,
      });
      this.idle = 0;

      // 右键 / 中键 / 空格+左键 → 平移
      if (e.button === 1 || e.button === 2 || this.spaceDown) {
        this.panning = true;
        this.pointers.get(e.pointerId).pan = true;
      } else if (e.pointerType === 'mouse') {
        this.painting = true;      // 左键：可以拖着连着放
        this.lastPaint = { gx: -1, gy: -1 };
        this.paintAt(e.clientX, e.clientY);
      }

      if (this.pointers.size === 2) {
        this.painting = false;
        this._pinch = this.pinchDist();
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      this.idle = 0;
      if (p) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.moved += Math.hypot(dx, dy);
        p.x = e.clientX; p.y = e.clientY;

        if (this.pointers.size === 1) {
          // 触摸：拖动超过一点点就算平移（不然没法看地图）
          if (p.type === 'touch' && p.moved > 9) p.pan = true;
          if (p.pan || this.panning) {
            const YS = CFG.RENDER.ySquash;
            Cam.x -= dx / Cam.zoom;
            Cam.y -= dy / Cam.zoom;
          } else if (this.painting && p.type === 'mouse') {
            this.paintAt(e.clientX, e.clientY);
          }
        }
      }

      if (this.pointers.size === 2 && this._pinch > 0) {
        const d = this.pinchDist();
        const pts = [...this.pointers.values()];
        const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        Render.zoomAt(mx, my, d / this._pinch);
        this._pinch = d;
      }

      const c = Render.screenToCell(e.clientX, e.clientY);
      this.hoverCell = c;
    });

    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p) {
        const quick = performance.now() - p.t < 550 && p.moved < 12;
        // 触摸点一下 / 鼠标单击（没拖动过）→ 放下
        if (quick && (p.type === 'touch' || e.button === 0) && !p.pan) {
          this.paintAt(e.clientX, e.clientY);
        }
      }
      if (this.pointers.size === 0) { this.panning = false; this.painting = false; this._pinch = 0; }
      if (this.pointers.size < 2) this._pinch = 0;
      this.idle = 0;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hoverCell = null;
    });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.idle = 0;
      const f = Math.pow(0.9988, e.deltaY);
      Render.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });

    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { this.spaceDown = true; e.preventDefault(); }
      if (e.key === 'h' || e.key === 'H') this.toggleUI();
      if (e.key === 's' || e.key === 'S') this.toggleSound();
      if (e.key === 'r' || e.key === 'R') this.game.askReset();
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const list = CFG.SPECIES.filter(s => s.plantable && this.unlocked.has(s.id));
        if (list[num - 1]) this.select(list[num - 1].id);
      }
      this.idle = 0;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
  },

  pinchDist() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  },

  /** 在屏幕某处放下一个（拖着走的时候会跳过重复格子） */
  paintAt(sx, sy) {
    const c = Render.screenToCell(sx, sy);
    if (this.lastPaint.gx === c.gx && this.lastPaint.gy === c.gy) return;
    this.lastPaint = c;
    this.game.place(c.gx, c.gy);
  },

  /* =======================================================================
   *  角落按钮
   * ===================================================================== */
  bindButtons() {
    this.el.btnHide.addEventListener('click', () => this.toggleUI());
    this.el.btnSound.addEventListener('click', () => this.toggleSound());
    this.el.btnReset.addEventListener('click', () => this.game.askReset());
  },

  toggleUI() {
    this.uiVisible = !this.uiVisible;
    this.el.ui.classList.toggle('hidden', !this.uiVisible);
  },

  toggleSound() {
    const on = !Sound.enabled;
    Sound.setEnabled(on);
    this.el.btnSound.classList.toggle('off', !on);
    this.el.btnSound.textContent = on ? '♪' : '♪̸';
  },

  /** 静置一会儿，界面自己淡下去 */
  update(dt) {
    this.idle += dt;
    const fade = this.idle > 6 && !this.overBar;
    this.el.ui.classList.toggle('faded', fade && this.uiVisible);
  },
};
