/* =============================================================================
 *  render.js —— 画面
 *  ---------------------------------------------------------------------------
 *  这里没有数字，只有颜色。土壤好不好、生态起来了没有，全部靠画面说：
 *
 *    · 地面用一张「一格一像素」的图放大绘制，天然得到连续的柔和渐变
 *      —— 从灰黄到深褐再到苍绿，是逐像素插值出来的，不会突变。
 *    · 植物是程序化画的：每株有自己的随机形状，会随风摆，会随季节变色。
 *    · 影子、雾、昼夜色温全部随时间连续变化。
 *
 *  想让画面更「干净柔和」还是更「有颗粒感」，改 CFG.RENDER 就行。
 * ========================================================================== */

const Cam = {
  x: 0, y: 0, zoom: 1, vw: 800, vh: 600, dpr: 1,
};

/**
 * 每个物种对「季节变色」的敏感程度。
 * 1 = 完全跟着季节走（树、草会变黄变枯）；0 = 几乎不变（石头、蘑菇）。
 * 想调的话直接改这张表，或把它挪进 config.js。
 */
const SEASON_SENS = {
  lichen: 0.55, grass: 1.0, moss: 0.75, rock: 0.0,
  shrub: 0.95, flower: 0.30, tree: 1.0,
  fern: 0.85, reed: 0.9, berry: 0.6, birch: 0.9, mushroom: 0.15,
};

/* 远景草的色板档数。档数越多颜色越细腻，但画布要切换的批次也越多。
 * 5 档大约是这个尺寸下的甜点：看不出色阶，批次也够少。 */
const GRASS_PAL = 5;

