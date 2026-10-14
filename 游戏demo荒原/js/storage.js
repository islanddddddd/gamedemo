/* =============================================================================
 *  storage.js —— 存档
 *  ---------------------------------------------------------------------------
 *  关掉再打开，它还在，而且长过了。
 *
 *  存的是二进制打包后再 base64，比 JSON 小很多：
 *    土壤水分、养分各一格一字节（够用，精度 1/255 肉眼完全看不出来）
 *    一株植物 4 个字节：在哪一格、是什么、长多大了
 * ========================================================================== */

const Storage = {

  MAGIC: 0x5A57,     // 'ZW'（荒原的拼音首字母，随便定的）
  VERSION: 3,

  /* =======================================================================
   *  存
   * ===================================================================== */
  save(world, ctx, unlocked, extra) {
    try {
      const n = world.n;
      const plants = world.plants;
      const size = 2 + 1 + 4 + 4 + 2 + 1 + 1 + 2 + 4 + plants.length * 5 + n * 2 + 12;
      const buf = new ArrayBuffer(size);
      const v = new DataView(buf);
      let o = 0;

      v.setUint16(o, this.MAGIC); o += 2;
      v.setUint8(o, this.VERSION); o += 1;
      v.setUint32(o, world.seed >>> 0); o += 4;
      v.setUint32(o, world.tickCount >>> 0); o += 4;
      v.setUint16(o, Math.round(ctx.dayFrac * 65535)); o += 2;
      v.setUint8(o, ctx.season); o += 1;
      // 「这一季的第几天」是带小数的（一季 3 天，存档时可能在第 1.47 天）。
      // 直接塞进 1 个字节会被截成整数，读回来季节色就会跳一下，
      // 所以按「一季的百分比」存，读的时候再乘回去。
      v.setUint8(o, Math.round(U.clamp(ctx.dayInSeason / CFG.TIME.daysPerSeason, 0, 1) * 255)); o += 1;

      // 已解锁的物种 → 位掩码
      let mask = 0;
      CFG.SPECIES.forEach((sp, i) => { if (unlocked.has(sp.id)) mask |= (1 << i); });
      v.setUint16(o, mask); o += 2;

      // 植物
      v.setUint32(o, plants.length); o += 4;
      for (let k = 0; k < plants.length; k++) {
        const p = plants[k];
        v.setUint16(o, p.i); o += 2;
        v.setUint8(o, p.si); o += 1;
        v.setUint8(o, Math.round(U.clamp(p.mat, 0, 1) * 255)); o += 1;
        v.setUint8(o, p.under ? 1 : 0); o += 1;   // 住在林下层的
      }

      // 土壤
      for (let i = 0; i < n; i++) v.setUint8(o + i, Math.round(U.clamp(world.mois[i], 0, 1) * 255));
      o += n;
      for (let i = 0; i < n; i++) v.setUint8(o + i, Math.round(U.clamp(world.nut[i], 0, 1) * 255));
      o += n;

      // 相机
      v.setFloat32(o, Cam.x); o += 4;
      v.setFloat32(o, Cam.y); o += 4;
      v.setFloat32(o, Cam.zoom); o += 4;

      const payload = {
        d: this._b64(buf),
        t: Date.now(),
        x: extra || {},
      };
      localStorage.setItem(CFG.SAVE.key, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('[荒原] 存档失败：', e);
      return false;
    }
  },

  /* =======================================================================
   *  读
   * ===================================================================== */
  load() {
    try {
      const raw = localStorage.getItem(CFG.SAVE.key);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      const buf = this._unb64(payload.d);
      const v = new DataView(buf);
      let o = 0;

      if (v.getUint16(o) !== this.MAGIC) return null; o += 2;
      if (v.getUint8(o) !== this.VERSION) return null; o += 1;

      const seed = v.getUint32(o); o += 4;
      const tickCount = v.getUint32(o); o += 4;
      const dayFrac = v.getUint16(o) / 65535; o += 2;
      const season = v.getUint8(o); o += 1;
      const dayInSeason = v.getUint8(o) / 255 * CFG.TIME.daysPerSeason; o += 1;
      const mask = v.getUint16(o); o += 2;

      const world = new World(seed);
      world.tickCount = tickCount;

      const pc = v.getUint32(o); o += 4;
      for (let k = 0; k < pc; k++) {
        const i = v.getUint16(o); o += 2;
        const si = v.getUint8(o); o += 1;
        const mat = v.getUint8(o) / 255; o += 1;
        const under = v.getUint8(o) === 1; o += 1;
        if (si >= CFG.SPECIES.length) continue;
        world._put(i, si, mat, under);
      }

      const n = world.n;
      for (let i = 0; i < n; i++) world.mois[i] = v.getUint8(o + i) / 255;
      o += n;
      for (let i = 0; i < n; i++) world.nut[i] = v.getUint8(o + i) / 255;
      o += n;

      const camX = v.getFloat32(o), camY = v.getFloat32(o + 4), camZoom = v.getFloat32(o + 8);

      const unlocked = new Set();
      CFG.SPECIES.forEach((sp, i) => { if (mask & (1 << i)) unlocked.add(sp.id); });

      return {
        world,
        ctx: { dayFrac, season, dayInSeason },
        unlocked,
        cam: { x: camX, y: camY, zoom: camZoom },
        savedAt: payload.t || Date.now(),
      };
    } catch (e) {
      console.warn('[荒原] 读档失败，将重新开始：', e);
      return null;
    }
  },

  clear() {
    try { localStorage.removeItem(CFG.SAVE.key); } catch (e) { /* 忽略 */ }
  },

  /* ---------- base64 ---------- */
  _b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  },
  _unb64(str) {
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  },
};
