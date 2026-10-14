/* =============================================================================
 *  life.js —— 生命的两件小事：自己冒出来，以及玩家手边多了什么
 *  ---------------------------------------------------------------------------
 *  这里只放两件事：
 *
 *    A. 野生（wildSpawn）
 *       每隔一会儿在世界里随机挑一个角落，如果那里的土壤刚好「够格」，
 *       就自己长出一株。它可能长在你没碰过的地方，也可能是一种你从没见过的东西。
 *       —— 这是「咦，这里长了个我没种的东西」的来源，游戏的灵魂。
 *
 *    B. 解锁（checkUnlocks）
 *       玩家的种子栏不是一开始就全给的。土变好了，手边才会多出新的东西。
 *       「灌木」出现在种子栏里的那一刻，本身就是一种反馈：地，可以了。
 * ========================================================================== */

const Life = {

  // 回调：某个东西自己长出来了（UI 会拿它弹一句极轻的提示）
  onWildSpawn: null,

  /* =========================================================================
   *  A. 野生
   * ====================================================================== */
  wildSpawn(world, ctx, dt) {
    const W = CFG.WILD;

    // 这一 tick 尝试几次（可以是小数，用概率凑）
    let tries = W.triesPerTick * dt;
    let n = Math.floor(tries);
    if (Math.random() < tries - n) n++;

    for (let t = 0; t < n; t++) {
      const i = (Math.random() * world.n) | 0;
      if (world.wet[i] > 0.9) continue;         // 深水里不长

      /* 两层都占满了，通常就没位置了。但有一个例外很重要：
         树长起来之后，原来那层草晒不到太阳、状态很差（suit 接近 0），
         这时候不去动它，林下就永远是一层半死不活的草，蕨和苔藓也就永远进不来。
         所以只要脚下那株明显不适应，就给它一个被顶替的机会。 */
      const main = world.cellP[i], und = world.cellU[i];
      if (main >= 0 && und >= 0) {
        const up = world.plants[und];
        if (up.suit > 0.35) continue;           // 它活得挺好的，不挤它
      }

      // 在「有资格野生」的物种里，按各自的稀有度加权抽一个。
      // 以前是「谁在这一格最舒服就一定是谁」，结果永远是同一种赢，
      // 别的物种（蘑菇、芦苇）根本没机会露脸。
      // 改成加权随机之后，extra.chance 就等于「这种东西有多常见」，
      // 想让蘑菇少一点，把它的数调小就行 —— 一眼就能看懂、直接能调。
      let pickSi = -1, totalW = 0;
      for (let si = 0; si < CFG.SPECIES.length; si++) {
        const sp = CFG.SPECIES[si];
        const extra = W.extra[sp.id] || {};

        // 有专门设定，或者是「玩家已见过的可种植物种」（后者做远距离跳播）
        const isWildCard = !!extra.chance;
        const isKnownJump = sp.plantable && world.seenSpecies.has(sp.id);
        if (!isWildCard && !isKnownJump) continue;

        // 需要种源却还没出现过 → 跳过（总不能凭空长出一片从没见过的林子）
        if (extra.needSource && !world.seenSpecies.has(sp.id)) continue;

        const gate = extra.gate !== undefined ? extra.gate : W.suitGate;
        if (world.suitAt(si, i, 0) < gate) continue;

        // 权重 = 稀有度（远距离跳播压得很低）；再掺一点随机，让角落之间长得不一样
        const w = (isWildCard ? extra.chance : W.spawnChance * 0.35)
                * (0.6 + Math.random() * 0.8);
        totalW += w;
        if (Math.random() * totalW < w) pickSi = si;   // 蓄水池式加权抽样，一趟搞定
      }
      if (pickSi < 0) continue;
      const bestSp = CFG.SPECIES[pickSi];

      const suit = world.suitAt(pickSi, i, 0);

      // 附近有成熟植被时更容易发生 —— 看起来像是从那一片「蔓延」过来的
      const boost = this._hasNeighborPlant(world, i) ? W.neighborBoost : 1;

      if (Math.random() < Math.min(0.9, W.spawnChance * suit * boost * dt)) {
        const isNew = !world.seenSpecies.has(bestSp.id);
        if (world._sow(i, pickSi, 0.05)) {
          if (this.onWildSpawn) this.onWildSpawn(bestSp, i, isNew);
        }
      }
    }
  },

  /* =========================================================================
   *  A2. 水第一次出现：在岸边给芦苇扎根
   *      这是「设计好的惊喜」，不靠随机撞运气 —— 玩家刚看到水洼，
   *      过一会儿就发现岸边自己冒出了芦苇。
   * ====================================================================== */
  foundWaterPlants(world) {
    const si = SP_INDEX['reed'];
    if (si === undefined) return 0;
    const sp = CFG.SPECIES[si];
    // 比平时的野生育种门槛宽松一点：要保证真的扎得下根
    const gate = (CFG.WILD.extra.reed.gate !== undefined ? CFG.WILD.extra.reed.gate : 0.5) * 0.8;
    const cols = world.cols, rows = world.rows;
    const want = CFG.WILD.waterFounding;
    let seeded = 0;
    for (let attempt = 0; attempt < 1200 && seeded < want; attempt++) {
      const gx = (Math.random() * cols) | 0;
      const gy = (Math.random() * rows) | 0;
      const i = world.idx(gx, gy);
      if (world.wet[i] > 0.9) continue;
      if (world.suitAt(si, i, 0) < gate) continue;
      const isNew = !world.seenSpecies.has(sp.id);
      if (world._sow(i, si, 0.06)) {
        seeded++;
        if (this.onWildSpawn) this.onWildSpawn(sp, i, isNew);
      }
    }
    return seeded;
  },

  _hasNeighborPlant(world, i) {
    const cols = world.cols, rows = world.rows;
    const gx = i % cols, gy = (i / cols) | 0;
    for (let dy = -2; dy <= 2; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        const xx = gx + dx, yy = gy + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        const pi = world.cellP[yy * cols + xx];
        if (pi >= 0 && world.plants[pi].mat > 0.4) return true;
      }
    }
    return false;
  },

  /* =========================================================================
   *  B. 解锁：什么时候，玩家的手边会多出一样东西
   * ====================================================================== */
  checkUnlocks(world, unlocked) {
    const newly = [];
    for (let si = 0; si < CFG.SPECIES.length; si++) {
      const sp = CFG.SPECIES[si];
      if (!sp.plantable) continue;               // 惊喜物种永远不给玩家
      if (unlocked.has(sp.id)) continue;

      // 没写 unlock 的可种植物种，默认一开始就有（地衣、旱草）
      const u = sp.unlock || { type: 'always' };
      let ok = false;
      if (u.type === 'always') ok = true;
      else if (u.type === 'soil') ok = world.maxMois >= u.moisture && world.maxNut >= u.nutrient;
      else if (u.type === 'waterOrMoist') ok = world.hasWater || world.maxMois >= u.moisture;

      if (ok) { unlocked.add(sp.id); newly.push(sp); }
    }
    return newly;
  },

  /* =========================================================================
   *  C. 动物带来的种子（由 animals.js 调用）
   *      从远处飞来，落在某个地方。落点合不合适它不管，能不能活看土。
   * ====================================================================== */
  dropSeed(world, gx, gy, spIds) {
    if (!world.inBounds(gx, gy)) return null;
    const i = world.idx(gx, gy);
    if (world.wet[i] > 0.9) return null;
    const main = world.cellP[i], und = world.cellU[i];
    if (main >= 0 && und >= 0) return null;     // 掉在别人身上就掉了，不硬挤

    // 在候选里挑一个「这一格最有可能活下来」的
    let best = -1, bestSuit = 0.05;
    for (const id of spIds) {
      const si = SP_INDEX[id];
      if (si === undefined) continue;
      const s = world.suitAt(si, i, 0);
      if (s > bestSuit) { bestSuit = s; best = si; }
    }
    if (best < 0) return null;

    const sp = CFG.SPECIES[best];
    const isNew = !world.seenSpecies.has(sp.id);
    if (world._sow(i, best, 0.04)) {
      if (this.onWildSpawn) this.onWildSpawn(sp, i, isNew, true);
      return sp;
    }
    return null;
  },
};
