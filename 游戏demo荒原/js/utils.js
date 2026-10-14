/* =============================================================================
 *  utils.js —— 数学 / 随机 / 噪声 / 颜色
 *  纯工具，没有任何游戏逻辑。
 * ========================================================================== */

const U = {

  /* ---------- 基础数学 ---------- */
  clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
  lerp(a, b, t) { return a + (b - a) * t; },
  smoothstep(e0, e1, x) {
    const t = U.clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  },
  // 把 x 从 [a,b] 映射到 [0,1] 并截断
  norm(x, a, b) { return U.clamp((x - a) / (b - a || 1e-6), 0, 1); },

  /**
   * 梯形隶属函数：生态判定里所有「需求曲线」都用它。
   *   [c0, c1, c2, c3]：
   *     x <= c0 → 0        （活不了）
   *     c0→c1   → 0 升到 1
   *     c1~c2   → 1        （最舒服）
   *     c2→c3   → 1 降到 0
   *     x >= c3 → 0        （又活不了，比如淹死）
   */
  trapezoid(x, c0, c1, c2, c3) {
    // 前后两端允许「退化」：c0 == c1 表示没有下限（再低也无所谓）
    //                      c2 == c3 表示没有上限（再高也无所谓）
    if (x <= c0) return 0;
    if (x >= c3) return 0;
    if (x < c1) return (c1 > c0) ? (x - c0) / (c1 - c0) : 1;
    if (x <= c2) return 1;
    return (c3 > c2) ? (c3 - x) / (c3 - c2) : 1;
  },

  /* ---------- 可复现随机（同一个种子 = 同一片地） ---------- */
  mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /* ---------- 值噪声 + fbm ---------- */
  makeNoise2D(seed) {
    const rnd = U.mulberry32(seed);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (h, x, y) => {
      switch (h & 3) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        default: return -x - y;
      }
    };

    // 返回 -1 ~ 1 的柏林风格噪声
    return function (x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
      const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
      const x1 = U.lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
      const x2 = U.lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return U.lerp(x1, x2, v);
    };
  },

  /** 分形叠加噪声，返回 -1~1 */
  fbm(noise, x, y, octaves, lacunarity = 2.0, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  },

  /* ---------- 颜色 ---------- */
  hsl(h, s, l, a = 1) {
    return `hsla(${h},${s}%,${l}%,${a})`;
  },
  rgb(c, a = 1) {
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  },
  mixRGB(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  },
  /** 把 0~1 的 hsl 亮度按光照环境做偏移，返回 css 字符串 */
  shadeHSL(h, s, l, lightMul, tint, tintAmt) {
    let L = U.clamp(l * lightMul, 0, 96);
    // 叠一点点环境色（黄昏会把所有东西染橙）
    let r, g, b;
    [r, g, b] = U.hslToRGB(h, s, L);
    r = U.lerp(r, tint[0], tintAmt);
    g = U.lerp(g, tint[1], tintAmt);
    b = U.lerp(b, tint[2], tintAmt);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  },
  hslToRGB(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  },

  /* ---------- 杂项 ---------- */
  // 由整数种子生成一个稳定的 0~1 抖动值（用于手绘感的不规则形状）
  hash01(n) {
    let t = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return t - Math.floor(t);
  },
  pick(arr, rnd = Math.random) { return arr[(rnd() * arr.length) | 0]; },
};
