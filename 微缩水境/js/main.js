// ============================================================
// main.js —— 初始化 / 交互 / 主循环 / 存档
// 1 秒 = 1 游戏分钟（1x），一天 24 分钟；支持暂停 / 1x / 2x / 5x。
// ============================================================

import * as THREE from 'three';
import { SPECIES_DB, ITEM_DB, START_ECO, TANK_CFG } from './db.js';
import { AudioEngine } from './audio.js';
import * as sim from './sim.js';
import { CreatureManager, bindCreatureCallbacks } from './creatures.js';
import { PlantManager } from './plants.js';
import { SceneManager } from './scene.js';
import { UI } from './ui.js';

const SAVE_KEY = 'aquascape_save_v1';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- 全局游戏状态 ----------
const game = {
  minutes: 8 * 60, day: 1, speed: 1, paused: false,
  water: sim.createWater(),
  equip: {
    filter: false, heater: false, heaterTarget: 25,
    lamp: true, lampTemp: 6500, lampIntensity: 0.8,
    co2: false, co2Rate: 1, pump: false, feeder: false, feederTimer: 0,
  },
  owned: {},
  bacteria: 0.02,
  creatures: [], plants: [], food: [], eggs: [], items: [],
  detritus: 0,
  algae: { green: 0, brown: 0.15, filament: 0, bluegreen: 0, bloom: 0 },
  eco: START_ECO,
  score: { composite: 0, grade: 'C' },
  healthyDays: 0, totalDays: 0,
  stats: { born: 0, died: 0, sold: 0, waterChanges: 0, feeds: 0 },
  settings: { lowSpec: false, masterVol: 0.8, bgmVol: 0.55, sfxVol: 0.9, muted: false },
  selected: null, placement: null, tool: null,
  _pendingFry: [],
  _prev: {},
};

let scene, creatures, plants, ui, audio;
let _nightF = 0, _uiT = 0, _audioT = 0, _saveT = 0, _viewIdx = 0;
const VIEW_ORDER = ['overview', 'macro', 'top'];

// ============================================================
//  初始化
// ============================================================
function init() {
  audio = new AudioEngine();
  scene = new SceneManager(document.getElementById('scene'), game);
  creatures = new CreatureManager(scene.scene, game);
  plants = new PlantManager(scene.scene, game);

  bindCreatureCallbacks(creatures, {
    onBubble: (x, y, z) => scene.addBubble(x, y, z),
    onEat: () => { if (Math.random() < 0.5) audio.eat(); },
  });

  ui = new UI(game, {
    onUI: () => audio.ui(),
    onBuy,
    onTool,
    onSpeed: setSpeed,
    onWaterChange: doWaterChange,
    onFeed: doFeed,
    onResetView,
    onReset,
    onEntityAction,
    onEquipToggle,
    onEquipChange,
    onMute,
    onVolume,
    onLowSpec,
  });

  // 首次交互启动 AudioContext（浏览器自动播放限制）
  const kick = () => {
    audio.init();
    audio.setVolumes(game.settings.masterVol, game.settings.bgmVol, game.settings.sfxVol);
    audio.setMuted(game.settings.muted);
    document.removeEventListener('pointerdown', kick);
  };
  document.addEventListener('pointerdown', kick);

  // 调试入口（控制台可用：__AQUA.game / .scene / .renderer 等）
  window.__AQUA = { game, scene, creatures, plants, ui, audio, sim };

  bindInput();
  loadSave();

  if (game.settings.lowSpec) scene.setLowSpec(true);
  scene.setLamp(game.equip.lampTemp, game.equip.lampIntensity);

  // 预热：预编译鱼体着色器与场景全部材质，避免首次绘制/首次投鱼的卡顿与“首帧不显示”
  try {
    const ghost = creatures.warmUp();
    scene.renderer.compile(scene.scene, scene.camera);
    creatures.group.remove(ghost);
  } catch (err) { console.warn('[Aquascape] 预热着色器失败（不影响运行）', err); }

  const clock = new THREE.Clock();
  requestAnimationFrame(function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
    tick(dt, elapsed);
  });
}

