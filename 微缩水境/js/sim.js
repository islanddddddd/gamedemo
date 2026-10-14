// ============================================================
// sim.js —— 水质与生态模拟（按 tick 推进）
// 默认 1 秒 = 1 游戏分钟；tick(game, dt) 的 dt 单位为「游戏分钟」。
// 核心：氮循环（氨→亚硝酸盐→硝酸盐）、鱼的生理、藻类、植物、食物腐败。
// ============================================================

import { SPECIES_DB, ITEM_DB, WATER_CFG, TANK_CFG } from './db.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- 初始水质（新缸：干净但缺乏硝化菌） ----------
export function createWater() {
  return {
    temp: 24, ph: 7.0, nh3: 0.02, no2: 0.01, no3: 5,
    do: 8.0, clarity: 0.98, phosphate: 0.05,
  };
}

// ---------- 昼夜光照曲线（0..1，6 点天亮 20 点天黑） ----------
export function dayLight(game) {
  const h = game.minutes / 60;
  let v;
  if (h < 5.5 || h >= 20) v = 0;
  else if (h < 7) v = ((h - 5.5) / 1.5) * 0.85;
  else if (h >= 17.5) v = ((20 - h) / 2.5) * 0.85;
  else v = 0.85 + 0.15 * Math.sin(((h - 7) / 10.5) * Math.PI);
  // 灯具叠加（夜晚开灯可继续光合作用）
  if (game.equip.lamp) v += game.equip.lampIntensity;
  return clamp(v, 0, 1.15);
}

// 当前是否为夜晚（场景/BGM 切换依据）
export function isNight(game) {
  const h = game.minutes / 60;
  return h < 5.5 || h >= 20;
}

// ---------- 造景/设备汇总修正 ----------
function envMods(game) {
  let ph = 0, gh = 0, kh = 0, beauty = 0, surf = 1, hideout = 0, tannin = 0;
  for (const it of game.items || []) {
    const def = ITEM_DB[it.type];
    if (!def || !def.effects) continue;
    const e = def.effects;
    if (e.ph) ph += e.ph;
    if (e.gh) gh += e.gh;
    if (e.kh) kh += e.kh;
    if (e.beauty) beauty += e.beauty;
    if (e.bacteriaSurface) surf += e.bacteriaSurface;
    if (e.hideout) hideout += e.hideout;
    if (e.tannin) tannin += e.tannin;
  }
  if (game.equip.filter) surf += 0.4;
  if (game.equip.co2) ph -= 0.3;
  return { ph, gh, kh, beauty, surf, hideout, tannin };
}

// ---------- 单参数仪表状态 ----------
export function paramStatus(key, v) {
  const c = WATER_CFG[key];
  if (key === 'temp' || key === 'ph') {
    const [i0, i1] = c.ideal, [o0, o1] = c.ok;
    if (v >= i0 && v <= i1) return 'good';
    if (v >= o0 && v <= o1) return 'warn';
    return 'danger';
  }
  // 溶氧 / 清澈度：越低越糟
  if (key === 'do' || key === 'clarity') {
    if (v >= c.good) return 'good';
    if (v >= c.warn) return 'warn';
    return 'danger';
  }
  // nh3 / no2 / no3：越高越糟
  if (v <= c.safe) return 'good';
  if (v <= c.warn) return 'warn';
  return 'danger';
}

// ---------- 生态健康度 0..1（驱动 BGM 分层与评分） ----------
export function ecoHealth(game) {
  const w = game.water;
  const bad = (v, safe, danger) => clamp(1 - (v - safe) / Math.max(0.001, danger - safe), 0, 1);
  const h = Math.min(
    bad(w.nh3, WATER_CFG.nh3.safe, WATER_CFG.nh3.danger),
    bad(w.no2, WATER_CFG.no2.safe, WATER_CFG.no2.danger),
    bad(w.no3, WATER_CFG.no3.safe, WATER_CFG.no3.danger * 1.5),
    clamp(w.do / WATER_CFG.do.good, 0, 1),
    w.clarity,
    1 - game.algae.bluegreen * 0.8 - game.algae.bloom * 0.5,
    clamp(game.bacteria, 0.3, 1) + 0.4,
  );
  return clamp(h, 0, 1);
}

