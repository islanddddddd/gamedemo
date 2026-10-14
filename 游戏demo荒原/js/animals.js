/* =============================================================================
 *  animals.js —— 动物
 *  ---------------------------------------------------------------------------
 *  玩家不能召唤动物，也不能喂养它们。它们只是「条件够了就自己来」：
 *
 *      花开了 → 虫子来了
 *      树长了 → 鸟来了（鸟会带来远方的种子，这是惊喜的主要来源）
 *      林子深了 → 鹿从边缘走过
 *
 *  它们来，转一圈，走。偶尔留下点什么。
 * ========================================================================== */

const Animals = {

  list: [],          // 在场的动物
  fireflies: [],     // 萤火虫（夏夜限定）
  _tickAcc: 0,

  onSound: null,     // 回调：(kindId) => 播放对应叫声

  reset() { this.list.length = 0; this.fireflies.length = 0; this._tickAcc = 0; },

  /* =========================================================================
   *  尝试生成（每 checkEveryTicks 调用一次）
   * ====================================================================== */
  trySpawn(world, ctx) {
    for (const kind of CFG.FAUNA.kinds) {
      // 条件：该有的东西够多了吗？
      let ok = true;
      for (const spId in kind.min) {
        if (world.matureCount(spId) < kind.min[spId]) { ok = false; break; }
      }
      if (!ok) continue;
      // 场上同类已经太多了就别再来了
      const alive = this.list.filter(a => a.kind.id === kind.id).length;
      if (alive >= kind.group[1] * 2) continue;

      if (Math.random() < kind.chance) {
        const cnt = kind.group[0] + ((Math.random() * (kind.group[1] - kind.group[0] + 1)) | 0);
        const leader = this._spawnOne(world, kind);
        if (leader) {
          for (let c = 1; c < cnt; c++) {
            const f = this._spawnOne(world, kind);
            if (f) { f.x += (Math.random() - 0.5) * 60; f.y += (Math.random() - 0.5) * 60; }
          }
          if (this.onSound && kind.sound) this.onSound(kind.sound);
        }
      }
    }

    // 萤火虫：夏天的夜里，树够多的时候
    const FF = CFG.FAUNA.firefly;
    if (ctx.season === FF.season && ctx.isNight && world.matureCount('tree') >= FF.minTrees) {
      if (this.fireflies.length < FF.count) {
        for (let c = this.fireflies.length; c < FF.count; c++) {
          const p = world.randomPlantOf('tree', 'shrub');
          const cx = p ? p.wx : Math.random() * world.cols * CFG.WORLD.cell;
          const cy = p ? p.wy : Math.random() * world.rows * CFG.WORLD.cell;
          this.fireflies.push({
            x: cx + (Math.random() - 0.5) * 180,
            y: cy + (Math.random() - 0.5) * 180,
            ph: Math.random() * 6.28, sp: 0.3 + Math.random() * 0.5,
            r: 8 + Math.random() * 22,
          });
        }
      }
    } else if (this.fireflies.length && !(ctx.isNight && ctx.season === FF.season)) {
      this.fireflies.length = 0;
    }
  },

  _spawnOne(world, kind) {
    const W = CFG.WORLD;
    const ww = world.cols * W.cell, wh = world.rows * W.cell;

    // 找一个目的地：鸟找树，虫找花，走兽找林子深处
    let target = null;
    if (kind.id === 'bird') target = world.randomPlantOf('tree', 'birch');
    else if (kind.id === 'moth') target = world.randomPlantOf('flower', 'shrub');
    else target = world.randomPlantOf('tree', 'shrub');
    const tx = target ? target.wx : ww * 0.5;
    const ty = target ? target.wy : wh * 0.5;

    // 出发点：地图外面（飞行的随机一边，走兽从最近的边缘进来）
    let sx, sy;
    const side = (Math.random() * 4) | 0;
    if (side === 0) { sx = -80; sy = Math.random() * wh; }
    else if (side === 1) { sx = ww + 80; sy = Math.random() * wh; }
    else if (side === 2) { sx = Math.random() * ww; sy = -80; }
    else { sx = Math.random() * ww; sy = wh + 80; }

    const a = {
      kind, x: sx, y: sy, z: kind.fly ? 40 + Math.random() * 60 : 0,
      tx, ty, tz: kind.fly ? 30 + Math.random() * 40 : 0,
      vx: 0, vy: 0,
      state: 'in',                                   // in → stay → out
      life: kind.life[0] + Math.random() * (kind.life[1] - kind.life[0]),
      age: 0,
      seed: (Math.random() * 1e6) | 0,
      flap: Math.random() * 6.28,
      dropT: kind.dropSeeds ? kind.dropSeeds.every * (0.4 + Math.random()) : 0,
      // 走兽会在几个点之间慢慢溜达
      wander: 0,
    };
    this.list.push(a);
    return a;
  },

  /* =========================================================================
   *  每帧移动（dt 单位是秒）
   * ====================================================================== */
  update(dt, world) {
    const W = CFG.WORLD;
    const ww = world.cols * W.cell, wh = world.rows * W.cell;

    for (let k = this.list.length - 1; k >= 0; k--) {
      const a = this.list[k];
      const kind = a.kind;
      a.age += dt;
      a.flap += dt * (kind.fly ? 9 : 4);

      let gx, gy, gz;
      if (a.state === 'in') {
        gx = a.tx; gy = a.ty; gz = a.tz;
        const d = Math.hypot(a.tx - a.x, a.ty - a.y);
        if (d < 40) { a.state = 'stay'; a.stay = 3 + Math.random() * 8; }
      } else if (a.state === 'stay') {
        // 在附近慢慢晃
        a.wander += dt;
        gx = a.tx + Math.cos(a.wander * 0.6 + a.seed) * 46;
        gy = a.ty + Math.sin(a.wander * 0.45 + a.seed * 1.7) * 46;
        gz = a.tz;
        a.stay -= dt;
        if (a.stay <= 0 || a.age > a.life * 0.72) a.state = 'out';
      } else {
        // 离开：走出地图外
        gx = a.x < ww * 0.5 ? -140 : ww + 140;
        gy = a.y < wh * 0.5 ? -140 : wh + 140;
        gz = kind.fly ? 120 : 0;
      }

      // 朝目标加速（有点惯性，路径不会是直线，看起来才像活的）
      const dx = gx - a.x, dy = gy - a.y, dz = gz - a.z;
      const dist = Math.hypot(dx, dy) || 1;
      const sp = kind.speed * 60;      // 像素/秒
      a.vx += (dx / dist * sp - a.vx) * Math.min(1, dt * 1.6);
      a.vy += (dy / dist * sp - a.vy) * Math.min(1, dt * 1.6);
      a.x += a.vx * dt; a.y += a.vy * dt;
      a.z += (dz - a.z) * Math.min(1, dt * 0.8);

      // 掉种子：鸟飞过的时候，偶尔会留下点什么
      if (kind.dropSeeds) {
        a.dropT -= dt * 60;   // 按 tick 计
        if (a.dropT <= 0) {
          a.dropT = kind.dropSeeds.every;
          if (Math.random() < kind.dropSeeds.chance && a.state !== 'out') {
            const gxi = (a.x / W.cell) | 0, gyi = (a.y / W.cell) | 0;
            Life.dropSeed(world, gxi, gyi, kind.dropSeeds.species);
          }
        }
      }

      // 偶尔叫一声
      if (kind.sound && Math.random() < dt * 0.06 && this.onSound) this.onSound(kind.sound);

      const out = a.x < -160 || a.y < -160 || a.x > ww + 160 || a.y > wh + 160;
      if (out || a.age > a.life) this.list.splice(k, 1);
    }

    // 萤火虫：原地慢慢漂
    for (const f of this.fireflies) {
      f.ph += dt * f.sp;
      f.x += Math.cos(f.ph * 0.7) * dt * 12;
      f.y += Math.sin(f.ph * 0.9) * dt * 10;
    }
  },

  /* =========================================================================
   *  绘制
   * ====================================================================== */
  draw(g, proj, env) {
    const YS = CFG.RENDER.ySquash, ZL = CFG.RENDER.zLift;

    // ---- 萤火虫（在树影之间） ----
    if (this.fireflies.length) {
      for (const f of this.fireflies) {
        const p = proj(f.x, f.y, 14 + Math.sin(f.ph) * 8);
        const blink = 0.5 + 0.5 * Math.sin(f.ph * 2.2 + f.r);
        if (blink < 0.25) continue;
        const r = 2.2 * p.s;
        const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        grd.addColorStop(0, `rgba(226,240,150,${0.85 * blink})`);
        grd.addColorStop(1, 'rgba(226,240,150,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(p.x, p.y, r * 5, 0, 6.2832); g.fill();
      }
    }

    for (const a of this.list) {
      const kind = a.kind;
      const p = proj(a.x, a.y, a.z);
      const sz = p.s;
      if (p.x < -100 || p.y < -100 || p.x > p.W + 100 || p.y > p.H + 100) continue;

      // 影子（飞行的投在地面上，走兽的贴着脚）
      if (kind.fly) {
        const gp = proj(a.x, a.y, 0);
        g.fillStyle = `rgba(30,26,20,${0.10 * env.shadowAlpha})`;
        g.beginPath();
        g.ellipse(gp.x, gp.y, 5 * sz, 2.4 * sz, 0, 0, 6.2832);
        g.fill();
      }

      const dir = a.vx >= 0 ? 1 : -1;
      g.save();
      g.translate(p.x, p.y);
      g.scale(sz * dir, sz);

      if (kind.id === 'bird') {
        // 鸟：一个 V 形的双翼，翅膀会扇
        const f = Math.sin(a.flap) * 0.55;
        g.strokeStyle = env.ink(0.72);
        g.lineWidth = 1.6; g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-7, f * 5);
        g.quadraticCurveTo(-3, -1.5, 0, 0);
        g.quadraticCurveTo(3, -1.5, 7, f * 5);
        g.stroke();
      } else if (kind.id === 'moth') {
        const f = Math.sin(a.flap) * 1.4;
        g.fillStyle = env.ink(0.5);
        g.beginPath(); g.ellipse(-1.8, 0, 2.2, 1.2 + f * 0.5, -0.5, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(1.8, 0, 2.2, 1.2 + f * 0.5, 0.5, 0, 6.2832); g.fill();
      } else if (kind.id === 'deer' || kind.id === 'fox') {
        const isFox = kind.id === 'fox';
        const bw = isFox ? 13 : 20;   // 体长
        const bh = isFox ? 5 : 8;
        const col = isFox ? env.col(24, 42, 44) : env.col(28, 16, 38);
        // 腿
        g.strokeStyle = env.ink(0.55); g.lineWidth = 1.4; g.lineCap = 'round';
        const gait = Math.sin(a.age * (isFox ? 7 : 4.5));
        for (let li = 0; li < 4; li++) {
          const lx = -bw * 0.34 + (li % 2) * bw * 0.68 + (li < 2 ? 0 : 1.5);
          g.beginPath();
          g.moveTo(lx, -bh * 0.2);
          g.lineTo(lx + gait * (li % 2 ? 2 : -2), bh * 1.05);
          g.stroke();
        }
        // 身体
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(0, -bh * 0.55, bw * 0.5, bh * 0.52, 0, 0, 6.2832);
        g.fill();
        // 脖子与头
        g.beginPath();
        g.moveTo(bw * 0.34, -bh * 0.7);
        g.quadraticCurveTo(bw * 0.62, -bh * 1.5, bw * 0.72, -bh * 1.75);
        g.lineTo(bw * 0.86, -bh * 1.72);
        g.quadraticCurveTo(bw * 0.76, -bh * 1.1, bw * 0.5, -bh * 0.42);
        g.closePath(); g.fill();
        // 鹿角
        if (!isFox) {
          g.strokeStyle = env.ink(0.6); g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(bw * 0.74, -bh * 1.8); g.lineTo(bw * 0.78, -bh * 2.7);
          g.moveTo(bw * 0.74, -bh * 2.2); g.lineTo(bw * 0.58, -bh * 2.5);
          g.moveTo(bw * 0.78, -bh * 2.7); g.lineTo(bw * 0.92, -bh * 3.0);
          g.stroke();
        }
        // 尾巴
        g.fillStyle = col;
        g.beginPath(); g.ellipse(-bw * 0.5, -bh * 0.75, 2.4, 2.0, 0, 0, 6.2832); g.fill();
      }
      g.restore();
    }
  },
};