// ============================================================
//  主循环
// ============================================================
function tick(dt, elapsed) {
  let gdt = 0;
  if (!game.paused && game.speed > 0) {
    gdt = dt * game.speed; // 游戏分钟
    game.minutes += gdt;

    // 昼夜过渡（平滑）
    const wantNight = sim.isNight(game) ? 1 : 0;
    _nightF += (wantNight - _nightF) * Math.min(1, dt * 0.8);
    scene.setNightFactor(_nightF);
    game._nightF = _nightF;

    // 生态模拟推进
    const evs = sim.tick(game, gdt);
    handleEvents(evs);
    spawnPendingFry();

    // 自动喂食器
    if (game.owned.feeder && game.equip.feeder) {
      game.equip.feederTimer += gdt;
      if (game.equip.feederTimer > 480) {
        game.equip.feederTimer = 0;
        sim.feedFood(game, 'flake', rand(-1.5, 1.5), rand(-0.8, 0.8));
        ui.log('自动喂食器投喂了一份薄片饲料', 'info');
      }
    }

    // 天数推进与每日评分
    if (game.minutes >= 1440) {
      game.minutes -= 1440;
      game.day++;
      dailyTick();
    }

    // BGM 动态分层（生态健康度 / 昼夜 / 危险）
    _audioT -= dt;
    if (_audioT <= 0) {
      _audioT = 4;
      audio.setEcoHealth(sim.ecoHealth(game));
      const h = sim.ecoHealth(game);
      audio.setMode(_nightF > 0.5 ? 'night' : h < 0.35 ? 'danger' : 'day');
    }

    // 自动保存
    _saveT += dt;
    if (_saveT > 15) { _saveT = 0; saveGame(); }
  }

  creatures.update(gdt, elapsed);
  creatures.refreshEggs();
  plants.update(gdt, elapsed, game);
  creatures._nightF = _nightF; // 供荧光鱼夜间 emissive 使用
  scene.update(dt, elapsed, game);
  scene.render();

  // 环境光供植物生长使用
  game._light = clamp(0.5 * (1 - _nightF) + (game.equip.lamp ? game.equip.lampIntensity : 0), 0, 1.2);

  _uiT += dt;
  if (_uiT > 0.25) {
    _uiT = 0;
    ui.updateTop();
    ui.updateDash();
  }
}

// ---------- 模拟事件 → UI / 音频 ----------
function handleEvents(evs) {
  for (const ev of evs) {
    switch (ev.type) {
      case 'death': ui.log(ev.msg, 'danger'); audio.death(); break;
      case 'birth':
        ui.log(ev.msg, 'birth');
        audio.select();
        game.eco += 5;
        break;
      case 'danger': ui.log(ev.msg, 'danger'); audio.warn(); break;
      case 'warn': ui.log(ev.msg, 'warn'); audio.warn(); break;
      case 'ok': ui.log(ev.msg, 'ok'); break;
    }
  }
}

// ---------- 幼鱼孵化 ----------
function spawnPendingFry() {
  if (!game._pendingFry.length) return;
  for (const f of game._pendingFry) {
    if (game.creatures.length >= 60) break;
    creatures.spawn(f.species, f.x, f.y, f.z, { baby: true, satiety: 70 });
  }
  game._pendingFry.length = 0;
}

// ---------- 每日结算 ----------
function dailyTick() {
  game.totalDays++;
  if (sim.waterAllSafe(game)) game.healthyDays++;
  const s = sim.dailyScore(game);
  const order = ['C', 'B', 'A', 'S'];
  const old = game.score.grade;
  game.score = s;
  if (order.indexOf(s.grade) > order.indexOf(old)) {
    ui.celebrate(s.grade, `美观 ${s.beauty} · 稳定 ${s.stability} · 多样 ${s.biodiversity}`);
    audio.achieve();
    game.eco += 120;
    ui.log(`生态评级提升至 ${s.grade} 级！获得 ◆120 生态点`, 'ok');
  }
  ui.log(`第 ${game.day - 1} 天结束：综合评分 ${s.grade}（${s.composite}）`, 'info');
  saveGame();
}