// ============================================================
//  主推进函数
// ============================================================
export function tick(game, dt) {
  const w = game.water;
  const ev = [];
  const mods = envMods(game);
  const light = dayLight(game);
  const night = isNight(game);
  const prev = game._prev || (game._prev = {});

  // ---------- 1. 生物量统计 ----------
  let bioload = 0, mouths = 0, herbMouths = 0, o2ConsumeBase = 0;
  for (const f of game.creatures) {
    if (f.state === 'corpse') continue;
    bioload += f.sp.bioload * (0.3 + 0.7 * f.scale);
    if (f.sp.diet === 'herbivore') herbMouths += f.scale;
    mouths += f.scale;
    o2ConsumeBase += f.sp.metabolism * f.scale;
  }
  const overload = bioload > TANK_CFG.capacity;

  // ---------- 2. 氮循环（核心机制） ----------
  // 氨来源：鱼排泄（代谢）+ 底床腐败 + 尸体分解
  let nh3Src = bioload * 3.3e-5 * (0.6 + 0.4 * (w.temp / 25));
  nh3Src += game.detritus * 0.0004;
  for (const f of game.creatures) {
    if (f.state === 'corpse') nh3Src += f.sp.bioload * 0.0022; // 尸体分解强烈产氨
  }
  // 硝化菌转化（需氧；附着面 = 火山石/陶粒/过滤）
  const oxy = w.do < 3 ? 0.25 : 1;
  const k1 = 0.010 * game.bacteria * mods.surf * oxy;
  const k2 = 0.012 * game.bacteria * mods.surf * oxy;
  const conv1 = Math.min(w.nh3, w.nh3 * k1 * dt + 0); // 一阶衰减
  w.nh3 += nh3Src * dt - conv1;
  const conv2 = Math.min(w.no2, w.no2 * k2 * dt);
  w.no2 += conv1 * 0.92 - conv2;
  w.no3 += conv2 * 0.88;
  // 硝酸盐移除：水草吸收（受光驱动）+ 微弱反硝化
  let plantNo3 = 0, plantO2 = 0, plantCompete = 0, plantHide = 0, plantBeauty = 0;
  for (const p of game.plants) {
    const def = ITEM_DB[p.type];
    if (!def || !def.effects) continue;
    const e = def.effects;
    const grow = 0.4 + 0.6 * light;
    plantNo3 += (e.no3Absorb || 0) * p.biomass * grow;
    plantO2 += (night ? (e.nightO2 || 0) : (e.o2 || 0)) * p.biomass;
    if (e.shade) plantCompete += e.shade * p.biomass; // 浮萍遮光抑藻
    if (e.hideout) plantHide += e.hideout * p.biomass;
    if (e.beauty) plantBeauty += e.beauty * p.biomass;
  }
  if (game.equip.co2) plantNo3 *= 1.5;
  w.no3 -= w.no3 * Math.min(0.02, plantNo3 * 0.0016) * dt;
  w.no3 -= w.no3 * 2e-5 * dt;
  // 硝化菌成长：以氨/亚硝酸盐为食，约 2 天成熟（养水期教学点）
  const food4bac = Math.min(0.4, w.nh3 + w.no2);
  game.bacteria = clamp(game.bacteria + (0.00035 + food4bac * 0.0009) * mods.surf * dt, 0, 1);
  if (prev.cycling !== true && game.bacteria > 0.6) {
    ev.push({ type: 'ok', msg: '硝化群趋于成熟，度过养水期，可以稳步增加鱼口了' });
    prev.cycling = true;
  }

  // ---------- 3. 溶氧 DO ----------
  const o2Prod = Math.max(0, plantO2) * 0.02 * light + 0.012 + (game.equip.pump ? 0.16 : 0) + (game.equip.filter ? 0.02 : 0);
  const o2Cons = o2ConsumeBase * 0.00055 * (0.5 + 0.5 * (w.temp / 25)) + Math.min(0, plantO2) * 0.02 + game.bacteria * 0.004 + (game.algae.bloom > 0.5 && night ? 0.05 : 0);
  w.do = clamp(w.do + (o2Prod - o2Cons) * 0.6 * dt, 0, WATER_CFG.do.max);
  if (w.do < WATER_CFG.do.danger && !prev.doWarn) {
    ev.push({ type: 'danger', msg: '⚠ 溶氧过低！鱼类开始浮头，请开启气泵或换水' });
    prev.doWarn = true;
  } else if (w.do > WATER_CFG.do.warn) prev.doWarn = false;

  // ---------- 4. 温度 / pH / 浑浊度 / 磷酸盐 ----------
  const dayT = 24 + Math.sin((game.minutes / 1440 - 0.25) * Math.PI * 2) * 1.5;
  const tempTarget = game.equip.heater ? game.equip.heaterTarget : dayT;
  w.temp += (tempTarget - w.temp) * 0.002 * dt;
  const phTarget = 7.0 + mods.ph;
  w.ph += (phTarget - w.ph) * 0.0004 * dt;
  game.detritus = Math.max(0, game.detritus - game.detritus * 0.0006 * dt);
  w.clarity = clamp(w.clarity - (game.detritus * 2e-5 + game.algae.bloom * 3e-4) * dt + (game.equip.filter ? 0.0012 : 0.0004) * dt, 0, 1);
  w.phosphate = clamp(w.phosphate + 2e-6 * mouths * dt - 1e-5 * dt, 0, 2);

  // ---------- 5. 藻类系统 ----------
  const a = game.algae;
  const no3f = clamp(w.no3 / 40, 0, 1.2);
  const herbEat = herbMouths * 0.00035;
  const comp = clamp(plantCompete * 0.0004, 0, 0.0008);
  // 绿藻：光照 + NO3 + 磷酸盐驱动，被草食生物啃食、被水草竞争
  a.green = clamp(a.green + (0.00042 * light * no3f * (1 + w.phosphate * 0.5) - herbEat - comp) * dt, 0, 1);
  // 褐藻：仅新缸期（硝化未成熟）出现，成熟后自行消退
  a.brown = clamp(a.brown + (game.bacteria < 0.35 ? 0.0005 : -0.0012) * dt, 0, 1);
  // 丝状藻：NO3 高时爆发，鱼不爱吃，降低美观
  a.filament = clamp(a.filament + (0.00055 * light * clamp((w.no3 - 22) / 22, 0, 1) - herbEat * 0.25 - comp) * dt, 0, 1);
  // 蓝绿藻：浑浊/高氮时出现，直接毒害鱼类
  a.bluegreen = clamp(a.bluegreen + ((w.clarity < 0.55 || w.no3 > 45 ? 0.00032 : -0.0004) * (1 - game.equip.filter * 0.5)) * dt, 0, 1);
  // 藻华事件：NO3 > 40 且强光 → 全缸绿水
  if (w.no3 > 40 && light > 0.6) {
    a.bloom = clamp(a.bloom + 0.00055 * dt, 0, 1);
    if (prev.bloom !== true && a.bloom > 0.3) {
      ev.push({ type: 'danger', msg: '⚠ 硝酸盐累积 + 强光，藻华爆发！全缸绿水，能见度骤降' });
      prev.bloom = true;
    }
  } else {
    a.bloom = clamp(a.bloom - 0.0004 * dt, 0, 1);
    if (a.bloom < 0.05) prev.bloom = false;
  }
  // 丝状藻蔓延警告
  if (a.filament > 0.5 && !prev.filaWarn) {
    ev.push({ type: 'warn', msg: '硝酸盐偏高，丝状藻开始蔓延，水草生长受阻' });
    prev.filaWarn = true;
  } else if (a.filament < 0.3) prev.filaWarn = false;
  if (a.bluegreen > 0.25 && !prev.bgWarn) {
    ev.push({ type: 'danger', msg: '⚠ 蓝绿藻出现！覆盖处释放毒素，请手动清除并换水' });
    prev.bgWarn = true;
  } else if (a.bluegreen < 0.1) prev.bgWarn = false;

  // ---------- 6. 鱼的生理状态 ----------
  const tf = 1 + Math.abs(w.temp - 25) * 0.09;
  const toxin = Math.max(0, w.nh3 - WATER_CFG.nh3.safe) * 0.8
    + Math.max(0, w.no2 - WATER_CFG.no2.safe) * 0.6
    + Math.max(0, w.no3 - 60) * 0.02
    + a.bluegreen * 0.25
    + (w.do < WATER_CFG.do.danger ? (WATER_CFG.do.danger - w.do) * 0.35 : 0)
    + (game.equip.co2 && game.equip.co2Rate > 1.5 ? 0.15 : 0);
  const hideRelief = clamp((mods.hideout + plantHide) * 0.05, 0, 0.5);

  for (const f of game.creatures) {
    if (f.state === 'corpse') continue;
    // 年龄与成长
    f.age += dt / 1440;
    const grow = clamp(f.age / f.sp.growDays, 0, 1);
    f.scale = f.sp.babyScale + (1 - f.sp.babyScale) * (1 - Math.pow(1 - grow, 2));
    f.len = f.sp.adultLen * f.scale;
    // 饱食度（饥饿代谢：温度 × 活跃度 × 体型）
    const act = f.state === 'flee' || f.state === 'hunt' ? 1.7 : 1;
    f.satiety = clamp(f.satiety - f.sp.metabolism * 0.22 * tf * act * f.scale * dt, 0, 100);
    // 健康：毒素/饥饿扣血，吃饱且水质好缓慢恢复
    let dh = 0;
    if (f.satiety <= 0) dh -= 0.09;
    dh -= toxin * 0.05;
    if (f.stress > 70) dh -= 0.01;
    if (f.satiety > 55 && toxin < 0.05) dh += 0.02;
    f.health = clamp(f.health + dh * dt, 0, 100);
    // 压力：拥挤 / 被追 / 水质 / 无躲避 → 上升；有水草沉木 → 下降
    let ds = 0.004 + (overload ? 0.012 : 0) + toxin * 0.01 + (f.stress > 60 ? 0.01 : 0);
    if (f.chased) ds += 0.02;
    ds -= hideRelief * 0.006;
    if (f.satiety < 15) ds += 0.008;
    f.stress = clamp(f.stress + ds * dt - 0.002 * dt, 0, 100);
    f.chased = false;
    // 饥饿行为标记（AI 使用）
    f.starving = f.satiety < 5;
    f.gasping = w.do < WATER_CFG.do.danger;
    // 死亡判定
    if (f.health <= 0 && f.state !== 'dying') {
      f.state = 'dying';
      f.dieT = 0;
      ev.push({ type: 'death', msg: `${f.sp.name} 死亡了……尸体在缸内会持续释放氨氮，请尽快捞出` });
      game.stats.died++;
    }
  }

  // ---------- 7. 食物腐败与底床污染 ----------
  for (let i = game.food.length - 1; i >= 0; i--) {
    const fd = game.food[i];
    fd.age += dt;
    if (fd.surface && fd.age > 90) fd.surface = false; // 薄片泡软下沉
    if (!fd.surface) fd.y = Math.max(0.06 + 0.02, fd.y - 0.012 * dt);
    if (fd.age > 170 || fd.y <= 0.08) { // 沉底过久 → 腐败
      game.detritus += fd.pollution * 0.5;
      w.clarity = clamp(w.clarity - 0.004 * fd.pollution, 0, 1);
      game.food.splice(i, 1);
    }
  }

  // ---------- 8. 产卵孵化倒计时 ----------
  for (let i = game.eggs.length - 1; i >= 0; i--) {
    const e = game.eggs[i];
    e.timer -= dt;
    if (e.timer <= 0) {
      game.eggs.splice(i, 1);
      ev.push({ type: 'birth', species: e.species, count: e.count, msg: `${SPECIES_DB[e.species].name} 诞生了（${e.count} 条幼体，快藏进水草！）` });
      game.stats.born += e.count;
      // 幼体由 main/creatures 依事件生成（保证模块边界清晰）
      game._pendingFry = game._pendingFry || [];
      for (let k = 0; k < e.count; k++) {
        game._pendingFry.push({ species: e.species, x: e.x + rand(-0.2, 0.2), y: e.y, z: e.z + rand(-0.2, 0.2) });
      }
    }
  }

  // ---------- 9. 氨氮预警（教学重点：可被仪表盘观测的因果链） ----------
  if (w.nh3 > WATER_CFG.nh3.danger && !prev.nh3Warn) {
    ev.push({ type: 'danger', msg: '⚠ 氨氮超标！鱼开始中毒，检查残饵/尸体并换水' });
    prev.nh3Warn = true;
  } else if (w.nh3 < WATER_CFG.nh3.warn) prev.nh3Warn = false;
  if (w.no2 > WATER_CFG.no2.warn && !prev.no2Warn) {
    ev.push({ type: 'warn', msg: '⚠ 亚硝酸盐升高，硝化系统可能不足' });
    prev.no2Warn = true;
  } else if (w.no2 < WATER_CFG.no2.safe) prev.no2Warn = false;
  if (overload && !prev.ovlWarn) {
    ev.push({ type: 'warn', msg: '生物量超出缸体容量！鱼类压力将持续上升' });
    prev.ovlWarn = true;
  } else if (!overload) prev.ovlWarn = false;

  return ev;
}

