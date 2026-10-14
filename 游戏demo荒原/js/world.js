/* =============================================================================
 *  world.js —— 世界：地形、土壤、以及把它们串起来的生态模拟
 *  ---------------------------------------------------------------------------
 *  一份格子 = 一份土壤。植物挂在格子上，反作用于土壤，土壤再决定谁能活。
 *  这个文件就是那条「因果链」本身。
 *
 *  每 tick 的执行顺序（顺序很重要，它定义了因果的方向）：
 *     1. 清空累加器
 *     2. 逐株植物：算适宜度 → 长或退 → 把「保水/固氮/遮阴/耗水/绿意」累加进本格
 *     3. 全域扩散：把本格的累加量按权重分给邻格（一片草比一株草有力得多）
 *     4. 土壤更新：水分向目标值靠近、养分累积、遮阴跟随、地下水出露
 *     5. 繁殖：成熟植物向外播种
 *     6. 野生：随机某处自己冒出一株（惊喜）
 * ========================================================================== */

class World {

  constructor(seed) {
    const W = CFG.WORLD;
    this.cols = W.cols;
    this.rows = W.rows;
    this.n = W.cols * W.rows;
    this.seed = seed;

    /* ---- 固定地形 ---- */
    this.height = new Float32Array(this.n);   // 0 低洼 ~ 1 高地
    this.rock = new Float32Array(this.n);     // 0 松土 ~ 1 碎石地
    this.hill = new Float32Array(this.n);     // 山体阴影（预计算，纯画面用）

    /* ---- 土壤状态（会变，也是存档要存的东西） ---- */
    this.mois = new Float32Array(this.n);     // 水分 0~1
    this.nut = new Float32Array(this.n);      // 养分 0~1
    this.shade = new Float32Array(this.n);    // 遮阴 0~1
    this.wet = new Float32Array(this.n);      // 积水程度 0~1（由地下水位决定）

    /* ---- 累加器（每 tick 重算） ---- */
    this.accRetain = new Float32Array(this.n);
    this.accFix = new Float32Array(this.n);
    this.accShade = new Float32Array(this.n);
    this.accDrink = new Float32Array(this.n);
    this.accCarpet = new Float32Array(this.n);
    this.accTier = new Float32Array(this.n);    // 这里长到过的最高层级（决定肥力上限）
    this.fTier = new Float32Array(this.n);

    this.fRetain = new Float32Array(this.n);
    this.fFix = new Float32Array(this.n);
    this.fShade = new Float32Array(this.n);
    this.fDrink = new Float32Array(this.n);
    this.carpet = new Float32Array(this.n);

    /* ---- 植物 ----
       一格可以住两层：
         cellP  上层/主层（灌木、树、草…… 谁先来谁住这儿）
         cellU  林下（只有 under:true 的低矮植物能住：苔藓、蕨、蘑菇、花）
       所以「树脚下自己长出蕨」这件事才可能发生。 */
    this.cellP = new Int32Array(this.n).fill(-1);  // 格子 → plants 下标（主层）
    this.cellU = new Int32Array(this.n).fill(-1);  // 格子 → plants 下标（林下）
    this.plants = [];                               // 只增不减（这里没有死亡，只有休眠）

    /* ---- 全局量 ---- */
    this.tickCount = 0;
    this.biomass = 0;
    this.forestness = 0;
    this.waterTable = CFG.SOIL.water.baseLevel;
    this.snowAmt = 0;
    this.tempNow = 0.6;
    this.maxMois = 0;
    this.maxNut = 0;
    this.hasWater = false;
    this._waterFounded = false;   // 水边的第一批芦苇有没有扎下根

    // 各物种的计数（解锁、动物、音频都要用）
    this.spCount = new Int32Array(CFG.SPECIES.length);
    this.spMature = new Int32Array(CFG.SPECIES.length);
    this.seenSpecies = new Set();  // 世界里出现过的物种（自然发生的「种源」判定用）

    this._buried = 0;       // 被盖住的植物数量（攒多了就整理一次，免得越来越臃肿）

    // 降雨事件
    this.rainMul = 1.0;
    this.rainTimer = 0;

    this.generate();
  }