// ============================================================
//  交互
// ============================================================
function bindInput() {
  const canvas = document.getElementById('scene');
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved < 6) handleClick(e);
  });
  // 点击水面始终有涟漪反馈
  canvas.addEventListener('pointerdown', (e) => {
    const p = scene.pickWater(e.clientX, e.clientY);
    if (p) scene.addRipple(p.x, p.z, 0.5);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        setSpeed(game.paused ? game.speed || 1 : 0);
        break;
      case 'Digit1': setSpeed(1); break;
      case 'Digit2': setSpeed(2); break;
      case 'Digit5': setSpeed(5); break;
      case 'KeyW': doWaterChange(); break;
      case 'KeyF': doFeed(); break;
      case 'KeyN': onTool('net'); break;
      case 'KeyR': onResetView(); break;
      case 'KeyT': ui.openTutorial(0); break;
      case 'Escape':
        game.placement = null; game.tool = null;
        ui.hideInfo();
        scene.setSelection([]);
        ui.setHint('已取消当前操作');
        break;
    }
  });
  window.addEventListener('beforeunload', saveGame);
}

function handleClick(e) {
  audio.resume();
  // 1) 投放模式
  if (game.placement) {
    const p = scene.pickWater(e.clientX, e.clientY);
    if (!p) { ui.setHint('请点击缸内水面投放'); return; }
    placeItem(game.placement.kind, game.placement.id, p);
    return;
  }
  // 2) 拾取生物 / 物件
  const hit = pick(e);
  if (game.tool === 'net') {
    if (hit) netEntity(hit);
    return;
  }
  if (hit) {
    selectEntity(hit, e.clientX, e.clientY);
  } else {
    game.selected = null;
    scene.setSelection([]);
    ui.hideInfo();
  }
}

function pick(e) {
  const ndc = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, scene.camera);
  const targets = [creatures.group, plants.group];
  for (const it of game.items) if (it.mesh) targets.push(it.mesh);
  const hits = ray.intersectObjects(targets, true);
  for (const h of hits) {
    // 藻类贴片
    if (h.object.userData.algae) {
      return { algae: true, instanceId: h.instanceId };
    }
    let o = h.object;
    while (o) {
      if (o.userData.fish) return { fish: o.userData.fish };
      if (o.userData.plant) return { plant: o.userData.plant };
      if (o.userData.item) return { item: o.userData.item };
      if (o.userData.equip) return { equip: o.userData.equip };
      o = o.parent;
    }
  }
  return null;
}

// ---------- 选中信息 ----------
// OutlinePass 需要 Mesh 对象：从 Group 中取第一个网格子对象
function firstMesh(obj) {
  if (!obj) return null;
  if (obj.isMesh) return obj;
  let found = null;
  obj.traverse((o) => { if (!found && o.isMesh) found = o; });
  return found;
}

function selectEntity(hit, sx, sy) {
  if (hit.fish) {
    const f = hit.fish;
    game.selected = f;
    scene.setSelection([firstMesh(f.mesh)]);
    ui.showInfo(f, sx, sy);
    audio.select();
  } else if (hit.plant) {
    const p = hit.plant;
    scene.setSelection([firstMesh(p.mesh)]);
    ui.showInfo({ type: p.type, plantRef: p }, sx, sy);
  } else if (hit.item) {
    const it = hit.item;
    const item = game.items.find((x) => x.type === it.type && x.x === it.x && x.z === it.z) || { type: it.type };
    scene.setSelection([it.mesh || null].filter(Boolean));
    ui.showInfo({ type: it.type, itemRef: item }, sx, sy);
  } else if (hit.equip) {
    ui.showInfo({ type: hit.equip.type }, sx, sy);
  }
}

