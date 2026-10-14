/* =========================================================================
 * noise.js —— 值噪声（value noise）+ fbm
 * 用来做：砂面的大块起伏、纹路的手作感抖动、石头的不规则轮廓
 * ========================================================================= */
(function () {
  'use strict';

  // 二维整数哈希 → [0,1)
  function h2(x, y, s) {
    let n = (x | 0) * 374761393 + (y | 0) * 668265263 + (s | 0) * 1013904223;
    n = (n ^ (n >> 13)) * 1274126177;
    n = n ^ (n >> 16);
    return (n >>> 0) / 4294967296;
  }

  // 单倍频值噪声，双线性 + smoothstep 插值
  function vn(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi, s), b = h2(xi + 1, yi, s);
    const c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // 分形叠加，返回 [0,1]
  function fbm(x, y, s, oct) {
    oct = oct || 3;
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * vn(x * f, y * f, (s | 0) + i * 17);
      norm += amp;
      amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }

  // 一个可复现的伪随机数发生器（给石头形状用，保证同一块石头每次长得一样）
  function rng(seed) {
    let s = (seed | 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  KS.Noise = { h2: h2, vn: vn, fbm: fbm, rng: rng };
})();