  /* =========================================================================
   *  地形生成
   * ====================================================================== */
  generate() {
    const W = CFG.WORLD, T = W.terrain;
    const noise = U.makeNoise2D(this.seed);
    const noise2 = U.makeNoise2D(this.seed + 7717);

    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const i = gy * this.cols + gx;
        const x = gx * T.scale, y = gy * T.scale;

        // 基础起伏（fbm）
        let h = U.fbm(noise, x, y, T.octaves) * 0.5 + 0.5;   // 0~1

        // 混入脊状噪声，让低洼处形成连贯的谷地（以后水会顺着它出现）
        const r = 1 - Math.abs(U.fbm(noise2, x * 1.6 + 40, y * 1.6 - 20, 3));
        h = U.lerp(h, r, T.ridge);

        // 边缘稍微抬起一点，做成一块「被围起来的地」，视觉上更完整
        const ex = Math.min(gx, this.cols - 1 - gx) / (this.cols * 0.16);
        const ey = Math.min(gy, this.rows - 1 - gy) / (this.rows * 0.16);
        h += (1 - U.smoothstep(0, 1, Math.min(ex, ey))) * 0.16;

        this.height[i] = U.clamp((h + T.bias - 0.5) * T.amplitude * T.contrast + 0.5, 0, 1);

        // 岩石/砂砾斑块
        const rn = U.fbm(noise2, gx * W.rockNoise.scale, gy * W.rockNoise.scale, 3) * 0.5 + 0.5;
        this.rock[i] = U.smoothstep(W.rockNoise.threshold - W.rockNoise.softness,
                                    W.rockNoise.threshold + W.rockNoise.softness, rn);
      }
    }

    // 山体阴影：拿高度差做个简单的方向光，让画面有立体感（西北方向来光）
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const i = gy * this.cols + gx;
        const c = this.height[i];
        const l = this.height[gy * this.cols + Math.max(0, gx - 1)];
        const u = this.height[Math.max(0, gy - 1) * this.cols + gx];
        const d = (c - l) + (c - u);
        this.hill[i] = U.clamp(1 + d * 3.2, 0.78, 1.22);
      }
    }

    // 初始土壤：一片死掉的、缺水的、没养分的地
    const S = CFG.SOIL;
    for (let i = 0; i < this.n; i++) {
      // 初始值直接用稳态公式算，免得开局几百步里水分先跳一下
      const lowland = 1 - this.height[i];                 // 越低洼越湿
      this.mois[i] = U.clamp(S.moisture.bare + lowland * S.moisture.heightGain
                           + S.moisture.rainGain * CFG.TIME.seasonRain[CFG.TIME.startSeason], 0, 1);
      this.nut[i] = U.clamp(S.nutrient.base + lowland * S.nutrient.maxFromHeight, 0, 1);
      this.shade[i] = 0;
      this.wet[i] = 0;
    }
    this.maxMois = 0.3; this.maxNut = 0.05;
  }

  /* =========================================================================
   *  坐标工具
   * ====================================================================== */
  idx(gx, gy) { return gy * this.cols + gx; }
  inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows; }

  /** 主层是不是空的（不判断物种） */
  canPlaceAt(gx, gy) {
    if (!this.inBounds(gx, gy)) return false;
    const i = this.idx(gx, gy);
    if (this.cellP[i] >= 0) return false;   // 已经有东西了
    if (this.wet[i] > 0.55) return false;   // 水太深
    return true;
  }

  /**
   * 某个物种能不能进这一格。
   *
   * 两条规则，撑起了整个演替：
   *   1. 更高级的可以盖住低级的（灌木盖住草，树盖住灌木）——
   *      不然草一旦铺满，灌木和树就永远进不来了。前提是它在这儿得真活得下去。
   *   2. 低矮的林下植物（苔藓、蕨、蘑菇、花）可以长在别人的脚底下 ——
   *      树一长起来，树荫里就自己冒出蕨和苔藓。这是惊喜的主要来源。
   */
  canSow(gx, gy, spId) {
    if (!this.inBounds(gx, gy)) return false;
    const i = this.idx(gx, gy);
    if (this.wet[i] > 0.9) return false;             // 深水不长东西
    const sp = SP_BY_ID[spId];
    const main = this.cellP[i];

    if (main < 0) return true;
    const mp = this.plants[main];

    if (sp.under) {
      // 林下植物：上层已经有人了，那就看脚底下
      if (!mp.sp.under) {
        const ui = this.cellU[i];
        if (ui < 0) return true;                    // 脚底下空着，可以种
        const up = this.plants[ui];
        const mine = this.suitAt(SP_INDEX[spId], i, 0);
        // 判定和 _sow 保持一致，否则光标显示「能种」但种下去没反应
        if (sp.tier < up.sp.tier) return false;                 // 更低级的顶不掉更高的
        return (sp.tier > up.sp.tier) ? mine > up.suit + 0.08
                                      : mine > Math.max(up.suit * 0.75, 0.30);
      }
      // 上层也是低矮的（林下 vs 林下）：更高级的能顶掉；同级要明显更适应
      if (sp.tier < mp.sp.tier) return false;
      if (sp.tier === mp.sp.tier &&
          this.suitAt(SP_INDEX[spId], i, 0) < mp.suit + 0.15) return false;
      return this.suitAt(SP_INDEX[spId], i, 0) >= 0.20;
    }
    // 上层植物：想盖住已有的，得比它高级，或者同级但明显更适应
    return this._canDisplace(SP_INDEX[spId], i, mp);
  }

  /** 放下一株。返回是否成功 */
  plant(gx, gy, spId, mat = 0.02) {
    if (!this.canSow(gx, gy, spId)) return false;
    const i = this.idx(gx, gy);
    return this._put(i, SP_INDEX[spId], mat);
  }

  /** 内部用：真正把一株种进格子（扩散、野生、动物播种都走这里） */
  _sow(i, si, mat = 0.02) {
    if (this.wet[i] > 0.9) return false;   // 深水不长东西
    const sp = CFG.SPECIES[si];
    const main = this.cellP[i];

    if (main >= 0) {
      const mp = this.plants[main];
      if (sp.under) {
        // 长到别人脚底下：上层不动，只占用林下这一层
        if (!mp.sp.under) {
          const ui = this.cellU[i];
          if (ui < 0) return this._put(i, si, mat, true);
          /* 脚底下已经有一层了。
             这里是「林下演替」：树一长起来，原来那层草晒不到太阳就开始退出，
             更耐阴的蕨、苔藓、蘑菇会顶上来 —— 玩家没种过，是它们自己来的。
             判定分两档：
               · 更高级的（蕨 vs 草）：明显更适应就能顶掉
               · 同级的（蕨 vs 蘑菇、苔藓）：只要「不相上下」就有机会顶掉。
                 这一档很重要 —— 不然树荫下的蕨会一直霸着，
                 蘑菇、苔藓这些惊喜物种永远挤不进来。 */
          const up = this.plants[ui];
          if (up.buried) return false;
          const mine = this.suitAt(si, i, 0);
          let win;
          if (sp.tier > up.sp.tier) win = mine > up.suit + 0.08;        // 更高级：明显更适应就能顶
          else if (sp.tier === up.sp.tier) win = mine > Math.max(up.suit * 0.75, 0.30); // 同级：不相上下就能顶
          else win = false;                                            // 更低级：永远顶不掉更高的
          if (win) { up.buried = true; this._buried++; return this._put(i, si, mat, true); }
          return false;
        }
        if (sp.tier < mp.sp.tier) return false;
        if (sp.tier === mp.sp.tier && this.suitAt(si, i, 0) < mp.suit + 0.15) return false;
      } else {
        if (!this._canDisplace(si, i, mp)) return false;
      }
      if (this.suitAt(si, i, 0) < 0.20) return false;
      // 被取代的那一株：如果它是低矮的、而新来的是高大的，就让它留下当林下植被
      if (mp.sp.under && !sp.under && this.cellU[i] < 0) {
        this.cellP[i] = -1;
        this.cellU[i] = main;
        mp.under = true;
        return this._put(i, si, mat, false);
      }
      mp.buried = true; this._buried++;
    }

    return this._put(i, si, mat, false);
  }

  /** 写入一株新植物（主层或林下） */
  _put(i, si, mat, toUnder) {
    const sp = CFG.SPECIES[si];
    const p = {
      i, si, sp,
      gx: i % this.cols, gy: (i / this.cols) | 0,
      mat: sp.kind === 'rock' ? 1 : mat,   // 石头放下即成型
      seed: (Math.random() * 1e6) | 0,
      suit: 0,
      crowd: 0,
      buried: false,
      under: !!toUnder,
      shadeEnv: 0,        // 别人投给我的遮阴（不含我自己）—— 下一 tick 会用上
      // 每株自己记一个「上次状态」，用于判断「刚刚活过来」并播提示音
      prevAlive: false,
    };
    this.plants.push(p);
    const pi = this.plants.length - 1;
    if (toUnder) this.cellU[i] = pi; else this.cellP[i] = pi;
    this.seenSpecies.add(sp.id);
    return true;
  }

  /* =========================================================================
   *  适宜度 —— 一株植物在某一格活得怎么样
   *  -------------------------------------------------------------------------
   *  用的是「最小因子定律」：木桶能装多少水，取决于最短那块板。
   *  水、养分、光照、温度四个因子取最小值。所以你光把水灌满没用，
   *  养分不够，它一样不动。这就是演替必须一层一层来的原因。
   * ====================================================================== */
  suitAt(si, i, crowd, shadeOverride = null) {
    const sp = CFG.SPECIES[si];
    const m = this.mois[i], n = this.nut[i];
    // 遮阴：默认用这一格的总遮阴；但对「已经长起来的这一株」要减掉它自己投下的那部分 ——
    // 不然一棵树长成之后，会用自己的树冠把自己闷死。
    const s = (shadeOverride === null) ? this.shade[i] : shadeOverride;

    // 四块板
    const w = U.trapezoid(m, sp.waterCurve[0], sp.waterCurve[1], sp.waterCurve[2], sp.waterCurve[3]);
    const nu = U.trapezoid(n, sp.nutCurve[0], sp.nutCurve[1], 9, 9);
    const sh = U.trapezoid(s, sp.shadeCurve[0], sp.shadeCurve[1], sp.shadeCurve[2], sp.shadeCurve[3]);
    const tp = U.trapezoid(this.tempNow, sp.tempCurve[0], sp.tempCurve[1], 9, 9);

    let suit = Math.min(w, nu, sh, tp);

    // 拥挤：周围挤满了同类 → 抢水抢光，长不动
    if (crowd > sp.crowdSoft) {
      suit /= (1 + (crowd - sp.crowdSoft) * sp.crowdPenalty);
    }
    return suit;
  }

  /** 数一数某一格周围 8 格里有几株同类 —— 扩散和生长都用它来算拥挤度 */
  _crowdAt(si, i) {
    const cols = this.cols, rows = this.rows;
    const gx = i % cols, gy = (i / cols) | 0;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = gy + dy; if (yy < 0 || yy >= rows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = gx + dx; if (xx < 0 || xx >= cols) continue;
        const np = this.cellP[yy * cols + xx];
        if (np >= 0 && this.plants[np].si === si) c++;
      }
    }
    return c;
  }

  /**
   * 主层里，新来的这一株能不能顶掉已经站在那儿的那一株。
   *   · 更高级的（灌木顶草、树顶灌木）：只要在这儿活得下去就能顶
   *   · 同级的：得明显更适应才行。
   *     这一条是给芦苇留的门 —— 灌木先长到了水边，芦苇跟它同级，
   *     要是同级永远顶不掉，水边就永远长不出芦苇来。
   */
  _canDisplace(si, i, mp) {
    const sp = CFG.SPECIES[si];
    if (sp.tier < mp.sp.tier) return false;
    const mine = this.suitAt(si, i, 0);
    if (mine < 0.20) return false;
    if (sp.tier > mp.sp.tier) {
      // 更高级的：能顶掉「在这儿过得不如我」的，或者本来就快撑不住的。
      // （不能无条件顶 —— 否则一棵勉强活着的树也会把岸边长得正好的芦苇顶掉）
      return mine > mp.suit * 0.85 || mp.suit < 0.45;
    }
    return mine > mp.suit + 0.25;      // 同级：得明显更适应
  }

  /* =========================================================================
   *  一个模拟步
   *  ctx = { season, dayFrac, sunHeight, isNight, temp, dt }
   * ====================================================================== */
  tick(ctx) {
    const S = CFG.SOIL, G = CFG.GROWTH;
    const dt = ctx.dt || 1;
    const n = this.n, cols = this.cols, rows = this.rows;

    this.tickCount++;
    this.tempNow = ctx.temp;

    /* ---------- 1. 清空累加器 ---------- */
    this.accRetain.fill(0);
    this.accFix.fill(0);
    this.accShade.fill(0);
    this.accDrink.fill(0);
    this.accCarpet.fill(0);
    this.accTier.fill(0);
    this.spCount.fill(0);
    this.spMature.fill(0);

    /* ---------- 降雨事件（让生态有波动，不至于一路单调上升） ---------- */
    this.rainTimer -= dt;
    if (this.rainTimer <= 0) {
      this.rainTimer = 600 + Math.random() * 1200;
      if (Math.random() < 0.55) this.rainMul = 1.6 + Math.random() * 0.9;  // 一阵雨
      else this.rainMul = 1.0;
    }
    this.rainMul += (1.0 - this.rainMul) * 0.004 * dt;   // 慢慢回到常态

    /* ---------- 2. 逐株植物：算适宜度 → 生长/衰退 → 累加影响 ---------- */
    const plants = this.plants;
    let biomass = 0;
    let woody = 0;          // 木本生物量：只有灌木与树算「森林」，草不算
    let justAlive = 0;
    const sprouted = [];   // 这一 tick 刚刚「活过来」的，用来播极轻的提示音

    // 夜里和冬天整体变慢（但不停止）
    const seasonalSlow = U.lerp(G.winterSlow, 1, U.clamp(this.tempNow / 0.5, 0, 1));
    const timeMul = (ctx.isNight ? G.nightSlow : 1) * seasonalSlow;

    for (let k = 0; k < plants.length; k++) {
      const p = plants[k];
      if (p.buried) continue;          // 被盖住的，不再参与任何计算
      const i = p.i, sp = p.sp;

      if (sp.kind === 'rock') {
        // 石头不会长，也不会坏，只是静静地在那里改变周围
        this.accRetain[i] += sp.retain;
        this.accShade[i] += sp.shadeOut;
        this.accFix[i] += sp.fix * 0.2;
        continue;
      }

      /* --- 数一数周围有多少同类（拥挤度） --- */
      const crowd = this._crowdAt(p.si, i);
      p.crowd = crowd;

      /* --- 适宜度（用「别人投给我的」遮阴，不含我自己投的） --- */
      const suit = this.suitAt(p.si, i, crowd, p.shadeEnv);
      p.suit = suit;

      /* --- 生长 or 衰退 ---
         条件够了就长；不够就慢慢退回休眠。
         注意：永远不会掉到 0 以下，这里是「没有死亡」的地方。 */
      if (suit > 0.001) {
        const before = p.mat;
        p.mat = Math.min(1, p.mat + sp.growth * suit * timeMul * dt);
        if (before < 0.6 && p.mat >= 0.6) this.spMature[p.si]++;
      } else {
        p.mat = Math.max(G.dormantFloor, p.mat - sp.dormantDecay * dt);
      }

      /* --- 「刚刚活过来」：从休眠中恢复，或者第一次冒芽 --- */
      const alive = suit > 0.02;
      if (alive && !p.prevAlive && p.mat > 0.12) {
        if (justAlive < CFG.AUDIO.sproutBudgetPerTick) { sprouted.push(p); justAlive++; }
      }
      p.prevAlive = alive;

      /* --- 累加对土壤的反作用（乘以成熟度：小苗影响小） --- */
      const m = p.mat;
      this.accRetain[i] += sp.retain * (0.3 + 0.7 * m);
      this.accFix[i] += sp.fix * m;
      this.accShade[i] += sp.shadeOut * m;
      this.accDrink[i] += sp.drink * m;
      this.accCarpet[i] += sp.carpet * m;
      // 长起来了，就把这一格的「层级」往上顶一格 —— 土的肥力上限随之提高
      if (m >= S.nutrient.tierMinMat && sp.tier > this.accTier[i]) this.accTier[i] = sp.tier;

      biomass += m * BIOMASS_W[sp.tier];
      woody += m * WOODY_W[sp.tier];
      this.spCount[p.si]++;
      if (m >= 0.6) this.spMature[p.si]++;
    }

    this.biomass = biomass;
    // 「森林度」由木本植物决定 —— 草铺满一地也不算森林，
    // 得等灌木和树起来了，地下水才会渗出、雾才会变多、风声才会变柔。
    this.forestness = U.clamp(woody / S.water.forestFull, 0, 1);

    /* ---------- 3. 全域扩散：本格 → 邻格
       这是「连成片」的技术原因：一株草只能改变脚下一寸土，
       一片草能改变一整块地。正反馈就藏在这个 0.34 里。 ---------- */
    this._blur(this.accRetain, this.fRetain, 0.50);
    this._blur(this.accFix, this.fFix, S.nutrient.neighborShare);
    this._blur(this.accShade, this.fShade, 0.62);
    this._blur(this.accCarpet, this.carpet, 0.85);
    // 耗水用「累加」：邻居越多，抢得越狠（这就是铺太密会停滞的原因）
    this._blurSum(this.accDrink, this.fDrink, S.moisture.drinkNeighbor);
    // 层级用「取最大」：只要邻域里有一株灌木，这一片就按灌木的标准算肥力上限
    this._blurMax(this.accTier, this.fTier);

    /* ---------- 4. 土壤更新 ---------- */

    // 地下水位：森林形成后，土开始留住水，低洼处会渗出积水
    const target = S.water.baseLevel + this.forestness * S.water.forestGain;
    this.waterTable += (target - this.waterTable) * Math.min(1, 0.004 * dt);

    const rain = S.moisture.rainGain * CFG.TIME.seasonRain[ctx.season] * this.rainMul;
    let hasWater = false, maxM = 0, maxN = 0;

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;

        // (a) 积水：地形势越低，越早被地下水淹到
        const w = 1 - U.smoothstep(this.waterTable, this.waterTable + S.water.edge, this.height[i]);
        this.wet[i] = w;
        if (w > 0.5) hasWater = true;

        // (b) 遮阴：向目标值跟随
        const shadeTarget = U.clamp(this.fShade[i], 0, 1);
        const kShade = Math.min(1, S.shade.decay * dt);   // 离线快进时 dt 很大，别过冲
        this.shade[i] += (shadeTarget - this.shade[i]) * kShade;

        /* (c) 水分：一个动态平衡
             目标 = 裸地基准 + 低洼加成 + 降雨
                  + 植被保水（饱和曲线：越多植被，增益越接近上限）
                  + 遮阴抑蒸
                  - 植物喝掉的
             实际值朝目标慢慢靠近 —— 这个「慢慢」就是从灰黄到苍绿的过程 */
        const lowland = 1 - this.height[i];

        // 保水饱和曲线：植被越多越接近上限，但永远到不了顶（防止一株草顶一片林）
        const sat = 1 - Math.exp(-this.fRetain[i] / S.moisture.retainHalf);
        let mt = S.moisture.bare
           + lowland * S.moisture.heightGain
           + rain
           + S.moisture.retainGain * sat
           + S.moisture.shadeGain * this.shade[i]
           + (ctx.isWinter ? S.moisture.winterGain : 0)
           - S.moisture.drinkMul * this.fDrink[i]
           - this.rock[i] * 0.05;

        // 泡在水里的格子，水分直接拉满
        if (w > 0.05) mt = Math.max(mt, U.lerp(mt, 0.96, w));

        const kMois = Math.min(1, S.moisture.approach * dt);
        this.mois[i] += (U.clamp(mt, 0, 1) - this.mois[i]) * kMois;
        this.mois[i] = U.clamp(this.mois[i], 0, 1);

        /* (d) 养分：落叶与固氮一点点攒起来，但攒不到天上去 ——
                 上限由「这里长到过什么层级」决定（见 config 里的 capByTier）。
                 草把土垫到刚够灌木，灌木再垫一格，树才进得来。
                 长期没人管的地方会慢慢退回荒原。 */
        const cap = S.nutrient.capByTier[(this.fTier[i] | 0)] || 0.10;
        // 贫瘠到一定程度就不再流失了（荒原有自己的底线，不会无限退化）
        const dc = this.nut[i] > S.nutrient.decayFloor ? S.nutrient.decay : 0;
        let nv = this.nut[i] + this.fFix[i] * S.nutrient.fixGain * S.nutrient.fixRate * dt
                             - dc * dt;
        if (nv > cap) nv = Math.max(cap, nv - S.nutrient.capFall * dt);  // 超过上限就慢慢回落
        this.nut[i] = U.clamp(nv, 0, 1);

        if (this.mois[i] > maxM) maxM = this.mois[i];
        if (this.nut[i] > maxN) maxN = this.nut[i];
      }
    }
    // 水第一次出现 —— 让芦苇在岸边扎下第一批根。
    // 如果只靠「随机挑一格正好挑到岸边」，芦苇可能几百 tick 都不露面，
    // 玩家就永远看不到「水边自己长出了东西」。所以水一出现就播一批种，
    // 之后交给它自己扩散。（这一句对应的就是芦苇的那句提示：
    // 「水出现的第二天，它就在那儿了。」）
    this.hasWater = hasWater;
    // 没扎下根就过一阵再试 —— 水刚漫上来时岸边可能还不够湿，
    // 得等这一带真的泡透了芦苇才活得成。扎下根之后就不再管它了。
    if (hasWater && !this._waterFounded && this.tickCount % 60 === 0) {
      if (Life.foundWaterPlants(this) > 0) this._waterFounded = true;
    }
    this.maxMois = maxM;
    this.maxNut = maxN;

    // 积雪：冬天慢慢积起来，春天化掉
    // 积雪：跟着「冬意」走（0..1 的连续量）。因为是渐变，
    // 不会一夜之间忽然全白、也不会在春天刚开头就化得干干净净。
    if (ctx.winterness !== undefined) {
      this.snowAmt = U.clamp(this.snowAmt + (ctx.winterness - this.snowAmt) * U.clamp(0.0016 * dt, 0, 1), 0, 1);
    } else if (ctx.isWinter) {
      this.snowAmt = Math.min(1, this.snowAmt + 0.0016 * dt);
    } else {
      this.snowAmt = Math.max(0, this.snowAmt - 0.0045 * dt);
    }

    /* ---------- 5. 繁殖：成熟植物向外播种 ---------- */
      for (let k = 0; k < plants.length; k++) {
        const p = plants[k];
        if (p.buried) continue;
        if (p.mat < 0.85 || p.suit < 0.15) continue;
        const sp = p.sp;
        if (sp.spread <= 0) continue;
      // 概率按 dt 缩放；离线快进时 dt 很大，这里夹一下防止失真
      if (Math.random() > Math.min(0.9, sp.spread * p.suit * dt)) continue;

      const gx = p.gx, gy = p.gy;
      const R = sp.spreadRadius;
      // 在半径内随机挑一格（偏向近处）
      for (let attempt = 0; attempt < 3; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = (0.6 + Math.random() * 0.9) * R;
        const tx = Math.round(gx + Math.cos(ang) * rad);
        const ty = Math.round(gy + Math.sin(ang) * rad);
        if (!this.inBounds(tx, ty)) continue;
        const ti = this.idx(tx, ty);
        if (this.wet[ti] > 0.9) continue;
        // 种子落在条件不够的地方不会发芽 —— 这就是演替的门槛，
        // 也是为什么绿色只能从已经长起来的地方一圈一圈往外推。
        // 每种植物还有自己的门槛（树的高、草的低），决定了它最终能长多密。
        //
        // 注意这里把「目标格的同类拥挤度」也算了进去：
        // 一格周围同类越多，适宜度越低 → 扩散自然停下。
        // 这是「野花不会把每格都占满」的关键（不然会铺成规则网格）。
        const gate = sp.spreadGate !== undefined ? sp.spreadGate : CFG.WILD.spreadGate;
        if (this.suitAt(p.si, ti, this._crowdAt(p.si, ti)) < gate) continue;
        if (this._sow(ti, p.si, 0.02)) break;
      }
    }

    /* ---------- 6. 野生：玩家没放，自己长出来的东西 ---------- */
    Life.wildSpawn(this, ctx, dt);

    /* ---------- 7. 为下一 tick 准备：算出「别人投给我的」遮阴 ---------- */
    for (let k = 0; k < plants.length; k++) {
      const p = plants[k];
      if (p.buried || p.sp.kind === 'rock') continue;
      p.shadeEnv = U.clamp(this.fShade[p.i] - p.sp.shadeOut * p.mat, 0, 1);
    }

    /* ---------- 8. 整理：被盖住的攒太多了就清一次 ---------- */
    if (this._buried > 2500) this.compact();

    return sprouted;
  }

  /** 把被盖住的植物从数组里真正删掉，并修正所有格子的指向 */
  compact() {
    const old = this.plants;
    const next = [];
    const remap = new Int32Array(old.length);
    for (let k = 0; k < old.length; k++) {
      const p = old[k];
      if (p.buried) { remap[k] = -1; continue; }
      remap[k] = next.length;
      next.push(p);
    }
    this.plants = next;
    for (let i = 0; i < this.n; i++) {
      const pi = this.cellP[i];
      this.cellP[i] = pi >= 0 ? remap[pi] : -1;
      const ui = this.cellU[i];
      this.cellU[i] = ui >= 0 ? remap[ui] : -1;
    }
    this._buried = 0;
  }

  /**
   * 3×3 扩散：out[i] = self + sideW × (八个邻居的平均)
   * 边界处用「自己」补位，避免边缘被稀释。
   */
  _blur(src, out, sideW) {
    const cols = this.cols, rows = this.rows;
    for (let gy = 0; gy < rows; gy++) {
      const up = gy > 0, dn = gy < rows - 1;
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        let s = 0;
        const lf = gx > 0, rt = gx < cols - 1;
        s += (up && lf) ? src[i - cols - 1] : src[i];
        s += (up) ? src[i - cols] : src[i];
        s += (up && rt) ? src[i - cols + 1] : src[i];
        s += (lf) ? src[i - 1] : src[i];
        s += (rt) ? src[i + 1] : src[i];
        s += (dn && lf) ? src[i + cols - 1] : src[i];
        s += (dn) ? src[i + cols] : src[i];
        s += (dn && rt) ? src[i + cols + 1] : src[i];
        out[i] = src[i] + sideW * (s / 8);
      }
    }
  }

  /**
   * 3×3 累加：out[i] = self + k × (八个邻居之和)
   * 邻居越多，总量越大 —— 用来表达「抢水」这种会互相叠加的竞争。
   */
  _blurSum(src, out, k) {
    const cols = this.cols, rows = this.rows;
    for (let gy = 0; gy < rows; gy++) {
      const up = gy > 0, dn = gy < rows - 1;
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        let s = 0;
        const lf = gx > 0, rt = gx < cols - 1;
        if (up && lf) s += src[i - cols - 1];
        if (up) s += src[i - cols];
        if (up && rt) s += src[i - cols + 1];
        if (lf) s += src[i - 1];
        if (rt) s += src[i + 1];
        if (dn && lf) s += src[i + cols - 1];
        if (dn) s += src[i + cols];
        if (dn && rt) s += src[i + cols + 1];
        out[i] = src[i] + k * s;
      }
    }
  }

  /** 3×3 取最大值：out[i] = max(自己, 八个邻居) */
  _blurMax(src, out) {
    const cols = this.cols, rows = this.rows;
    for (let gy = 0; gy < rows; gy++) {
      const up = gy > 0, dn = gy < rows - 1;
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        let m = src[i];
        const lf = gx > 0, rt = gx < cols - 1;
        if (up && lf && src[i - cols - 1] > m) m = src[i - cols - 1];
        if (up && src[i - cols] > m) m = src[i - cols];
        if (up && rt && src[i - cols + 1] > m) m = src[i - cols + 1];
        if (lf && src[i - 1] > m) m = src[i - 1];
        if (rt && src[i + 1] > m) m = src[i + 1];
        if (dn && lf && src[i + cols - 1] > m) m = src[i + cols - 1];
        if (dn && src[i + cols] > m) m = src[i + cols];
        if (dn && rt && src[i + cols + 1] > m) m = src[i + cols + 1];
        out[i] = m;
      }
    }
  }

  /* =========================================================================
   *  查询
   * ====================================================================== */
  plantAt(gx, gy) {
    if (!this.inBounds(gx, gy)) return null;
    const pi = this.cellP[this.idx(gx, gy)];
    return pi >= 0 ? this.plants[pi] : null;
  }
  count(spId) { return this.spCount[SP_INDEX[spId]] || 0; }
  matureCount(spId) { return this.spMature[SP_INDEX[spId]] || 0; }

  /**
   * 随机找一株成熟的指定物种（动物找目标、萤火虫找落脚点时用）。
   * 植物很多的时候不会精确，随便抓一个就行，这里只求快。
   * 返回 { wx, wy } 世界坐标。
   */
  randomPlantOf(...spIds) {
    const set = spIds.map(id => SP_INDEX[id]).filter(v => v !== undefined);
    const cell = CFG.WORLD.cell;
    for (let t = 0; t < 260; t++) {
      const p = this.plants[(Math.random() * this.plants.length) | 0];
      if (!p) return null;
      if (p.mat < 0.5) continue;
      if (set.indexOf(p.si) < 0) continue;
      return { wx: (p.gx + 0.5) * cell, wy: (p.gy + 0.5) * cell, p };
    }
    return null;
  }
}

// 各层级的「生物量权重」：一棵树顶八株草
const BIOMASS_W = [0.30, 0.55, 1.70, 4.20];
// 「木本」权重：只有灌木与树算森林（草和地衣不算）。
// 灌木权重故意压得很低 —— 灌丛成片只是中途站，树林长起来才算真正的森林。
const WOODY_W = [0, 0, 0.5, 3.2];