// ---------- 投放 ----------
function placeItem(kind, id, p) {
  const def = kind === 'species' ? SPECIES_DB[id] : ITEM_DB[id];
  audio.splash();
  scene.splash(p.x, TANK_CFG.waterH - 0.02, p.z);
  if (kind === 'species') {
    if (game.creatures.length >= 60) { ui.toast('生物数量已达上限（60）', 'warn'); return; }
    // 购入的是「亚成体」：年龄取成长周期的一部分，仍会继续长大（幼鱼由繁殖孵化产生）
    const f = creatures.spawn(id, p.x, TANK_CFG.waterH - 0.25, p.z, {
      satiety: 75,
      age: def.growDays * 0.45,
    });
    if (f) {
      f.state = 'flee'; f.panicT = 6; // 入水后短暂惊慌
      ui.log(`${def.name} 入水了，惊得四处逃窜`, 'birth');
      ui.toast(`${def.name} +1`, 'ok');
      // 生物量超载提示
      let load = 0;
      for (const c of game.creatures) load += c.sp.bioload * (0.3 + 0.7 * c.scale);
      if (load > TANK_CFG.capacity) ui.toast('⚠ 生物量已超缸体容量！', 'warn');
    }
  } else if (def.cat === 'hardscape') {
    const mesh = scene.addHardscape(id, p.x, p.z);
    const item = { type: id, x: p.x, z: p.z, mesh };
    game.items.push(item);
    ui.toast(`${def.name} 已沉底`, 'ok');
  } else if (def.cat === 'substrate') {
    scene.setSubstrateColor(def.substrateColor);
    game.items.push({ type: id, x: p.x, z: p.z, mesh: null });
    ui.toast(`底砂更换为${def.name}`, 'ok');
  } else if (def.cat === 'plant') {
    plants.spawn(id, p.x, p.z);
    ui.toast(`${def.name} 已栽种`, 'ok');
  } else if (def.cat === 'food') {
    sim.feedFood(game, id, p.x, p.z);
    ui.toast(`投喂了${def.name}`, 'ok');
    audio.eat();
  } else if (def.cat === 'equip') {
    if (game.owned[id]) { ui.toast('该设备已安置', 'warn'); return; }
    scene.addEquipment(id);
    game.owned[id] = true;
    game.equip[id] = id !== 'co2'; // CO2 默认关
    scene.setLamp(game.equip.lampTemp, game.equip.lampIntensity);
    ui.refreshEquipRows();
    ui.toast(`${def.name} 已安装`, 'ok');
    audio.place();
  }
  game.placement = null;
  ui.refreshCards();
  ui.setHint('点击左侧卡片继续选购，或点击生物查看详情');
}

// ---------- 捞网 ----------
function netEntity(hit) {
  if (hit.fish) {
    const f = hit.fish;
    if (f.state === 'corpse') {
      creatures.remove(f);
      ui.log('尸体已打捞，避免了一场氨氮危机', 'ok');
      audio.place();
    } else {
      game.eco += f.sp.sell;
      game.stats.sold++;
      creatures.remove(f);
      ui.toast(`${f.sp.name} 已出售 ◆${f.sp.sell}`, 'ok');
      audio.coin();
    }
  } else if (hit.algae) {
    if (plants.pickAlgae(hit.instanceId)) {
      audio.place();
      ui.toast('清除了一小片藻类', 'ok');
    }
  } else if (hit.plant) {
    plants.removePlant(hit.plant);
    ui.toast('移除了一株水草', 'ok');
    audio.place();
  } else if (hit.item) {
    const it = hit.item;
    const idx = game.items.findIndex((x) => x.type === it.type && x.x === it.x && x.z === it.z);
    if (idx >= 0) {
      const [removed] = game.items.splice(idx, 1);
      if (removed.mesh) {
        scene.scene.remove(removed.mesh);
        removed.mesh.traverse((o) => { if (o.isMesh && o.material.dispose) o.material.dispose(); });
      }
      ui.toast(`已移除${ITEM_DB[it.type].name}`, 'ok');
      audio.place();
    }
  }
}