// ---------- 换水 30%：降 NO3/氨/浑浊，pH 与温度小幅波动，鱼受轻冲击 ----------
export function waterChange(game) {
  const w = game.water;
  w.nh3 *= 0.7; w.no2 *= 0.7; w.no3 *= 0.7;
  w.clarity = clamp(w.clarity + 0.35, 0, 1);
  w.ph = clamp(w.ph + rand(-0.12, 0.12), 5.5, 8.5);
  w.temp = clamp(w.temp + rand(-0.6, 0.6), 18, 32);
  game.detritus *= 0.6;
  game.algae.bloom *= 0.7;
  for (const f of game.creatures) {
    if (f.state !== 'corpse') { f.health -= 1.2; f.stress += 4; }
  }
  game.stats.waterChanges++;
  return [{ type: 'ok', msg: '换水 30% 完成：NO₃ 与浑浊度显著下降（换水过快有小冲击）' }];
}

// ---------- 投喂 ----------
export function feedFood(game, type, x, z) {
  const def = ITEM_DB[type];
  if (!def) return;
  const surf = def.effects.surface;
  for (let i = 0; i < 8; i++) {
    game.food.push({
      type, x: x + rand(-0.35, 0.35), z: z + rand(-0.25, 0.25),
      // 浮性饲料贴着水面但不高于鱼的可达深度（否则鱼永远吃不到）
      y: TANK_CFG.waterH - 0.14 - Math.random() * 0.05,
      surface: !!surf, age: 0,
      nutrition: def.effects.nutrition, pollution: def.effects.pollution,
    });
  }
  game.stats.feeds++;
}

