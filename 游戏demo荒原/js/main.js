/* =============================================================================
 *  main.js —— 主循环、时间、以及把上面这些东西串起来
 *  ---------------------------------------------------------------------------
 *  这里管三件事：
 *    1. 时间怎么走（一天多长、一季多长、存档多久一次）
 *    2. 玩家放下一颗种子之后会发生什么（其实什么都不会立刻发生，要等）
 *    3. 什么时候该对玩家说一句话（尽量少说）
 * ========================================================================== */

const Game = {

  world: null,
  unlocked: new Set(),
  flags: {},              // 说过的话、发生过的事，记在这里，不再重复
  acc: 0,                 // 累积的模拟步
  last: 0,
  running: false,
  fastForward: false,     // 离线快进中：不播声音、不生成动物
  seed: 0,

  time: {
    tick: 0, dayFrac: CFG.TIME.startDayFraction,
    season: CFG.TIME.startSeason, dayInSeason: CFG.TIME.startDayInSeason, seasonProgress: 0,
  },

  /* ======================================================================= */
  init() {
    this.canvas = document.getElementById('stage');
    Render.init(this.canvas);
    UI.init(this);

    // 试图读档；读不到就重新开始一片荒原
    const saved = Storage.load();
    if (saved) {
      this.world = saved.world;
      this.unlocked = saved.unlocked;
      this.seed = saved.world.seed;
      this.time.dayFrac = saved.ctx.dayFrac;
      this.time.season = saved.ctx.season;
      this.time.dayInSeason = saved.ctx.dayInSeason;
      this.time.tick = saved.world.tickCount;
      this.applyCam(saved.cam);

      // 关掉的这段时间里，它还在长
      const elapsed = (Date.now() - saved.savedAt) / 1000;
      const ticks = Math.min(elapsed * CFG.TIME.ticksPerSecond, CFG.SAVE.offlineMaxTicks);
      if (ticks > 40) {
        this.catchUp(ticks);
        this.pendingToast = CFG.TEXT.offline;
      }
    } else {
      this.seed = (Math.random() * 0xffffffff) >>> 0;
      this.world = new World(this.seed);
      this.centerCam();
    }

    // 让「自己长出来的东西」能跟玩家说一句
    Life.onWildSpawn = (sp, i, isNew) => {
      if (this.fastForward) return;
      const key = 'wild_' + sp.id;
      if (isNew && !this.flags[key]) {
        this.flags[key] = true;
        const t = CFG.TEXT.firstWild[sp.id];
        if (t) UI.toast(t, 5200);
      }
    };
    Animals.onSound = (kind) => {
      if (this.fastForward) return;
      if (kind === 'bird' && !this.flags.bird) {
        this.flags.bird = true;
        UI.toast(CFG.TEXT.bird, 5200);
      } else if (kind === 'deer' && !this.flags.deer) {
        this.flags.deer = true;
        UI.toast(CFG.TEXT.deer, 4800);
      }
      Sound.animal(kind);
    };

    UI.refresh(this.unlocked, null);
    window.addEventListener('resize', () => Render.resize());

    // 离开之前存一下
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });

    // 开始的门：浏览器要求先有一次交互才能出声
    UI.el.btnBegin.addEventListener('click', () => {
      UI.el.gate.classList.add('gone');
      setTimeout(() => { UI.el.gate.style.display = 'none'; }, 1200);
      Sound.resume();
      this.running = true;
      if (!saved) UI.showHint();
      if (this.pendingToast) {
        setTimeout(() => UI.toast(this.pendingToast, 5200), 900);
        this.pendingToast = null;
      }
    });

    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  },

  /* =======================================================================
   *  相机
   * ===================================================================== */
  centerCam() {
    const W = CFG.WORLD, YS = CFG.RENDER.ySquash;
    Cam.x = W.cols * W.cell * 0.5;
    Cam.y = W.rows * W.cell * YS * 0.5;
    // 让整片地大致铺满屏幕
    const z = Math.min(Cam.vw * 0.94 / (W.cols * W.cell),
                       Cam.vh * 0.94 / (W.rows * W.cell * YS));
    Cam.zoom = U.clamp(z, CFG.RENDER.camera.minZoom, CFG.RENDER.camera.maxZoom);
  },
  applyCam(c) {
    if (!c || !isFinite(c.x)) { this.centerCam(); return; }
    Cam.x = c.x; Cam.y = c.y;
    Cam.zoom = U.clamp(c.zoom || 1, CFG.RENDER.camera.minZoom, CFG.RENDER.camera.maxZoom);
  },

  /* =======================================================================
   *  时间上下文：每一 tick 交给世界的东西
   * ===================================================================== */
  buildCtx(dt) {
    const T = CFG.TIME;
    const df = this.time.dayFrac;
    const sunH = Math.sin((df - 0.25) * Math.PI * 2);
    const isNight = sunH < -0.05;
    const isWinter = this.time.season === 3;
    const temp = T.seasonTemp[this.time.season] * U.clamp(0.55 + 0.45 * (sunH + 1), 0.55, 1);

    // 「冬意」：0 = 夏天，1 = 深冬。用环形距离算，所以季节之间是连续过渡的。
    // 画面的飘雪、地面的积雪都用同一个值 —— 这样「天上在飘」和「地上积起来」
    // 永远一致，也不会在春天刚开头就莫名其妙地下雪。
    // （seasonProgress 现算现用，避免它和 dayInSeason 不同步）
    // clamp 是保险：万一 dayInSeason 因为改参数/读旧档变成超范围的值，
    // 季节色会做出一条谁也没设计的颜色（整片地突然发橙），钳住就没事。
    const seasonProgress = U.clamp(this.time.dayInSeason / T.daysPerSeason, 0, 1);
    const pos = this.time.season + seasonProgress;   // 0..4，一年里的位置
    let dw = Math.abs(pos - 3.5);                    // 离「冬天的正中」多远
    dw = Math.min(dw, 4 - dw);                       // 绕环取最近
    const winterness = U.clamp(1 - dw / 0.85, 0, 1);

    return {
      dt,
      season: this.time.season,
      dayFrac: df,
      dayInSeason: this.time.dayInSeason,
      seasonProgress,
      isNight, isWinter, temp,
      winterness,
      sunH,
      rain: U.clamp((this.world.rainMul - 1) / 1.2, 0, 1),
      fog: 0,
    };
  },

  /** 时间往前走一步 */
  advance(dt) {
    const T = CFG.TIME;
    this.time.dayFrac += dt / T.ticksPerDay;
    while (this.time.dayFrac >= 1) {
      this.time.dayFrac -= 1;
      this.time.dayInSeason++;
      if (this.time.dayInSeason >= T.daysPerSeason) {
        this.time.dayInSeason = 0;
        this.time.season = (this.time.season + 1) % 4;
      }
    }
    this.time.seasonProgress = this.time.dayInSeason / T.daysPerSeason;
    this.time.tick += dt;
  },

  /* =======================================================================
   *  一个模拟步
   * ===================================================================== */
  tick() {
    this.advance(1);
    const ctx = this.buildCtx(1);
    const sprouted = this.world.tick(ctx);

    // 有东西活过来了 → 极轻的一声
    if (!this.fastForward && sprouted && sprouted.length) {
      for (const p of sprouted) {
        const gx = p.gx / this.world.cols;
        Sound.sprout(gx);
      }
    }

    // 水第一次出现
    if (!this.fastForward && this.world.hasWater && !this.flags.water) {
      this.flags.water = true;
      UI.toast(CFG.TEXT.water, 5600);
      Sound.water();
    }

    // 动物
    if (!this.fastForward && this.world.tickCount % CFG.FAUNA.checkEveryTicks === 0) {
      Animals.trySpawn(this.world, ctx);
    }

    // 解锁：地够好了，手边就会多出一样东西
    if (this.world.tickCount % 20 === 0) {
      const newly = Life.checkUnlocks(this.world, this.unlocked);
      if (newly.length) {
        UI.refresh(this.unlocked, newly.map(s => s.id));
        if (!this.fastForward) {
          for (const sp of newly) UI.toast(CFG.TEXT.unlock(sp.name), 4800);
        }
      }
    }

    // 存档
    if (this.world.tickCount % CFG.SAVE.autoSaveEveryTicks === 0) this.save();
  },

  /* =======================================================================
   *  离线快进：把没在的时间补回来
   * ===================================================================== */
  catchUp(ticks) {
    this.fastForward = true;
    const steps = CFG.SAVE.offlineSteps;
    const dt = ticks / steps;
    for (let i = 0; i < steps; i++) {
      this.advance(dt);
      this.world.tick(this.buildCtx(dt));
    }
    this.fastForward = false;
    Animals.reset();
    // 补一趟解锁检查（离线的时候可能已经够格了）
    const newly = Life.checkUnlocks(this.world, this.unlocked);
    if (newly.length) UI.refresh(this.unlocked, newly.map(s => s.id));
  },

  /* =======================================================================
   *  玩家唯一会做的动作：放下一样东西
   * ===================================================================== */
  place(gx, gy) {
    if (!this.running || !this.world) return;
    const sp = UI.selected;
    if (!sp) return;
    if (!this.world.canPlaceAt(gx, gy)) return;

    this.world.plant(gx, gy, sp.id);

    // 放下之后不会有声音。等它真的活过来了，才会有极轻的一声。
    if (!this.flags.firstPlaced) {
      this.flags.firstPlaced = true;
      setTimeout(() => UI.hideHint(), 1400);
    }
    this.savePending = true;
  },

  askReset() {
    if (window.confirm('换一片荒原，重新开始？\n现在这一片会消失。')) {
      // 必须先立个牌子，否则刷新时的 beforeunload 会「好心地」把旧世界又存回去，
      // 于是清档等于没清 —— 点完重开还是原来那片地。
      this.resetting = true;
      Storage.clear();
      location.reload();
    }
  },

  save() {
    if (this.resetting || !this.world) return;
    Storage.save(this.world, { dayFrac: this.time.dayFrac, season: this.time.season, dayInSeason: this.time.dayInSeason },
                 this.unlocked, { firstPlaced: !!this.flags.firstPlaced });
  },

  /* =======================================================================
   *  主循环
   * ===================================================================== */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));

    let dtSec = (now - this.last) / 1000;
    this.last = now;
    if (dtSec > 0.25) dtSec = 0.25;      // 切后台回来别一次跑几百步

    if (this.running) {
      this.acc += dtSec * CFG.TIME.ticksPerSecond;
      let guard = 0;
      while (this.acc >= 1 && guard < 8) { this.acc -= 1; this.tick(); guard++; }
      if (this.acc > 8) this.acc = 8;

      if (this.savePending) { this.savePending = false; this.save(); }
    }

    const ctx = this.buildCtx(1);
    Render.frame(dtSec, this.world, ctx, UI);
    Animals.update(dtSec, this.world);
    Sound.update(this.world, Render.wind);
    UI.update(dtSec);
    UI.setClock(this.time.season, this.time.dayFrac);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
