/* =============================================================================
 *  tools/sim.js —— 无画面的生态模拟（用来验证因果链 & 调节奏）
 *  ---------------------------------------------------------------------------
 *  用法（在项目根目录）：
 *      node tools/sim.js            跑默认 6000 步（约 25 分钟游戏时间）
 *      node tools/sim.js 20000      跑长一点
 *      node tools/sim.js 6000 12345 指定地形种子
 *
 *  它会在命令行里打印一条演化曲线：土壤、植物、森林度、水。
 *  改完 config.js 里的参数，跑一下这个，就能直接看到节奏变快还是变慢了。
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['config.js', 'utils.js', 'world.js', 'life.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), { filename: f });
}

const TICKS = parseInt(process.argv[2] || '6000', 10);
const SEED = parseInt(process.argv[3] || '20261014', 10);

const world = new World(SEED);
const unlocked = new Set();

// 固定「春天上午」，排除季节与昼夜的干扰，只看纯粹的土壤—植物因果链
const ctx = {
  dt: 1, season: 0, dayFrac: 0.40, dayInSeason: 1, seasonProgress: 0.33,
  isNight: false, isWinter: false, temp: 0.62, sunH: 0.95, rain: 0, fog: 0,
};

let nan = null;
const checkNaN = (tag) => {
  for (let i = 0; i < world.n; i++) {
    if (!isFinite(world.mois[i]) || !isFinite(world.nut[i])) { nan = tag + ' @' + i; return; }
  }
};

const avg = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; };
const maxOf = (arr) => { let m = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; };

/* ---- 一个「模拟玩家」：有什么放什么，优先放当前能放的最高级物种 ---- */
const ORDER = ['tree', 'shrub', 'flower', 'grass', 'moss', 'lichen'];
function playerAct() {
  // 真实玩家会先试最高级的，放不下就往下退一档
  for (const want of ORDER) {
    if (!unlocked.has(want)) continue;
    const si = SP_INDEX[want];
    // 随机看若干处，挑一个「看着还行」的地方放
    let best = -1, bestSuit = 0.06;
    for (let t = 0; t < 70; t++) {
      const i = (Math.random() * world.n) | 0;
      const gx = i % world.cols, gy = (i / world.cols) | 0;
      if (!world.canSow(gx, gy, want)) continue;
      const s = world.suitAt(si, i, 0);
      if (s > bestSuit) { bestSuit = s; best = i; }
    }
    if (best >= 0) { world.plant(best % world.cols, (best / world.cols) | 0, want); return; }
  }
}

console.log('');
console.log('  tick    时间    水平均  水最高  养平均  养最高  植物   成熟   森林度   水位   水');
console.log('  ' + '-'.repeat(84));

const t0 = Date.now();
let placed = 0;

for (let t = 1; t <= TICKS; t++) {
  // 模拟玩家：前期放得勤，后期慢下来（真实玩家大概也是这样）
  if (t % (t < 400 ? 12 : (t < 1500 ? 40 : 120)) === 0) { playerAct(); placed++; }

  world.tick(ctx);

  if (t % 20 === 0) {
    const newly = Life.checkUnlocks(world, unlocked);
    if (newly.length) console.log(`  ▶ 解锁：${newly.map(s => s.name).join('、')}（第 ${t} 步，约 ${(t / 4 / 60).toFixed(1)} 分钟）`);
  }

  if (t % 400 === 0 || t === 1) {
    const mins = (t / CFG.TIME.ticksPerSecond / 60).toFixed(1);
    const mAvg = avg(world.mois), mMax = maxOf(world.mois);
    const nAvg = avg(world.nut), nMax = maxOf(world.nut);
    let mature = 0;
    for (const p of world.plants) if (p.mat >= 0.6) mature++;
    const wetCells = world.wet.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0);
    console.log(
      `  ${String(t).padStart(5)}  ${String(mins).padStart(5)}分` +
      `  ${mAvg.toFixed(3).padStart(6)}  ${mMax.toFixed(3).padStart(6)}` +
      `  ${nAvg.toFixed(3).padStart(6)}  ${nMax.toFixed(3).padStart(6)}` +
      `  ${String(world.plants.length).padStart(5)}  ${String(mature).padStart(5)}` +
      `  ${world.forestness.toFixed(3).padStart(7)}  ${world.waterTable.toFixed(3).padStart(6)}  ${String(wetCells).padStart(4)}`
    );
  }
  checkNaN('tick ' + t);
  if (nan) break;
}

const ms = Date.now() - t0;

console.log('');
console.log(`  跑完 ${TICKS} 步用了 ${ms} ms（约 ${(ms / TICKS).toFixed(2)} ms/步；游戏里每秒 ${CFG.TIME.ticksPerSecond} 步）`);
console.log(nan ? `  ✗ 出现非法数值：${nan}` : '  ✓ 数值正常');

// ---- 最终各物种清点 ----
console.log('');
console.log('  最终清点：');
for (const sp of CFG.SPECIES) {
  const c = world.count(sp.id), m = world.matureCount(sp.id);
  if (c > 0) {
    console.log(`    ${sp.name.padEnd(4, '　')}  ${String(c).padStart(5)} 株（成熟 ${String(m).padStart(5)}）${sp.plantable ? '' : '   ← 自己长出来的'}`);
  }
}
console.log('');
console.log(`  玩家一共放了 ${placed} 次；最后地里共有 ${world.plants.length} 株。`);
console.log('');