const Render = {

  /* ======================================================================= */
  init(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.W = CFG.WORLD;

    // 地面：一格一像素，放大后自然柔和
    this.gnd = document.createElement('canvas');
    this.gnd.width = this.W.cols; this.gnd.height = this.W.rows;
    this.gndCtx = this.gnd.getContext('2d');
    this.gndImg = this.gndCtx.createImageData(this.W.cols, this.W.rows);
    // 边缘淡出用的 alpha 表
    this.edgeA = new Uint8Array(this.W.cols * this.W.rows);
    for (let gy = 0; gy < this.W.rows; gy++) {
      for (let gx = 0; gx < this.W.cols; gx++) {
        const de = Math.min(gx, this.W.cols - 1 - gx, gy, this.W.rows - 1 - gy);
        this.edgeA[gy * this.W.cols + gx] = U.smoothstep(0, 5, de) * 255;
      }
    }

    this.buildTextures();

    this.time = 0;
    this.wind = 0.5;
    this.windTime = 0;
    this.leaves = [];
    this.pollen = [];
    this.snowflakes = [];
    this._colCache = new Map();
    this.mottle = null;         // 土壤斑驳场（每次换地生成一次，见 _ensureMottle）
    this._mottleFor = null;

    /* 复用的临时对象 / 数组。
     * 成林后一屏上万株植物，如果每一株都 new 一个坐标对象、new 一个颜色数组，
     * 一帧就是两万个短命对象 —— 触发的垃圾回收会让画面每隔几秒卡一下。
     * 所以这些「热路径」上的小对象一律复用，绝不在循环里新建。 */
    this._pcA = { x: 0, y: 0, s: 1 };   // 投影结果：地面
    this._pcB = { x: 0, y: 0, s: 1 };   // 投影结果：顶端
    this._scOut = [0, 0, 0];            // seasonalColor 的输出
    this._scArr = [];                   // 每个物种一张季节色表（数字下标，不做字符串拼接）
    this._shCache = [];                 // 影子色字符串表（按下标取，不拼字符串）
    this._poCache = [];                 // 花粉色字符串表
    this._pal = null;                   // 远景草色板（见 _buildGrassPal）
    this._palKey = -1;
    this._grassShade = 0;               // 当前这株草用色板里的第几档（每帧在 drawPlant 里更新）

    this.env = this.computeEnv(0.3, 0);
    this.resize();
  },

  /* =======================================================================
   *  土壤斑驳场
   * -----------------------------------------------------------------------
   *  荒原的土不是一块纯色，而是有大块的深浅斑、也有细碎的颗粒。
   *  这个场只为「当前这片地」算一次（换地或读档时重算），之后每帧只查表，
   *  所以既能长得自然，又几乎不花性能。
   * ===================================================================== */
  _ensureMottle(world) {
    if (this._mottleFor === world && this.mottle) return;
    const n = world.n, cols = world.cols;
    const m = new Float32Array(n);
    const n1 = U.makeNoise2D((world.seed ^ 0x9E3779B1) >>> 0);
    const n2 = U.makeNoise2D((world.seed ^ 0x85EBCA6B) >>> 0);
    for (let i = 0; i < n; i++) {
      const gx = i % cols, gy = (i / cols) | 0;
      const big = U.fbm(n1, gx * 0.07, gy * 0.07, 3);    // 大斑块
      const fine = U.fbm(n2, gx * 0.32, gy * 0.32, 2);   // 细碎
      m[i] = big * 0.72 + fine * 0.28;                   // 大致 -1 ~ 1
    }
    this.mottle = m;
    this._mottleFor = world;
  },

  /* =======================================================================
   *  纹理：干裂纹 + 颗粒（让柔和的地面不至于太平）
   * ===================================================================== */
  buildTextures() {
    // ---- 干裂纹：荒原上很明显；土变好、地被覆盖后整体淡出 ----
    const T = CFG.RENDER.crack.tile;
    const c = document.createElement('canvas'); c.width = T; c.height = T;
    const g = c.getContext('2d');
    const rnd = U.mulberry32(4242);
    // 土色偏暖、半透明 —— 是「地的纹路」，不是画上去的线
    g.strokeStyle = 'rgba(86,68,46,0.6)';
    g.lineCap = 'round';

    // 先把每条裂缝的「路径点」一次性算好，再把它平移着画 9 份。
    // 关键：9 份必须用同一条路径，接缝处的裂缝才能连起来 ——
    // 如果每次都重新随机，就会变成 9 倍密度的乱线（之前就是这个 bug）。
    const paths = [];
    for (let i = 0; i < CFG.RENDER.crack.lines; i++) {
      let x = rnd() * T, y = rnd() * T;
      let ang = rnd() * 6.2832;
      const pts = [[x, y]];
      const segs = 3 + ((rnd() * 5) | 0);        // 折点少一点 → 更像直裂，不是卷毛
      for (let s = 0; s < segs; s++) {
        ang += (rnd() - 0.5) * 0.7;              // 摆幅小 → 走势稳
        const len = 7 + rnd() * 15;
        x += Math.cos(ang) * len; y += Math.sin(ang) * len;
        pts.push([x, y]);
      }
      paths.push({ pts, w: 0.55 + rnd() * 0.6 });
    }
    for (const p of paths) {
      for (let wx = -1; wx <= 1; wx++) for (let wy = -1; wy <= 1; wy++) {
        g.beginPath();
        g.moveTo(p.pts[0][0] + wx * T, p.pts[0][1] + wy * T);
        for (let k = 1; k < p.pts.length; k++) g.lineTo(p.pts[k][0] + wx * T, p.pts[k][1] + wy * T);
        g.lineWidth = p.w;
        g.stroke();
      }
    }
    this.crackTex = c;

    // ---- 颗粒噪点 ----
    const T2 = CFG.RENDER.grain.tile;
    const c2 = document.createElement('canvas'); c2.width = T2; c2.height = T2;
    const g2 = c2.getContext('2d');
    const img = g2.createImageData(T2, T2);
    const rnd2 = U.mulberry32(99);
    for (let i = 0; i < T2 * T2; i++) {
      const v = 128 + (rnd2() - 0.5) * 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g2.putImageData(img, 0, 0);
    this.grainTex = c2;
  },

  /* =======================================================================
   *  尺寸
   * ===================================================================== */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    Cam.dpr = dpr; Cam.vw = w; Cam.vh = h;
    this._colCache.clear();
  },

  /* =======================================================================
   *  坐标
   * ===================================================================== */
  project(wx, wy, wz = 0) {
    const s = Cam.zoom, YS = CFG.RENDER.ySquash, ZL = CFG.RENDER.zLift;
    return {
      x: (wx - Cam.x) * s + Cam.vw * 0.5,
      y: ((wy * YS - wz * ZL) - Cam.y) * s + Cam.vh * 0.5,
      s, W: Cam.vw, H: Cam.vh,
    };
  },

  /** 和 project 一样，但把结果写进传进来的对象里 —— 热路径专用，避免每帧上万次分配 */
  projectInto(wx, wy, wz, out) {
    const s = Cam.zoom, YS = CFG.RENDER.ySquash, ZL = CFG.RENDER.zLift;
    out.x = (wx - Cam.x) * s + Cam.vw * 0.5;
    out.y = ((wy * YS - wz * ZL) - Cam.y) * s + Cam.vh * 0.5;
    out.s = s;
    return out;
  },

  /* 带透明度的颜色字符串，按下标缓存。
   * 影子一帧要画几千次，`rgba(...,${a})` 这种写法每次都新建一个字符串，
   * 堆里全是垃圾，垃圾回收一来画面就顿一下。量化后查表就完全没开销。 */
  _alphaCol(cache, rgb, a) {
    let k = (a * 200) | 0;
    if (k < 0) k = 0; else if (k > 200) k = 200;
    let v = cache[k];
    if (v === undefined) v = cache[k] = `rgba(${rgb},${(k / 200).toFixed(3)})`;
    return v;
  },
  screenToWorld(sx, sy) {
    const s = Cam.zoom, YS = CFG.RENDER.ySquash;
    return {
      x: (sx - Cam.vw * 0.5) / s + Cam.x,
      y: ((sy - Cam.vh * 0.5) / s + Cam.y) / YS,
    };
  },
  screenToCell(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return { gx: Math.floor(w.x / this.W.cell), gy: Math.floor(w.y / this.W.cell) };
  },
  /** 以屏幕上某点为锚点缩放（滚轮、双指捏合） */
  zoomAt(sx, sy, factor) {
    const YS = CFG.RENDER.ySquash;
    const b = this.screenToWorld(sx, sy);
    const bx = b.x, by = b.y * YS;

    Cam.zoom = U.clamp(Cam.zoom * factor, CFG.RENDER.camera.minZoom, CFG.RENDER.camera.maxZoom);

    const a = this.screenToWorld(sx, sy);
    Cam.x += bx - a.x;
    Cam.y += by - a.y * YS;
  },

  /** 当前可见的格子范围（留一点余量，防止高个子植物在边缘被裁掉） */
  visibleRange() {
    const a = this.screenToWorld(0, 0);
    const b = this.screenToWorld(Cam.vw, Cam.vh);
    const c = this.W.cell;
    return {
      x0: Math.max(0, Math.floor(a.x / c) - 1),
      y0: Math.max(0, Math.floor(a.y / c) - 4),
      x1: Math.min(this.W.cols - 1, Math.ceil(b.x / c) + 1),
      y1: Math.min(this.W.rows - 1, Math.ceil(b.y / c) + 2),
    };
  },

  /* =======================================================================
   *  光照环境（昼夜 + 季节）
   * ===================================================================== */
  computeEnv(dayFrac, season) {
    const D = CFG.RENDER.day;
    // 关键时刻表：t 是一天里的位置（0 午夜 0.5 正午 1 午夜）
    const KEYS = [
      [0.00, D.night], [0.19, D.night], [0.27, D.dawn], [0.36, D.morning],
      [0.50, D.noon], [0.64, D.morning], [0.75, D.evening], [0.83, D.dusk],
      [0.91, D.night], [1.00, D.night],
    ];
    let i = 0;
    while (i < KEYS.length - 2 && dayFrac > KEYS[i + 1][0]) i++;
    const [t0, k0] = KEYS[i], [t1, k1] = KEYS[i + 1];
    const k = U.clamp((dayFrac - t0) / (t1 - t0), 0, 1);
    const ks = U.smoothstep(0, 1, k);

    const tint = U.mixRGB(k0.tint, k1.tint, ks);
    const amount = U.lerp(k0.amount, k1.amount, ks);
    let bright = U.lerp(k0.bright, k1.bright, ks);

    // 季节修正：夏天通透偏暖，冬天灰冷
    const sMod = [1.0, 1.06, 0.97, 0.88][season];
    bright *= sMod;

    // 太阳位置：0.25 东边升起，0.75 西边落下
    const sunH = Math.sin((dayFrac - 0.25) * Math.PI * 2);   // -1..1
    const sunX = Math.cos((dayFrac - 0.25) * Math.PI * 2);   // +1 东 → -1 西

    const SH = CFG.RENDER.shadow;
    const dayness = U.clamp(sunH, 0, 1);
    const len = SH.maxLen * (1 - dayness) * 0.9 + 2.5;
    const shadowAlpha = SH.alpha * U.clamp(sunH + 0.25, 0, 1);

    /* 光照指纹：把「亮度 + 叠加强度 + 叠加色」量化成一个小整数。
     * 取色表里存的是【已经乘过光照】的颜色字符串，所以光照一变就必须作废 ——
     * 否则入夜之后地面暗下去了，植物还停在白天的颜色上，像贴上去的。
     * 量化之后，光照稳定时表一直有效（快），过渡时才重建（准）。 */
    const litK = (Math.round(bright * 16) << 17) | (Math.round(amount * 24) << 12)
               | ((tint[0] >> 4) << 8) | ((tint[1] >> 4) << 4) | (tint[2] >> 4);
    if (this._litK !== litK) { this._colCache.clear(); this._litK = litK; }

    const env = {
      bright, tint, tintAmt: amount, litK,
      sunH, sunX, dayness,
      shadowDX: -sunX * len, shadowDY: len * 0.34 + 1,
      shadowAlpha,
      cache: this._colCache,
      // 带光照的取色（做了量化缓存，避免每帧几万次字符串拼接）
      col(h, s, l, a = 1) {
        const hq = ((h % 360 + 360) % 360 / 3) | 0;
        const sq = U.clamp(s / 4, 0, 63) | 0;
        const lq = U.clamp(l / 2, 0, 63) | 0;
        const aq = U.clamp(a * 12, 0, 15) | 0;
        const key = (hq << 18) | (sq << 12) | (lq << 4) | aq;
        let v = env.cache.get(key);
        if (v === undefined) {
          const rgb = U.hslToRGB(hq * 3, sq * 4, lq * 2);
          let r = U.clamp(rgb[0] * env.bright, 0, 255);
          let gg = U.clamp(rgb[1] * env.bright, 0, 255);
          let b = U.clamp(rgb[2] * env.bright, 0, 255);
          r = U.lerp(r, env.tint[0], env.tintAmt);
          gg = U.lerp(gg, env.tint[1], env.tintAmt);
          b = U.lerp(b, env.tint[2], env.tintAmt);
          v = `rgba(${r | 0},${gg | 0},${b | 0},${(aq / 12).toFixed(2)})`;
          env.cache.set(key, v);
        }
        return v;
      },
      // 深色的线（描边、动物轮廓），也跟着光照走
      ink(a = 1) { return env.col(30, 12, 18 + (1 - env.bright) * -6, a); },
    };
    return env;
  },

  /* =======================================================================
   *  地面：把土壤画成一张会呼吸的图
   * -----------------------------------------------------------------------
   *  每个格子的颜色由五件事决定：水分、养分、地被覆盖、积水、积雪。
   *  这五件事都是连续的，所以地面颜色的变化也是连续的 ——
   *  玩家看到的「绿意蔓延」不是切换，是插值。
   * ===================================================================== */
  updateGround(world, env, ctx) {
    const G = CFG.RENDER.ground;
    const d = this.gndImg.data;
    const n = world.n, cols = this.W.cols, rows = this.W.rows;
    const snowAmt = world.snowAmt * CFG.RENDER.snow.maxCover;

    // 季节地毯色：在相邻两季之间连续插值
    const CARPET = [G.carpetSpring, G.carpetSummer, G.carpetAutumn, G.carpetWinter];
    const sp = ctx.seasonProgress;
    const cA = CARPET[ctx.season], cB = CARPET[(ctx.season + 1) % 4];
    const cr = U.lerp(cA[0], cB[0], sp), cg = U.lerp(cA[1], cB[1], sp), cb = U.lerp(cA[2], cB[2], sp);

    const br = env.bright, ta = env.tintAmt;
    const t0 = env.tint[0], t1 = env.tint[1], t2 = env.tint[2];

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        const m = world.mois[i], nu = world.nut[i];
        const cp = U.clamp(world.carpet[i], 0, 1);
        const wt = world.wet[i], rk = world.rock[i], hl = world.hill[i];

        /* --- 1. 土：干 → 湿，再由养分推向深褐 --- */
        const t1a = m * 0.85, t2a = nu;
        let r = U.lerp(G.dry[0], G.moist[0], t1a);
        let g = U.lerp(G.dry[1], G.moist[1], t1a);
        let b = U.lerp(G.dry[2], G.moist[2], t1a);
        r = U.lerp(r, G.rich[0], t2a);
        g = U.lerp(g, G.rich[1], t2a);
        b = U.lerp(b, G.rich[2], t2a);

        /* --- 2. 碎石地：偏灰冷 --- */
        if (rk > 0.01) {
          r = U.lerp(r, 150, rk * 0.45); g = U.lerp(g, 146, rk * 0.45); b = U.lerp(b, 140, rk * 0.45);
        }

        /* --- 3. 地被覆盖：这是「绿色连成片」的地方 --- */
        const cover = U.clamp(cp, 0, 1) * G.carpetMax;
        r = U.lerp(r, cr, cover); g = U.lerp(g, cg, cover); b = U.lerp(b, cb, cover);

        /* --- 4. 斑驳：大块深浅 + 细碎颗粒。荒原斑驳，沃土均匀 --- */
        this._ensureMottle(world);
        const bare = (1 - nu) * (1 - cover * 0.7);
        const rough = this.mottle[i] * 9 + (U.hash01(i) - 0.5) * 4.5;
        r += rough * bare; g += rough * bare * 0.9; b += rough * bare * 0.7;

        /* --- 5. 地形阴影 --- */
        r *= hl; g *= hl; b *= hl;

        /* --- 6. 水：越深越暗越蓝 --- */
        if (wt > 0.01) {
          const wc = U.mixRGB(CFG.RENDER.water.shallow, CFG.RENDER.water.deep, U.clamp(wt * 1.2 - 0.15, 0, 1));
          r = U.lerp(r, wc[0], wt); g = U.lerp(g, wc[1], wt); b = U.lerp(b, wc[2], wt);
        }

        /* --- 7. 雪：冬天盖一层，树荫下和草丛里薄一些 --- */
        if (snowAmt > 0.01) {
          const sc = snowAmt * (1 - cover * 0.45) * (0.75 + 0.25 * hl);
          r = U.lerp(r, 238, sc); g = U.lerp(g, 240, sc); b = U.lerp(b, 245, sc);
        }

        /* --- 8. 昼夜光照 --- */
        r = r * br; g = g * br; b = b * br;
        r = U.lerp(r, t0, ta); g = U.lerp(g, t1, ta); b = U.lerp(b, t2, ta);

        const o = i * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b;
        d[o + 3] = this.edgeA[i];
      }
    }
    this.gndCtx.putImageData(this.gndImg, 0, 0);
  },

  /* =======================================================================
   *  主绘制
   * ===================================================================== */
  frame(dt, world, ctx, ui) {
    const g = this.g;
    const YS = CFG.RENDER.ySquash;
    this.time += dt;
    this.windTime += dt;

    // --- 风：两个不同频率的正弦叠加，形成自然的阵风 ---
    const W = CFG.RENDER.wind;
    const gust = (Math.sin(this.windTime * W.gustSpeed) * 0.6
                + Math.sin(this.windTime * W.gustSpeed * 2.7 + 1.3) * 0.4) * 0.5 + 0.5;
    this.wind = W.base + gust * W.gustAmp;

    // --- 光照与雾（先算好，后面植物画影子、画雾都要用同一个值） ---
    this.env = this.computeEnv(ctx.dayFrac, ctx.season);
    const env = this.env;
    ctx.fog = this.fogAmount(world, ctx);

    // --- 地面 ---
    this.updateGround(world, env, ctx);

    // --- 背景（地图之外的远处） ---
    const far = env.col(38, 10, U.clamp(52 * env.bright, 10, 92));
    g.fillStyle = far;
    g.fillRect(0, 0, Cam.vw, Cam.vh);

    // --- 铺地面（放大 → 柔和渐变） ---
    const c = this.W.cell;
    const p0 = this.project(c * 0.5, c * 0.5, 0);
    const p1 = this.project((this.W.cols - 0.5) * c, (this.W.rows - 0.5) * c, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.gnd, 0, 0, this.W.cols, this.W.rows,
                p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);

    // --- 纹理：干裂纹（荒原明显，沃土消失） + 颗粒 ---
    const recovery = U.clamp(world.forestness * 0.6 + (world.maxNut) * 0.5, 0, 1);
    const gndRect = { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };

    g.save();
    g.beginPath(); g.rect(gndRect.x, gndRect.y, gndRect.w, gndRect.h); g.clip();
    g.globalAlpha = CFG.RENDER.crack.alpha * (1 - recovery) * 0.9;
    g.fillStyle = g.createPattern(this.crackTex, 'repeat');
    g.save(); g.translate(gndRect.x % CFG.RENDER.crack.tile, gndRect.y % CFG.RENDER.crack.tile);
    g.fillRect(-CFG.RENDER.crack.tile, -CFG.RENDER.crack.tile, gndRect.w + CFG.RENDER.crack.tile * 2, gndRect.h + CFG.RENDER.crack.tile * 2);
    g.restore();

    g.globalAlpha = CFG.RENDER.grain.alpha;
    g.globalCompositeOperation = 'overlay';
    g.fillStyle = g.createPattern(this.grainTex, 'repeat');
    g.save(); g.translate(gndRect.x % CFG.RENDER.grain.tile, gndRect.y % CFG.RENDER.grain.tile);
    g.fillRect(-CFG.RENDER.grain.tile, -CFG.RENDER.grain.tile, gndRect.w + CFG.RENDER.grain.tile * 2, gndRect.h + CFG.RENDER.grain.tile * 2);
    g.restore();
    g.globalCompositeOperation = 'source-over';
    g.restore();

    // --- 水面的波光 ---
    this.drawWater(g, world, env);

    // --- 植物（按行遍历 = 天然的从后往前画） ---
    const vr = this.visibleRange();
    const zoom = Cam.zoom;
    // 远看的时候简化：草只画一撮，树只留轮廓（省性能，也更像远观）
    let detail = zoom >= 1.15 ? 2 : (zoom >= 0.7 ? 1 : 0);

    // 自适应细节：先数一数这一屏里有多少株要画。
    // 成林之后一屏可能上万株，全按高细节画会掉到十几帧；
    // 而远看时本来就分辨不出单株的细节，所以人越多就画得越简。
    // 两个门槛写在 CFG.RENDER.detailCounts 里，好调。
    let nDraw = 0;
    for (let gy = vr.y0; gy <= vr.y1; gy++) {
      const base = gy * this.W.cols;
      for (let gx = vr.x0; gx <= vr.x1; gx++) {
        const i = base + gx;
        if (world.cellP[i] >= 0) nDraw++;
        if (world.cellU[i] >= 0) nDraw++;
      }
    }
    const dc = CFG.RENDER.detailCounts;
    // 一格在屏幕上有多少像素 —— 用它判断玩家是不是凑近了看
    const cellPx = CFG.WORLD.cell * zoom;
    const floorDetail = cellPx >= dc.keepDetailCellPx ? 1 : 0;
    if (nDraw > dc.downTo1) detail = Math.min(detail, 1);
    if (nDraw > dc.downTo0) detail = Math.min(detail, floorDetail);

    // 远看时的草默认走「色板」：颜色不再是每株现算，而是先备好几档，
    // 每株按下标取（详见 _buildGrassPal 的注释）。
    if (detail === 0) this._buildGrassPal(ctx);

    for (let gy = vr.y0; gy <= vr.y1; gy++) {
      for (let gx = vr.x0; gx <= vr.x1; gx++) {
        const i = gy * this.W.cols + gx;
        // 先画脚底下的，再画立着的 —— 于是蕨和苔藓会待在树荫里
        const ui = world.cellU[i];
        if (ui >= 0) this.drawPlant(g, world.plants[ui], env, ctx, detail);
        const pi = world.cellP[i];
        if (pi >= 0) this.drawPlant(g, world.plants[pi], env, ctx, detail);
      }
    }

    // --- 动物 ---
    Animals.draw(g, (x, y, z) => this.project(x, y, z), env);

    // --- 落叶 / 花粉 / 雪 ---
    this.updateParticles(dt, world, ctx);
    this.drawParticles(g, env);

    // --- 雾（清晨，以及森林蒸腾） ---
    this.drawFog(g, world, ctx, env);

    // --- 光标：这里能活吗？用颜色回答 ---
    if (ui && ui.hoverCell) this.drawCursor(g, world, ui);

    // --- 夜晚的一点暗角，让画面收一下 ---
    if (env.dayness < 0.55) {
      const v = (0.55 - env.dayness) / 0.55;
      const grd = g.createRadialGradient(Cam.vw / 2, Cam.vh / 2, Math.min(Cam.vw, Cam.vh) * 0.25,
                                         Cam.vw / 2, Cam.vh / 2, Math.max(Cam.vw, Cam.vh) * 0.78);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(6,10,26,${0.42 * v})`);
      g.fillStyle = grd; g.fillRect(0, 0, Cam.vw, Cam.vh);
    }
  },

  /* =======================================================================
   *  水面波光
   * ===================================================================== */
  drawWater(g, world, env) {
    const c = this.W.cell, vr = this.visibleRange();
    const t = this.time;
    g.save();
    g.lineCap = 'round';
    for (let gy = vr.y0; gy <= vr.y1; gy++) {
      for (let gx = vr.x0; gx <= vr.x1; gx++) {
        const i = gy * this.W.cols + gx;
        const wt = world.wet[i];
        if (wt < 0.34) continue;
        const p = this.project((gx + 0.5) * c, (gy + 0.5) * c, 0);
        const s = p.s;
        // 每格一条缓慢横移的高光，相位由格子决定 → 整片水有起伏
        const ph = U.hash01(i) * 6.2832;
        const k = (Math.sin(t * 0.9 + ph) * 0.5 + 0.5);
        const a = CFG.RENDER.water.rippleAlpha * wt * (0.35 + k * 0.65);
        g.strokeStyle = `rgba(236,248,252,${a})`;
        g.lineWidth = Math.max(0.7, 1.1 * s);
        const w2 = c * s * 0.42;
        const ox = (k - 0.5) * w2 * 1.4;
        g.beginPath();
        g.moveTo(p.x - w2 + ox, p.y + Math.sin(ph) * 2 * s);
        g.quadraticCurveTo(p.x + ox, p.y + (Math.sin(ph) * 2 - 1.4) * s, p.x + w2 + ox, p.y + Math.sin(ph) * 2 * s);
        g.stroke();
      }
    }
    g.restore();
  },

  /* =======================================================================
   *  远景草色板
   *  ---------------------------------------------------------------------------
   *  草是全场最多的一种植物（成林后常常五六千株），而画布有个脾气：
   *  每换一次 fillStyle 就要重新开一批绘制。如果每株草都现算一个颜色，
   *  一帧就是几千批，实测比「大家共用几档颜色」慢两三倍。
   *
   *  所以远看时先把颜色备成 GRASS_PAL 档，每株按下标取。
   *  色号由土壤斑驳场决定（那是一个空间上连续的噪声场），
   *  于是相邻的草常常是同一档 —— 既省批次，看起来也像自然的色斑，
   *  比「每株乱跳一个颜色」更耐看。
   * ===================================================================== */
  _buildGrassPal(ctx) {
    const key = ctx.season * 100000 + Math.round(ctx.seasonProgress * 48) * 100 + (this.env.litK & 63);
    if (this._palKey === key) return;
    if (!this._pal) this._pal = new Array(GRASS_PAL * 2);
    const sp = CFG.SPECIES[SP_INDEX['grass']];
    const pal = this._pal;
    // 两套：0 = 正常，1 = 休眠（缺水少肥退回去的枯黄）
    for (let d = 0; d < 2; d++) {
      const b = this._seasonColorBase(sp, ctx.season, ctx.seasonProgress, d === 1);
      for (let k = 0; k < GRASS_PAL; k++) {
        const t = k / (GRASS_PAL - 1) - 0.5;                 // -0.5 ~ +0.5
        pal[d * GRASS_PAL + k] = this.env.col(b[0] + t * 20, b[1] + t * 8, b[2] + t * 18, 0.78);
      }
    }
    this._palKey = key;
  },

  /* =======================================================================
   *  一株植物
   * ===================================================================== */
  drawPlant(g, p, env, ctx, detail) {
    const sp = p.sp;
    const c = this.W.cell;
    const mat = p.mat;
    const wx = (p.gx + 0.5) * c, wy = (p.gy + 0.5) * c;
    // 复用投影结果对象（这里一帧要过上万株，不能每次 new）
    const ground = this.projectInto(wx, wy, 0, this._pcA);
    const s = ground.s;
    if (ground.x < -80 || ground.x > Cam.vw + 80 || ground.y < -140 || ground.y > Cam.vh + 80) return;

    // 风：随位置形成掠过整片地的波
    const W = CFG.RENDER.wind;
    const ph = (wx + wy * 0.6) / W.waveLen * 6.2832 - this.windTime * W.waveSpeed;
    const sway = Math.sin(ph) * this.wind * W.sway;

    // 休眠（条件不够，退回去了）→ 颜色枯黄
    const dormant = p.suit < 0.02 && sp.kind !== 'rock';
    const col = this.seasonalColor(sp, ctx.season, ctx.seasonProgress, dormant, p.seed);
    const h = col[0], sa = col[1], l = col[2];

    // 成熟前的高度插值
    const grow = U.smoothstep(0, 1, U.clamp((mat - CFG.GROWTH.sproutMat) / (1 - CFG.GROWTH.sproutMat), 0, 1));
    const H = sp.size * (0.28 + 0.72 * grow);

    // ---- 影子 ----
    // 太矮的植物（远看时的草）影子只有一两个像素，画了也看不见，直接省掉 ——
    // 这一条在成林后能省掉几千次椭圆填充。
    const Hs = H * s;
    if (env.shadowAlpha > 0.01 && Hs > CFG.RENDER.shadow.minHeightPx) {
      const a = env.shadowAlpha * (0.5 + 0.5 * grow) * (1 - ctx.fog * 0.5);
      g.fillStyle = this._alphaCol(this._shCache, '28,24,18', a * 0.55);
      g.beginPath();
      const rx = H * 0.34 * s + 2 * s, ry = H * 0.13 * s + 1 * s;
      g.ellipse(ground.x + env.shadowDX * s * 0.5, ground.y + env.shadowDY * s * 0.5,
                rx, ry, 0, 0, 6.2832);
      g.fill();
    }

    const top = this.projectInto(wx, wy, H, this._pcB);
    const X = top.x, Y = ground.y;      // 本体从地面长到 top

    // 远景的草：颜色不现算，改从色板里取（色号跟着土壤斑驳场走，见 _buildGrassPal）
    if (detail === 0 && sp.id === 'grass' && this.mottle) {
      const mi = p.gy * this.W.cols + p.gx;
      let k = ((this.mottle[mi] + 1) * 0.5 * GRASS_PAL) | 0;
      if (k < 0) k = 0; else if (k >= GRASS_PAL) k = GRASS_PAL - 1;
      this._grassShade = (dormant ? GRASS_PAL : 0) + k;
    }

    switch (sp.id) {
      case 'lichen': this._lichen(g, X, Y, s, h, sa, l, grow, p.seed, env); break;
      case 'moss':   this._moss(g, X, Y, s, h, sa, l, grow, p.seed, env); break;
      case 'grass':  this._grass(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, detail); break;
      case 'flower': this._flower(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, ctx); break;
      case 'shrub':  this._shrub(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, H, detail); break;
      case 'tree':   this._tree(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, H, false, detail); break;
      case 'birch':  this._tree(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, H, true, detail); break;
      case 'fern':   this._fern(g, X, Y, s, h, sa, l, grow, p.seed, sway, env); break;
      case 'reed':   this._reed(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, H); break;
      case 'berry':  this._berry(g, X, Y, s, h, sa, l, grow, p.seed, sway, env, H, ctx); break;
      case 'mushroom': this._mushroom(g, X, Y, s, h, sa, l, grow, p.seed, env); break;
      case 'rock':   this._rock(g, X, Y, s, h, sa, l, grow, p.seed, env); break;
    }
  },

  /**
   * 季节色：春嫩 → 夏沉 → 秋黄 → 冬枯；休眠时枯黄。
   *
   * 这一层是按「物种 + 季节 + 休眠状态」缓存的：季节色对所有同类植物是一样的，
   * 每帧为几千株草各算一遍纯属浪费（这一步曾经是掉帧的大头）。
   * 每株只额外加一点由 seed 决定的固定抖动，看起来才不是复制粘贴。
   *
   * 【注意】返回的是内部复用的数组，只保证在下次调用之前有效。
   * 想留着的话自己拷一份（c.slice()）。
   */
  seasonalColor(sp, season, prog, dormant, seed) {
    // 每个物种一张扁平表，用数字下标寻址 —— 比拼字符串 key + Map 查找快得多，
    // 而且完全不产生新对象（一帧上万次的时候，差别就是会不会卡）
    const si = SP_INDEX[sp.id];
    let arr = this._scArr[si];
    if (arr === undefined) {
      arr = this._scArr[si] = new Array(49 * 4 * 2).fill(null);   // 季度量化 49 档 × 4 季 × 2 种休眠态
    }
    const q = Math.round(prog * 48);                 // 季节进度量化到 1/48
    const k = (q * 4 + season) * 2 + (dormant ? 1 : 0);
    let base = arr[k];
    if (base === null) base = arr[k] = this._seasonColorBase(sp, season, q / 48, dormant);

    // 每株的固定抖动（同一株每帧都一样，所以不会闪）
    const out = this._scOut;
    out[0] = base[0] + (U.hash01(seed) - 0.5) * 10;
    out[1] = base[1];
    out[2] = base[2] + (U.hash01(seed + 7) - 0.5) * 6;
    return out;
  },

  /** 上面那张缓存表里真正算的那部分（不含每株抖动） */
  _seasonColorBase(sp, season, prog, dormant) {
    const sens = SEASON_SENS[sp.id] === undefined ? 1 : SEASON_SENS[sp.id];
    let h = sp.h;
    let s = sp.s, l = sp.l;

    const A = [[6, 4], [-2, -3], [0, 0], [0, 0]][season];       // 春 夏 秋 冬 的基础偏移
    const B = [[-2, -3], [0, 0], [0, 0], [6, 4]][(season + 1) % 4];
    s += U.lerp(A[0], B[0], prog) * sens;
    l += U.lerp(A[1], B[1], prog) * sens;

    // 秋：往黄橙偏；冬：往枯白偏（在两个季节之间连续过渡）
    const toAutumn = this._seasonWeight(season, prog, 2);
    const toWinter = this._seasonWeight(season, prog, 3);
    if (toAutumn > 0) { h = U.lerp(h, 40, 0.72 * toAutumn * sens); s = U.lerp(s, s + 8, toAutumn * sens); }
    if (toWinter > 0) { h = U.lerp(h, 44, 0.5 * toWinter * sens); s *= U.lerp(1, 0.42, toWinter * sens); l = U.lerp(l, l + 15, toWinter * sens); }

    // 休眠：枯
    if (dormant) { h = U.lerp(h, 43, 0.8); s *= 0.38; l = U.lerp(l, l + 9, 1); }
    return [h, U.clamp(s, 0, 100), U.clamp(l, 2, 94)];
  },
  /**
   * 当前时刻离「某季的正中间」有多近（0~1）。
   * 季节变化全靠它做连续插值，所以落叶、变色、积雪都是渐渐发生的。
   */
  _seasonWeight(season, prog, target) {
    const pos = season + prog;                  // 0..4，当前在一年里的位置
    const center = target + 0.5;                // 该季的中心
    let dist = Math.abs(pos - center);
    dist = Math.min(dist, 4 - dist);            // 环形距离
    return U.clamp(1 - dist / 0.85, 0, 1);
  },

  /* ---- 各种形状 ---- */

  // 地衣：贴着地的灰绿斑点
  _lichen(g, x, y, s, h, sa, l, grow, seed, env) {
    const n = 3 + ((grow * 3) | 0);
    for (let k = 0; k < n; k++) {
      const a = U.hash01(seed + k * 3.1) * 6.2832;
      const r = U.hash01(seed + k * 5.7) * 0.42;
      const px = x + Math.cos(a) * r * 12 * s;
      const py = y + Math.sin(a) * r * 5 * s;
      const rr = (1.6 + U.hash01(seed + k) * 2.2) * s * (0.5 + grow * 0.5);
      g.fillStyle = env.col(h, sa * 0.8, l + 4, 0.5 + grow * 0.35);
      g.beginPath(); g.ellipse(px, py, rr, rr * 0.62, 0, 0, 6.2832); g.fill();
    }
  },

  // 苔藓：更密、更深的绒点
  _moss(g, x, y, s, h, sa, l, grow, seed, env) {
    const n = 5 + ((grow * 5) | 0);
    for (let k = 0; k < n; k++) {
      const a = U.hash01(seed + k * 2.3) * 6.2832;
      const r = U.hash01(seed + k * 4.9) * 0.46;
      const px = x + Math.cos(a) * r * 13 * s;
      const py = y + Math.sin(a) * r * 5.5 * s;
      const rr = (1.4 + U.hash01(seed + k * 7) * 1.9) * s * (0.5 + grow * 0.5);
      g.fillStyle = env.col(h + (U.hash01(seed + k) - 0.5) * 16, sa, l - 4 + U.hash01(seed + k * 2) * 10, 0.62 + grow * 0.3);
      g.beginPath(); g.ellipse(px, py, rr, rr * 0.66, 0, 0, 6.2832); g.fill();
    }
  },

  // 草：几根会弯的叶子
  _grass(g, x, y, s, h, sa, l, grow, seed, sway, env, detail) {
    const len = (9 + grow * 12) * s;
    // 远看（成林后一屏上万株）：一株草只画一撮 —— 一次填充就够，看不出差别。
    // 这一档是性能的关键：不这么收，整片林子只有十几帧。
    // 要点是「抖」：位置、宽窄、高矮、深浅都按株随机。
    // 如果每株都用同一个形状，格子就会显形，远看是一片规则的点阵，假得扎眼。
    if (detail === 0) {
      const hs = seed * 5.77;
      const cellPx = this.W.cell * s;                         // 一格在屏幕上的像素
      const jx = (U.hash01(hs) - 0.5) * 0.75 * cellPx;        // 横向抖动
      const jy = (U.hash01(hs + 4) - 0.5) * 0.32 * cellPx;    // 纵向抖动
      const w = (1.0 + U.hash01(hs + 1) * 1.5) * s;
      const hl = len * (0.40 + U.hash01(hs + 2) * 0.70);      // 高矮不一
      const bend = (U.hash01(hs + 3) - 0.5) * 1.6 + sway * 1.1;
      g.fillStyle = this._pal ? this._pal[this._grassShade] : env.col(h, sa, l, 0.78);   // 色板取色，不现算
      g.beginPath();
      g.moveTo(x + jx - w, y + jy);
      g.quadraticCurveTo(x + jx + bend * w * 1.5, y + jy - hl, x + jx + w, y + jy);
      g.closePath(); g.fill();
      return;
    }
    const n = detail === 1 ? 2 : (3 + ((grow * 4) | 0));
    g.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const hs = seed + k * 11.3;
      const ox = (U.hash01(hs) - 0.5) * 11 * s;
      const bend = (U.hash01(hs + 1) - 0.5) * 0.9 + sway * (0.8 + U.hash01(hs + 2) * 0.5);
      const hl = len * (0.62 + U.hash01(hs + 3) * 0.5);
      const tipX = x + ox + bend * hl * 0.55;
      const tipY = y - hl;
      g.strokeStyle = env.col(h + (U.hash01(hs + 4) - 0.5) * 14, sa, l - 6 + U.hash01(hs + 5) * 14, 0.9);
      g.lineWidth = Math.max(0.6, (0.9 + U.hash01(hs + 6) * 0.7) * s);
      g.beginPath();
      g.moveTo(x + ox, y);
      g.quadraticCurveTo(x + ox + bend * hl * 0.25, y - hl * 0.6, tipX, tipY);
      g.stroke();
    }
  },

  // 花：一根细茎 + 一个花头
  _flower(g, x, y, s, h, sa, l, grow, seed, sway, env, ctx) {
    const hl = (10 + grow * 14) * s;
    const tipX = x + sway * hl * 0.35, tipY = y - hl;
    g.strokeStyle = env.col(96, 26, 34, 0.85);
    g.lineWidth = Math.max(0.7, 1.1 * s); g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + sway * hl * 0.2, y - hl * 0.6, tipX, tipY);
    g.stroke();

    if (grow > 0.35) {
      const open = U.smoothstep(0.35, 0.8, grow);
      const rr = (2.0 + open * 2.6) * s;
      const hue = h + (U.hash01(seed) - 0.5) * 40;
      // 花瓣
      const petals = 5;
      for (let k = 0; k < petals; k++) {
        const a = k / petals * 6.2832 + U.hash01(seed + k) * 0.3;
        g.fillStyle = env.col(hue, sa, l + 6, 0.92);
        g.beginPath();
        g.ellipse(tipX + Math.cos(a) * rr * 0.62, tipY + Math.sin(a) * rr * 0.62,
                  rr * 0.55, rr * 0.45, a, 0, 6.2832);
        g.fill();
      }
      g.fillStyle = env.col(48, 70, 68, 1);
      g.beginPath(); g.arc(tipX, tipY, rr * 0.42, 0, 6.2832); g.fill();
    }
  },

  // 灌木：几个叠在一起的不规则圆团（远看时团数减半，省一大半开销）
  _shrub(g, x, y, s, h, sa, l, grow, seed, sway, env, H, detail) {
    const R = H * s * 0.55;
    const cx = x + sway * R * 0.25;
    const cy = y - R * 0.85;
    const blobs = (detail >= 2) ? 3 : 2;
    const seg = (detail >= 2) ? 9 : 6;
    for (let k = 0; k < blobs; k++) {
      const hs = seed + k * 13.7;
      const ox = (U.hash01(hs) - 0.5) * R * 1.25;
      const oy = (U.hash01(hs + 1) - 0.5) * R * 0.55;
      const rr = R * (0.55 + U.hash01(hs + 2) * 0.45) * (0.4 + grow * 0.6);
      g.fillStyle = env.col(h + (U.hash01(hs + 3) - 0.5) * 12, sa, l + (k === 0 ? -8 : 4) + U.hash01(hs + 4) * 6, 0.97);
      g.beginPath();
      // 用几段圆弧拼一个不太圆的形状（手绘感）
      for (let q = 0; q <= seg; q++) {
        const a = q / seg * 6.2832;
        const wob = 1 + (U.hash01(hs + q * 2.7) - 0.5) * 0.22;
        const px = cx + ox + Math.cos(a) * rr * wob;
        const py = cy + oy + Math.sin(a) * rr * 0.82 * wob;
        if (q === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
    }
    // 顶部受光
    if (detail >= 1) {
      g.fillStyle = env.col(h + 6, sa * 0.9, l + 14, 0.28);
      g.beginPath(); g.ellipse(cx - R * 0.18, cy - R * 0.35, R * 0.5, R * 0.28, -0.3, 0, 6.2832); g.fill();
    }
  },

  // 树：树干 + 树冠；白桦是白的、更瘦
  _tree(g, x, y, s, h, sa, l, grow, seed, sway, env, H, isBirch, detail) {
    const th = H * s;                 // 树总高
    const tr = th * (isBirch ? 0.62 : 0.52);   // 树干高度
    const swayX = sway * th * 0.10;

    // 树干
    const bw = Math.max(1, th * (isBirch ? 0.055 : 0.085));
    g.fillStyle = isBirch ? env.col(40, 10, 74, 0.96) : env.col(26, 22, 26, 0.95);
    g.beginPath();
    g.moveTo(x - bw, y);
    g.quadraticCurveTo(x - bw * 0.7 + swayX * 0.3, y - tr * 0.6, x - bw * 0.45 + swayX, y - tr);
    g.lineTo(x + bw * 0.45 + swayX, y - tr);
    g.quadraticCurveTo(x + bw * 0.7 + swayX * 0.3, y - tr * 0.6, x + bw, y);
    g.closePath(); g.fill();

    if (isBirch) {   // 白桦的横向纹理
      g.strokeStyle = env.col(30, 8, 30, 0.5); g.lineWidth = Math.max(0.5, 0.8 * s);
      for (let k = 1; k <= 4; k++) {
        const yy = y - tr * (k / 5);
        g.beginPath(); g.moveTo(x - bw * 0.7 + swayX * (k / 5), yy); g.lineTo(x + bw * 0.7 + swayX * (k / 5), yy - 1 * s); g.stroke();
      }
    }

    if (grow < 0.12) return;   // 还是小苗，没有树冠

    // 树冠：几个圆团，成熟后变大。
    // 成林后一屏可能有几百棵树，树冠是全场最贵的一项 ——
    // 所以远看时团数和圆滑度都减半，轮廓仍然在，帧率能翻一倍。
    const cr = th * (isBirch ? 0.34 : 0.42) * (0.35 + grow * 0.65);
    const cx = x + swayX * 1.15, cy = y - tr - cr * 0.45;
    const blobs = (detail >= 2) ? (isBirch ? 4 : 5) : (detail === 1 ? 3 : 2);
    const seg = (detail >= 2) ? 11 : (detail === 1 ? 8 : 6);
    for (let k = 0; k < blobs; k++) {
      const hs = seed + k * 17.3;
      const a = k / blobs * 6.2832 + U.hash01(hs) * 0.6;
      const rad = cr * (0.42 + U.hash01(hs + 1) * 0.3 + (detail >= 2 ? 0 : 0.14));
      const ox = Math.cos(a) * cr * (0.5 + U.hash01(hs + 2) * 0.42);
      const oy = Math.sin(a) * cr * 0.42 + (U.hash01(hs + 3) - 0.5) * cr * 0.25;
      g.fillStyle = env.col(h + (U.hash01(hs + 4) - 0.5) * 14, sa, l + (k < 2 ? -9 : 5) + U.hash01(hs + 5) * 8, 0.96);
      g.beginPath();
      for (let q = 0; q <= seg; q++) {
        const aa = q / seg * 6.2832;
        const wob = 1 + (U.hash01(hs + q * 3.1) - 0.5) * 0.26;
        const px = cx + ox + Math.cos(aa) * rad * wob;
        const py = cy + oy + Math.sin(aa) * rad * 0.88 * wob;
        if (q === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
    }
    // 受光面
    if (detail >= 1) {
      g.fillStyle = env.col(h + 8, sa * 0.85, l + 18, 0.22);
      g.beginPath(); g.ellipse(cx - cr * 0.35, cy - cr * 0.42, cr * 0.62, cr * 0.34, -0.35, 0, 6.2832); g.fill();
    }
  },

  // 蕨：几片羽状叶，往外摊开
  _fern(g, x, y, s, h, sa, l, grow, seed, sway, env) {
    const n = 4 + ((grow * 4) | 0);
    const L = (13 + grow * 15) * s;
    for (let k = 0; k < n; k++) {
      const hs = seed + k * 9.1;
      const a = -Math.PI / 2 + (U.hash01(hs) - 0.5) * 1.7 + sway * 0.25;
      const lx = x + Math.cos(a) * L * 0.9;
      const ly = y + Math.sin(a) * L * 0.75;
      g.strokeStyle = env.col(h + (U.hash01(hs + 1) - 0.5) * 12, sa, l - 4 + U.hash01(hs + 2) * 10, 0.9);
      g.lineWidth = Math.max(0.6, 1.3 * s); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.35, y + Math.sin(a) * L * 0.6, lx, ly); g.stroke();
      // 小叶
      if (s > 0.8) {
        const leafN = 5;
        for (let q = 1; q <= leafN; q++) {
          const t = q / (leafN + 1);
          const px = U.lerp(x, lx, t) + (U.hash01(hs + q) - 0.5) * 2 * s;
          const py = U.lerp(y, ly, t);
          const ll = L * 0.2 * (1 - Math.abs(t - 0.5) * 1.2);
          g.fillStyle = env.col(h + 4, sa, l + 2, 0.75);
          g.beginPath();
          g.ellipse(px, py, ll * 0.55, ll * 0.22, a + 1.2, 0, 6.2832); g.fill();
          g.beginPath();
          g.ellipse(px, py, ll * 0.55, ll * 0.22, a - 1.2, 0, 6.2832); g.fill();
        }
      }
    }
  },

  // 芦苇：细高的茎，顶上有穗
  _reed(g, x, y, s, h, sa, l, grow, seed, sway, env, H) {
    const n = 3 + ((grow * 4) | 0);
    const L = H * s;
    for (let k = 0; k < n; k++) {
      const hs = seed + k * 8.7;
      const ox = (U.hash01(hs) - 0.5) * 9 * s;
      const hl = L * (0.6 + U.hash01(hs + 1) * 0.5);
      const bend = sway * (0.9 + U.hash01(hs + 2) * 0.4);
      const tx = x + ox + bend * hl * 0.35, ty = y - hl;
      g.strokeStyle = env.col(h + (U.hash01(hs + 3) - 0.5) * 10, sa, l + U.hash01(hs + 4) * 8, 0.9);
      g.lineWidth = Math.max(0.6, 1.0 * s); g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + ox, y);
      g.quadraticCurveTo(x + ox + bend * hl * 0.15, y - hl * 0.6, tx, ty);
      g.stroke();
      if (grow > 0.4) {
        g.fillStyle = env.col(34, 30, 42, 0.85);
        g.beginPath(); g.ellipse(tx, ty - 1 * s, 1.5 * s, 3.4 * s, bend * 0.3, 0, 6.2832); g.fill();
      }
    }
  },

  // 浆果丛：灌木的样子 + 红点
  _berry(g, x, y, s, h, sa, l, grow, seed, sway, env, H, ctx) {
    // 用偏绿的低饱和色画灌木本体（h 是果实的红）
    this._shrub(g, x, y, s, 108, 30, 32, grow, seed, sway, env, H);
    if (grow > 0.5 && ctx.season !== 3) {
      const R = H * s * 0.55;
      const cx = x + sway * R * 0.25, cy = y - R * 0.85;
      const n = 4 + ((U.hash01(seed) * 4) | 0);
      for (let k = 0; k < n; k++) {
        const hs = seed + k * 5.3;
        const ox = (U.hash01(hs) - 0.5) * R * 1.5;
        const oy = (U.hash01(hs + 1) - 0.5) * R * 0.7;
        g.fillStyle = env.col(h + (U.hash01(hs + 2) - 0.5) * 14, sa + 10, l + 6, 0.95);
        g.beginPath(); g.arc(cx + ox, cy + oy, 1.5 * s, 0, 6.2832); g.fill();
      }
    }
  },

  // 蘑菇：一把小伞
  _mushroom(g, x, y, s, h, sa, l, grow, seed, env) {
    const n = 2 + ((U.hash01(seed) * 3) | 0);
    for (let k = 0; k < n; k++) {
      const hs = seed + k * 6.9;
      const ox = (U.hash01(hs) - 0.5) * 10 * s;
      const hh = (3.5 + U.hash01(hs + 1) * 4) * s * (0.5 + grow * 0.5);
      const rw = (2.2 + U.hash01(hs + 2) * 2) * s * (0.5 + grow * 0.5);
      g.fillStyle = env.col(40, 12, 72, 0.95);
      g.fillRect(x + ox - rw * 0.25, y - hh, rw * 0.5, hh);
      g.fillStyle = env.col(h + (U.hash01(hs + 3) - 0.5) * 16, sa, l, 0.96);
      g.beginPath();
      g.ellipse(x + ox, y - hh, rw, rw * 0.72, 0, Math.PI, 0);
      g.fill();
    }
  },

  // 石头：几块不规则的多边形
  _rock(g, x, y, s, h, sa, l, grow, seed, env) {
    const n = 2 + ((U.hash01(seed) * 2) | 0);
    for (let k = 0; k < n; k++) {
      const hs = seed + k * 21.7;
      const ox = (U.hash01(hs) - 0.5) * 10 * s;
      const oy = (U.hash01(hs + 1) - 0.5) * 4 * s;
      const R = (2.6 + U.hash01(hs + 2) * 3.4) * s;
      g.fillStyle = env.col(h + (U.hash01(hs + 3) - 0.5) * 12, sa, l + (U.hash01(hs + 4) - 0.5) * 12, 0.96);
      g.beginPath();
      const seg = 7;
      for (let q = 0; q <= seg; q++) {
        const a = q / seg * 6.2832;
        const wob = 1 + (U.hash01(hs + q * 3.3) - 0.5) * 0.4;
        const px = x + ox + Math.cos(a) * R * wob;
        const py = y + oy + Math.sin(a) * R * 0.7 * wob;
        if (q === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fill();
      // 一点高光
      g.fillStyle = env.col(h, sa * 0.5, l + 16, 0.35);
      g.beginPath(); g.ellipse(x + ox - R * 0.25, y + oy - R * 0.3, R * 0.4, R * 0.2, -0.4, 0, 6.2832); g.fill();
    }
  },

  /* =======================================================================
   *  粒子：落叶 / 花粉 / 雪
   * ===================================================================== */
  updateParticles(dt, world, ctx) {
    // --- 秋天落叶：从树上飘下来 ---
    const P = CFG.RENDER.particles;
    const autumn = this._seasonWeight(ctx.season, ctx.seasonProgress, 2);
    if (autumn > 0.15 && this.leaves.length < P.leafMax && Math.random() < dt * 6 * autumn) {
      const t = world.randomPlantOf('tree', 'birch', 'shrub');
      if (t) {
        this.leaves.push({
          x: t.wx + (Math.random() - 0.5) * 40, y: t.wy - 20 - Math.random() * 30,
          z: 12 + Math.random() * 40, vz: 0, ph: Math.random() * 6.28,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 3,
          h: 24 + Math.random() * 26, life: 0,
        });
      }
    }
    for (let k = this.leaves.length - 1; k >= 0; k--) {
      const lf = this.leaves[k];
      lf.life += dt;
      lf.ph += dt * 2.4;
      lf.z -= (10 + lf.life * 6) * dt;
      lf.x += Math.sin(lf.ph) * 14 * dt + 6 * dt;
      lf.rot += lf.vr * dt;
      if (lf.z <= 0) this.leaves.splice(k, 1);
    }

    // --- 春天花粉：只从「真的开了花」的地方飘起来 ---
    // （以前是不管地上有没有东西都漫天飘白点，荒原上看着像噪点，所以改成
    //   先找到一朵成熟的花，再从它身上飘；没有花就没有花粉。）
    const spring = this._seasonWeight(ctx.season, ctx.seasonProgress, 0);
    if (spring > 0.2 && this.pollen.length < P.pollenMax && Math.random() < dt * 3 * spring) {
      const f = world.randomPlantOf('flower');
      if (f) {
        this.pollen.push({
          x: f.wx + (Math.random() - 0.5) * 24,
          y: f.wy + (Math.random() - 0.5) * 20,
          z: 6 + Math.random() * 14, ph: Math.random() * 6.28, life: 0,
        });
      }
    }
    for (let k = this.pollen.length - 1; k >= 0; k--) {
      const pl = this.pollen[k];
      pl.life += dt; pl.ph += dt * 0.8;
      pl.z += 5 * dt; pl.x += Math.sin(pl.ph) * 8 * dt + 3 * dt;
      if (pl.life > 14) this.pollen.splice(k, 1);
    }

    // --- 冬天的雪：用和地面同一份「冬意」，天上飘的和地上积的永远一致 ---
    const winter = (ctx.winterness !== undefined) ? ctx.winterness
                                                  : this._seasonWeight(ctx.season, ctx.seasonProgress, 3);
    const wantSnow = winter > 0.30 ? Math.round(100 * winter) : 0;
    while (this.snowflakes.length < wantSnow) {
      this.snowflakes.push({
        x: Math.random() * world.cols * this.W.cell,
        y: Math.random() * world.rows * this.W.cell,
        z: 20 + Math.random() * 90, ph: Math.random() * 6.28, sp: 0.5 + Math.random(),
      });
    }
    while (this.snowflakes.length > wantSnow) this.snowflakes.pop();
    for (const sf of this.snowflakes) {
      sf.ph += dt * 1.4;
      sf.z -= 14 * sf.sp * dt;
      sf.x += Math.sin(sf.ph) * 10 * dt + 8 * dt;
      sf.y += 4 * dt;
      if (sf.z <= 0) { sf.z = 80 + Math.random() * 40; sf.x = Math.random() * world.cols * this.W.cell; sf.y = Math.random() * world.rows * this.W.cell; }
    }
  },

  drawParticles(g, env) {
    const p = this._pcA;                 // 复用同一个投影结果（粒子一帧也有成百上千个）
    // 落叶
    for (const lf of this.leaves) {
      this.projectInto(lf.x, lf.y, lf.z, p);
      const s = p.s;
      g.save(); g.translate(p.x, p.y); g.rotate(lf.rot);
      g.fillStyle = env.col(lf.h, 52, 44, 0.85);
      g.beginPath(); g.ellipse(0, 0, 2.6 * s, 1.3 * s, 0, 0, 6.2832); g.fill();
      g.restore();
    }
    // 花粉
    for (const pl of this.pollen) {
      this.projectInto(pl.x, pl.y, pl.z, p);
      const a = 0.35 * (0.5 + 0.5 * Math.sin(pl.ph * 2));
      g.fillStyle = this._alphaCol(this._poCache, '250,244,206', a);
      g.beginPath(); g.arc(p.x, p.y, 1.4 * p.s, 0, 6.2832); g.fill();
    }
    // 雪
    if (this._snowStr === undefined) this._snowStr = 'rgba(255,255,255,0.7)';
    for (const sf of this.snowflakes) {
      this.projectInto(sf.x, sf.y, sf.z, p);
      g.fillStyle = this._snowStr;
      g.beginPath(); g.arc(p.x, p.y, 1.5 * p.s * sf.sp, 0, 6.2832); g.fill();
    }
  },

  /* =======================================================================
   *  雾：清晨出现；森林形成后，蒸腾也会带来雾
   * ===================================================================== */
  /** 雾有多浓：清晨最浓；森林长起来之后，蒸腾也会带来雾 */
  fogAmount(world, ctx) {
    const F = CFG.RENDER.fog;
    const df = ctx.dayFrac;
    const dawn = U.clamp(1 - Math.abs(df - 0.25) / 0.16, 0, 1);          // 天亮前后
    const nightFog = U.clamp(1 - Math.abs(df - 0.95) / 0.25, 0, 1) * 0.5; // 深夜到凌晨
    const win = U.clamp(dawn + nightFog, 0, 1);
    return (F.dawnAmount * win + F.forestBoost * world.forestness * win) * (1 - ctx.rain * 0.5);
  },

  drawFog(g, world, ctx, env) {
    const amt = ctx.fog;
    if (amt < 0.01) return;
    const F = CFG.RENDER.fog;
    const t = this.time * 0.012;
    g.save();
    // 几团缓慢移动的雾
    for (let k = 0; k < 4; k++) {
      const px = ((Math.sin(t * (0.6 + k * 0.21) + k * 2.1) * 0.5 + 0.5) * 1.4 - 0.2) * Cam.vw;
      const py = ((Math.cos(t * (0.5 + k * 0.17) + k * 1.3) * 0.5 + 0.5) * 1.3 - 0.15) * Cam.vh;
      const r = Math.max(Cam.vw, Cam.vh) * (0.42 + k * 0.1);
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      const a = amt * (0.20 - k * 0.028);
      grd.addColorStop(0, `rgba(${F.color[0]},${F.color[1]},${F.color[2]},${a})`);
      grd.addColorStop(1, `rgba(${F.color[0]},${F.color[1]},${F.color[2]},0)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, Cam.vw, Cam.vh);
    }
    g.restore();
  },

  /* =======================================================================
   *  光标：这一格能不能活。不显示数字，用颜色说。
   *    偏绿 = 能活（深浅表示活得好不好）
   *    灰黄 = 活不了
   * ===================================================================== */
  drawCursor(g, world, ui) {
    const { gx, gy } = ui.hoverCell;
    if (!world.inBounds(gx, gy)) return;
    const i = world.idx(gx, gy);
    const c = this.W.cell;
    const p = this.project((gx + 0.5) * c, (gy + 0.5) * c, 0);
    const s = p.s;

    const sp = ui.selected;
    const ok = sp ? world.canSow(gx, gy, sp.id) : world.canPlaceAt(gx, gy);
    const si = sp ? SP_INDEX[sp.id] : -1;
    const suit = si >= 0 ? world.suitAt(si, i, 0) : 0;

    // 圈：能活是绿的，不能活是灰的，圈越实代表活得越好
    g.save();
    g.lineWidth = Math.max(1, 1.6 * s);
    if (ok && si >= 0) {
      const hue = U.lerp(40, 118, suit);
      g.strokeStyle = `hsla(${hue},${30 + suit * 40}%,${45 + suit * 12}%,${0.35 + suit * 0.4})`;
      g.fillStyle = `hsla(${hue},${30 + suit * 40}%,${50}%,${0.06 + suit * 0.12})`;
    } else {
      g.strokeStyle = 'rgba(240,236,226,0.28)';
      g.fillStyle = 'rgba(240,236,226,0.03)';
    }
    const R = c * 0.62 * s;
    g.beginPath();
    g.ellipse(p.x, p.y, R, R * CFG.RENDER.ySquash, 0, 0, 6.2832);
    g.fill(); g.stroke();

    // 半透明的剪影：让他看见自己正要放下什么
    if (ok && si >= 0) {
      g.globalAlpha = 0.34;
      const fake = { gx, gy, sp, mat: 0.55, seed: 12345, suit, si };
      this.drawPlant(g, fake, this.env, { season: 0, seasonProgress: 0.5, fog: 0 }, 2);
      g.globalAlpha = 1;
    }
    g.restore();
  },
};