// ---------- 信息浮窗操作 ----------
function onEntityAction(act, ent) {
  if (ent.sp) {
    const f = ent;
    if (act === 'feed') {
      sim.feedFood(game, 'flake', f.pos.x, f.pos.z);
      ui.toast(`向 ${f.sp.name} 投喂`, 'ok');
      audio.eat();
    } else if (act === 'net') {
      if (f.state === 'corpse') { netEntity({ fish: f }); }
      else { game.eco += f.sp.sell; game.stats.sold++; creatures.remove(f); audio.coin(); }
    } else if (act === 'sell') {
      game.eco += f.sp.sell;
      game.stats.sold++;
      creatures.remove(f);
      ui.toast(`出售 ${f.sp.name} ◆${f.sp.sell}`, 'ok');
      audio.coin();
    }
  } else if (ent.type) {
    if (act === 'net') {
      if (ent.plantRef) { plants.removePlant(ent.plantRef); audio.place(); }
      else if (ent.itemRef) { netEntity({ item: { type: ent.type, x: ent.itemRef.x, z: ent.itemRef.z } }); }
      else ui.toast('设备已安置，无需移除', 'info');
    }
  }
  ui.refreshCards();
}

// ============================================================
//  购买 / 工具 / 时间 / 快捷操作
// ============================================================
function onBuy(kind, id) {
  const def = kind === 'species' ? SPECIES_DB[id] : ITEM_DB[id];
  if (!def) return;
  if (game.eco < def.price) { ui.toast('生态点不足', 'warn'); audio.warn(); return; }
  if (def.cat === 'equip' && game.owned[id]) { ui.toast('该设备已安置', 'warn'); return; }
  if (def.cat === 'substrate') {
    game.eco -= def.price;
    placeItem('item', id, { x: 0, z: 0 });
    return;
  }
  if (def.cat === 'food') {
    game.eco -= def.price;
    placeItem('item', id, { x: rand(-1.5, 1.5), z: rand(-0.8, 0.8) });
    return;
  }
  game.eco -= def.price;
  game.placement = { kind, id };
  ui.refreshCards();
  ui.setHint(`已选购「${def.name}」→ 点击缸内${kind === 'species' ? '水面' : '位置'}投放（Esc 取消）`);
  ui.toast(`选购 ${def.name}`, 'ok');
}

function onTool(tool) {
  if (game.tool === tool) {
    game.tool = null;
    ui.setHint('捞网已收起');
  } else {
    game.placement = null;
    game.tool = tool;
    ui.setHint('捞网已就绪：点击鱼/尸体/藻类/造景将其捞出');
  }
  document.getElementById('q-net').classList.toggle('on', !!game.tool);
}

function setSpeed(n) {
  game.speed = n;
  game.paused = n === 0;
  document.querySelectorAll('.speed-btn').forEach((b) => {
    b.classList.toggle('on', parseInt(b.dataset.speed) === n);
  });
  ui.setHint(n === 0 ? '已暂停' : `时间流速 ${n}x`);
}

function doWaterChange() {
  const evs = sim.waterChange(game);
  handleEvents(evs);
  audio.water();
}

function doFeed() {
  sim.feedFood(game, 'flake', rand(-1.2, 1.2), rand(-0.6, 0.6));
  audio.eat();
  ui.toast('投喂了薄片饲料', 'ok');
}

function onResetView() {
  _viewIdx = (_viewIdx + 1) % VIEW_ORDER.length;
  scene.moveCameraTo(VIEW_ORDER[_viewIdx]);
  ui.setHint('机位：' + { overview: '全景', macro: '微距特写', top: '俯视造景' }[VIEW_ORDER[_viewIdx]]);
}

function onMute() {
  game.settings.muted = !game.settings.muted;
  audio.setMuted(game.settings.muted);
  ui.updateTop();
}

function onVolume(key, v) {
  if (key === 'master') game.settings.masterVol = v;
  if (key === 'bgm') game.settings.bgmVol = v;
  if (key === 'sfx') game.settings.sfxVol = v;
  audio.setVolumes(game.settings.masterVol, game.settings.bgmVol, game.settings.sfxVol);
}

function onEquipToggle(key) {
  game.equip[key] = !game.equip[key];
  audio.ui();
  scene.setLamp(game.equip.lampTemp, game.equip.lampIntensity);
  ui.refreshEquipRows();
}

function onEquipChange(key, val) {
  game.equip[key] = val;
  scene.setLamp(game.equip.lampTemp, game.equip.lampIntensity);
  ui.refreshEquipRows();
}