// ---------- 每日评分 ----------
export function dailyScore(game) {
  // 美观度：造景多样性与稀有度
  let beauty = 0, types = new Set();
  for (const it of game.items || []) {
    const def = ITEM_DB[it.type];
    if (def && def.effects && def.effects.beauty) {
      beauty += def.effects.beauty * (1 + (def.rarity - 1) * 0.25);
      types.add(it.type);
    }
  }
  for (const p of game.plants) {
    const def = ITEM_DB[p.type];
    if (def && def.effects && def.effects.beauty) beauty += def.effects.beauty * p.biomass * 1.5;
  }
  beauty *= 1 - game.algae.filament * 0.4 - game.algae.bluegreen * 0.5 - game.algae.bloom * 0.3;
  beauty = clamp(beauty * 0.55 + types.size * 4, 0, 100);
  // 生态稳定度：水质健康天数占比
  const stability = clamp(game.totalDays ? (game.healthyDays / game.totalDays) * 100 : 60, 0, 100);
  // 生物多样性：物种数
  const sp = new Set(game.creatures.map((f) => f.sp.id));
  const bio = clamp(sp.size * 11 + Math.min(10, game.plants.length * 1.5), 0, 100);
  const comp = beauty * 0.4 + stability * 0.35 + bio * 0.25;
  const grade = comp >= 88 ? 'S' : comp >= 72 ? 'A' : comp >= 52 ? 'B' : 'C';
  return { beauty: Math.round(beauty), stability: Math.round(stability), biodiversity: Math.round(bio), composite: Math.round(comp), grade };
}

// ---------- 每日水质健康判定（供评分累计） ----------
export function waterAllSafe(game) {
  const w = game.water;
  return paramStatus('nh3', w.nh3) !== 'danger'
    && paramStatus('no2', w.no2) !== 'danger'
    && paramStatus('no3', w.no3) !== 'danger'
    && paramStatus('do', w.do) !== 'danger'
    && w.clarity > 0.4 && game.algae.bluegreen < 0.2;
}