function onLowSpec() {
  game.settings.lowSpec = !game.settings.lowSpec;
  scene.setLowSpec(game.settings.lowSpec);
  ui.toast(game.settings.lowSpec ? '低配降级已开启' : '画质已恢复', 'ok');
}

function onReset() {
  if (!confirm('确定要重置鱼缸吗？所有进度将清空。')) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// ============================================================
//  存档（localStorage）
// ============================================================
function saveGame() {
  try {
    const data = {
      v: 1, day: game.day, minutes: game.minutes, water: game.water,
      equip: game.equip, owned: game.owned, bacteria: game.bacteria,
      eco: game.eco, score: game.score, healthyDays: game.healthyDays,
      totalDays: game.totalDays, stats: game.stats, settings: game.settings,
      algae: game.algae, detritus: game.detritus,
      items: game.items.map((i) => ({ type: i.type, x: i.x, z: i.z })),
      plants: game.plants.map((p) => ({ type: p.type, x: p.x, z: p.z, biomass: p.biomass })),
      creatures: game.creatures.map((f) => ({
        id: f.speciesId, x: f.pos.x, y: f.pos.y, z: f.pos.z,
        satiety: f.satiety, health: f.health, stress: f.stress,
        age: f.age, scale: f.scale, corpse: f.state === 'corpse',
      })),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) { /* 隐私模式等场景忽略 */ }
}

function loadSave() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* 忽略 */ }
  if (!data || !data.v) {
    // 新档：打开卷轴教程
    ui.openTutorial(0);
    ui.log('欢迎来到微缩水境！先看完教程再请鱼入住', 'info');
    return;
  }
  // 恢复状态
  game.day = data.day || 1;
  game.minutes = data.minutes ?? 480;
  Object.assign(game.water, data.water || {});
  Object.assign(game.equip, data.equip || {});
  game.owned = data.owned || {};
  game.bacteria = data.bacteria ?? 0.02;
  game.eco = data.eco ?? START_ECO;
  game.score = data.score || { composite: 0, grade: 'C' };
  game.healthyDays = data.healthyDays || 0;
  game.totalDays = data.totalDays || 0;
  game.stats = Object.assign(game.stats, data.stats || {});
  game.settings = Object.assign(game.settings, data.settings || {});
  Object.assign(game.algae, data.algae || {});
  game.detritus = data.detritus || 0;
  // 恢复物件
  for (const it of data.items || []) {
    if (ITEM_DB[it.type] && ITEM_DB[it.type].cat === 'substrate') {
      scene.setSubstrateColor(ITEM_DB[it.type].substrateColor);
    } else {
      const mesh = scene.addHardscape(it.type, it.x, it.z);
      game.items.push({ type: it.type, x: it.x, z: it.z, mesh });
    }
  }
  for (const eq of Object.keys(game.owned)) {
    if (game.owned[eq]) scene.addEquipment(eq);
  }
  for (const p of data.plants || []) {
    const np = plants.spawn(p.type, p.x, p.z);
    if (np) np.biomass = p.biomass || 0.3;
  }
  for (const f of data.creatures || []) {
    const sp = SPECIES_DB[f.id];
    if (!sp) continue;
    // 由存档中的体型反推年龄，保证恢复后的尺寸与存档一致；
    // 同时设下限（≥0.42 成长周期），避免旧存档里的小鱼恢复后一直长不大。
    const t = Math.max(0, Math.min(1, ((f.scale ?? 0.8) - sp.babyScale) / (1 - sp.babyScale)));
    const grow = Math.max(0.42, 1 - Math.sqrt(Math.max(0, 1 - t)));
    creatures.spawn(f.id, f.x, f.y, f.z, {
      satiety: f.satiety, health: f.health, stress: f.stress, age: grow * sp.growDays,
    });
  }
  scene.setLamp(game.equip.lampTemp, game.equip.lampIntensity);
  ui.refreshEquipRows();
  ui.refreshCards();
  ui.log('存档已读取，欢迎回到你的微缩水境', 'ok');
}

// ---------- 启动 ----------
init();

// 供 index.html 判断模块是否成功启动（用于移除启动屏 / 显示错误指引）
export const bootOk = true;
