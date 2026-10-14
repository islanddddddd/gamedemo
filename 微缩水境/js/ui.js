// ============================================================
// ui.js —— 原神风 UI：顶部栏 / 图鉴商店 / 生态仪表盘 / 底部操作
//         事件日志 / 信息浮窗 / 卷轴教程 / 设置 / 评分庆祝
// 配色：米金 #F3E5C0 / 青蓝 #4A9FD8 / 暗金 #D4A24C / 深底玻璃拟态
// ============================================================

import { SPECIES_DB, ITEM_DB, RARITY, SHOP_TABS, WATER_CFG } from './db.js';
import { paramStatus } from './sim.js';

const $ = (sel) => document.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const stars = (n) => '★'.repeat(n);

export class UI {
  constructor(game, hooks) {
    this.game = game;
    this.hooks = hooks;
    this.tab = 'fish';
    this.tutorialPage = 0;
    this.build();
  }

  // ============================================================
  //  构建 DOM
  // ============================================================
  build() {
    const root = $('#ui-root');
    root.innerHTML = `
      <!-- 顶部栏 -->
      <header class="topbar panel">
        <div class="logo">微缩水境<span>· Aquascape ·</span></div>
        <div class="top-mid">
          <div class="pill eco-pill">◆ <b class="eco-num">0</b> 生态点</div>
          <div class="pill score-pill">综合评分 <b class="grade">C</b>
            <div class="score-track"><i class="score-fill"></i></div></div>
          <div class="pill clock-pill"><b class="day">第 1 天</b><span class="time">12:00</span><span class="phase">白天</span></div>
        </div>
        <div class="top-right">
          <button class="icon-btn btn-mute" title="静音">🔊</button>
          <button class="icon-btn btn-settings" title="设置">⚙</button>
        </div>
      </header>

      <!-- 左侧：图鉴商店 -->
      <aside class="shop panel">
        <div class="panel-title"><i></i>图鉴 · 商店<i></i></div>
        <div class="tabs"></div>
        <div class="cards"></div>
      </aside>

      <!-- 右侧：生态仪表盘 -->
      <aside class="dash panel">
        <div class="panel-title"><i></i>生态仪表盘<i></i></div>
        <div class="wbars"></div>
        <div class="stats"></div>
        <div class="equip-title">设备控制</div>
        <div class="equip-rows"></div>
        <div class="radar-wrap">
          <canvas id="radar" width="200" height="160"></canvas>
          <div class="radar-cap">生态平衡雷达</div>
        </div>
      </aside>

      <!-- 底部：时间控制 + 快捷操作 -->
      <footer class="bottombar panel">
        <div class="time-ctrl">
          <button class="speed-btn" data-speed="0" title="暂停">⏸</button>
          <button class="speed-btn on" data-speed="1">1x</button>
          <button class="speed-btn" data-speed="2">2x</button>
          <button class="speed-btn" data-speed="5">5x</button>
        </div>
        <div class="quick">
          <button class="qbtn" id="q-water" title="换水 30%">💧 换水</button>
          <button class="qbtn" id="q-net" title="捞网工具">🥄 捞网</button>
          <button class="qbtn" id="q-feed" title="投喂薄片饲料">🍥 喂食</button>
          <button class="qbtn" id="q-view" title="切换机位">🎥 视角</button>
        </div>
        <div class="hint" id="hint">点击左侧卡片购买，再点击缸内水面投放</div>
      </footer>

      <!-- 事件日志 -->
      <div id="log"></div>

      <!-- 生物/物件信息浮窗 -->
      <div id="info-pop" class="panel hidden"></div>

      <!-- 卷轴新手教程 -->
      <div id="tutorial" class="overlay hidden">
        <div class="scroll">
          <div class="scroll-cap top"></div>
          <div class="scroll-body">
            <div class="scroll-page"></div>
            <div class="scroll-nav">
              <button class="sbtn" id="tut-prev">上一页</button>
              <div class="dots"></div>
              <button class="sbtn primary" id="tut-next">下一页</button>
            </div>
            <button class="scroll-close" id="tut-close">✕ 关闭</button>
          </div>
          <div class="scroll-cap bottom"></div>
        </div>
      </div>

      <!-- 设置 -->
      <div id="settings" class="overlay hidden">
        <div class="modal panel">
          <div class="panel-title"><i></i>设置<i></i></div>
          <div class="set-row"><label>主音量</label><input type="range" id="vol-master" min="0" max="1" step="0.05"><span class="set-val" id="vol-master-v"></span></div>
          <div class="set-row"><label>BGM</label><input type="range" id="vol-bgm" min="0" max="1" step="0.05"><span class="set-val" id="vol-bgm-v"></span></div>
          <div class="set-row"><label>音效</label><input type="range" id="vol-sfx" min="0" max="1" step="0.05"><span class="set-val" id="vol-sfx-v"></span></div>
          <div class="set-row"><label>低配降级<br><small>关闭辉光/焦散/景深</small></label><button class="toggle" id="set-lowspec">关</button></div>
          <div class="set-row"><label>重看教程</label><button class="sbtn" id="set-tutorial">卷轴</button></div>
          <div class="set-row danger"><label>重置鱼缸<br><small>清空存档，重新养水</small></label><button class="sbtn danger" id="set-reset">重置</button></div>
          <button class="sbtn primary wide" id="set-close">完成</button>
        </div>
      </div>

      <!-- 评分庆祝 -->
      <div id="celebrate" class="overlay hidden">
        <div class="celebrate-content">
          <div class="celebrate-rays"></div>
          <div class="celebrate-grade">S</div>
          <div class="celebrate-text">生态评级提升！</div>
          <div class="celebrate-sub"></div>
        </div>
      </div>

      <!-- 轻提示 -->
      <div id="toast"></div>
    `;

    // 缓存引用
    this.el = {
      ecoNum: $('.eco-num'), grade: $('.grade'), scoreFill: $('.score-fill'),
      day: $('.day'), time: $('.time'), phase: $('.phase'),
      tabs: $('.tabs'), cards: $('.cards'), wbars: $('.wbars'),
      stats: $('.stats'), equipRows: $('.equip-rows'), radar: $('#radar'),
      hint: $('#hint'), log: $('#log'), infoPop: $('#info-pop'),
      tutorial: $('#tutorial'), settings: $('#settings'), celebrate: $('#celebrate'),
      toast: $('#toast'), mute: $('.btn-mute'),
    };

    this.buildTabs();
    this.buildCards();
    this.buildWaterBars();
    this.buildEquipRows();
    this.bind();
    this.buildTutorialContent();
    this.updateTop();
    this.updateDash();
  }

  // ============================================================
  //  商店
  // ============================================================
  buildTabs() {
    this.el.tabs.innerHTML = SHOP_TABS.map((t) =>
      `<button class="tab ${t.id === this.tab ? 'on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('');
    this.el.tabs.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab;
        this.el.tabs.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
        this.buildCards();
        this.hooks.onUI();
      });
    });
  }

  buildCards() {
    const list = [];
    if (this.tab === 'fish' || this.tab === 'invert') {
      for (const id in SPECIES_DB) {
        if (SPECIES_DB[id].cat === this.tab) list.push({ kind: 'species', id });
      }
    } else {
      for (const id in ITEM_DB) {
        if (ITEM_DB[id].cat === this.tab) list.push({ kind: 'item', id });
      }
      // 底砂归入造景页
      if (this.tab === 'hardscape') {
        for (const id in ITEM_DB) {
          if (ITEM_DB[id].cat === 'substrate') list.push({ kind: 'item', id });
        }
      }
    }
    this.el.cards.innerHTML = list.map((e) => {
      const def = e.kind === 'species' ? SPECIES_DB[e.id] : ITEM_DB[e.id];
      const afford = this.game.eco >= def.price;
      return `
        <div class="card r${def.rarity} ${afford ? '' : 'poor'}" data-kind="${e.kind}" data-id="${e.id}">
          <div class="card-stars">${stars(def.rarity)}</div>
          <div class="card-name">${def.name}</div>
          <div class="card-desc">${def.desc}</div>
          <div class="card-foot"><span class="price">◆ ${def.price}</span>
            <span class="tag">${this.cardTag(e.kind, def)}</span></div>
        </div>`;
    }).join('');
    this.el.cards.querySelectorAll('.card').forEach((c) => {
      c.addEventListener('click', () => {
        this.hooks.onUI();
        this.hooks.onBuy(c.dataset.kind, c.dataset.id);
      });
    });
  }

  cardTag(kind, def) {
    if (kind === 'species') {
      const diet = { herbivore: '草食', omnivore: '杂食', carnivore: '肉食', detritivore: '碎屑' }[def.diet];
      const tags = [diet];
      if (def.schooling) tags.push('群游');
      if (def.hunter) tags.push('掠食');
      if (def.nocturnal) tags.push('夜行');
      return tags.join(' · ');
    }
    const catName = { hardscape: '造景', plant: '植物', food: '食物', equip: '设备', substrate: '底砂' }[def.cat];
    return catName;
  }

  refreshCards() {
    this.el.cards.querySelectorAll('.card').forEach((c) => {
      const def = c.dataset.kind === 'species' ? SPECIES_DB[c.dataset.id] : ITEM_DB[c.dataset.id];
      c.classList.toggle('poor', this.game.eco < def.price);
    });
  }

  // ============================================================
  //  仪表盘
  // ============================================================
  static WBAR = [
    { key: 'temp', name: '温度', fmt: (v) => v.toFixed(1), max: 32, min: 16 },
    { key: 'ph', name: 'pH', fmt: (v) => v.toFixed(2), max: 9, min: 5 },
    { key: 'nh3', name: '氨 NH₃', fmt: (v) => v.toFixed(2), max: 2 },
    { key: 'no2', name: '亚硝酸盐', fmt: (v) => v.toFixed(2), max: 2 },
    { key: 'no3', name: '硝酸盐', fmt: (v) => v.toFixed(0), max: 120 },
    { key: 'do', name: '溶氧 DO', fmt: (v) => v.toFixed(1), max: 12, min: 0 },
    { key: 'clarity', name: '清澈度', fmt: (v) => (v * 100).toFixed(0) + '%', max: 1, min: 0 },
  ];

  buildWaterBars() {
    this.el.wbars.innerHTML = UI.WBAR.map((w) => `
      <div class="wbar" data-key="${w.key}">
        <div class="wbar-label">${w.name}<span class="wbar-val">-</span></div>
        <div class="wbar-track"><i class="wbar-fill"></i></div>
      </div>`).join('');
  }

  buildEquipRows() {
    const rows = [
      { key: 'filter', name: '过滤器', type: 'switch' },
      { key: 'heater', name: '加热棒', type: 'switch', extra: { key: 'heaterTarget', label: '目标温度', min: 22, max: 28, step: 0.5, unit: '℃' } },
      { key: 'lamp', name: '灯具', type: 'switch', extra: { key: 'lampIntensity', label: '强度', min: 0.2, max: 1.2, step: 0.05 }, extra2: { key: 'lampTemp', label: '色温', min: 2700, max: 9000, step: 100, unit: 'K' } },
      { key: 'co2', name: 'CO₂', type: 'switch', extra: { key: 'co2Rate', label: '速率', min: 0.5, max: 2, step: 0.1 } },
      { key: 'pump', name: '气泵', type: 'switch' },
      { key: 'feeder', name: '自动喂食器', type: 'switch' },
    ];
    this.el.equipRows.innerHTML = rows.map((r) => `
      <div class="equip-row ${this.game.owned[r.key] ? '' : 'locked'}" data-key="${r.key}">
        <span class="equip-name">${r.name}</span>
        <button class="switch" data-key="${r.key}">${this.game.equip[r.key] ? '开' : '关'}</button>
        ${r.extra ? `<div class="equip-slider"><label>${r.extra.label}<b class="esv" id="esv-${r.extra.key}"></b></label>
          <input type="range" data-key="${r.extra.key}" min="${r.extra.min}" max="${r.extra.max}" step="${r.extra.step}" value="${this.game.equip[r.extra.key]}"></div>` : ''}
        ${r.extra2 ? `<div class="equip-slider"><label>${r.extra2.label}<b class="esv" id="esv-${r.extra2.key}"></b></label>
          <input type="range" data-key="${r.extra2.key}" min="${r.extra2.min}" max="${r.extra2.max}" step="${r.extra2.step}" value="${this.game.equip[r.extra2.key]}"></div>` : ''}
      </div>`).join('');
    this.el.equipRows.querySelectorAll('.switch').forEach((b) => {
      b.addEventListener('click', () => {
        this.hooks.onUI();
        this.hooks.onEquipToggle(b.dataset.key);
      });
    });
    this.el.equipRows.querySelectorAll('input[type=range]').forEach((r) => {
      r.addEventListener('input', () => {
        this.hooks.onEquipChange(r.dataset.key, parseFloat(r.value));
      });
    });
    this.refreshEquipRows();
  }

  refreshEquipRows() {
    this.el.equipRows.querySelectorAll('.equip-row').forEach((row) => {
      const k = row.dataset.key;
      row.classList.toggle('locked', !this.game.owned[k]);
      const sw = row.querySelector('.switch');
      if (sw) sw.textContent = this.game.equip[k] ? '开' : '关';
      row.querySelectorAll('input[type=range]').forEach((r) => {
        const v = this.game.equip[r.dataset.key];
        if (document.activeElement !== r) r.value = v;
        const lbl = row.querySelector(`#esv-${r.dataset.key}`);
        if (lbl) {
          const unit = r.dataset.key === 'lampTemp' ? 'K' : r.dataset.key === 'heaterTarget' ? '℃' : '';
          lbl.textContent = v + unit;
        }
      });
    });
  }

  updateDash() {
    const w = this.game.water;
    this.el.wbars.querySelectorAll('.wbar').forEach((bar) => {
      const key = bar.dataset.key;
      const def = UI.WBAR.find((x) => x.key === key);
      const v = w[key];
      const st = paramStatus(key, v);
      const pct = clamp((v - (def.min || 0)) / (def.max - (def.min || 0)) * 100, 2, 100);
      bar.querySelector('.wbar-val').textContent = def.fmt(v);
      const fill = bar.querySelector('.wbar-fill');
      fill.style.width = pct + '%';
      fill.className = 'wbar-fill ' + st;
    });
    // 生物统计
    const alive = this.game.creatures.filter((f) => f.state !== 'corpse');
    const spN = new Set(alive.map((f) => f.sp.id)).size;
    const a = this.game.algae;
    const alg = Math.round((a.green + a.brown + a.filament + a.bluegreen) * 25);
    this.el.stats.innerHTML = `
      <div class="stat"><b>${alive.length}</b><span>鱼口数量</span></div>
      <div class="stat"><b>${spN}</b><span>物种数</span></div>
      <div class="stat"><b>${alg}%</b><span>藻类覆盖</span></div>
      <div class="stat"><b>${Math.round(this.game.bacteria * 100)}%</b><span>硝化菌</span></div>`;
    this.drawRadar();
  }

  // 生态平衡雷达（Canvas 2D）
  drawRadar() {
    const cv = this.el.radar;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2 + 4, R = 52;
    ctx.clearRect(0, 0, W, H);
    const w = this.game.water;
    const score = (v, lo, hi) => clamp(1 - Math.abs(v - (lo + hi) / 2) / ((hi - lo) / 2), 0, 1);
    const axes = [
      { label: '温度', v: score(w.temp, 24, 26) * 0.6 + score(w.temp, 22, 28) * 0.4 },
      { label: 'pH', v: score(w.ph, 6.8, 7.2) * 0.6 + score(w.ph, 6.5, 7.5) * 0.4 },
      { label: '氨氮', v: clamp(1 - w.nh3 / 1.0, 0, 1) },
      { label: '溶氧', v: clamp(w.do / 8, 0, 1) },
      { label: '清澈', v: w.clarity },
      { label: '藻控', v: clamp(1 - (this.game.algae.green + this.game.algae.filament + this.game.algae.bluegreen + this.game.algae.bloom) / 2.5, 0, 1) },
    ];
    const n = axes.length;
    // 网格
    ctx.strokeStyle = 'rgba(212,162,76,0.35)';
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = (R * ring) / 3;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.stroke();
    }
    // 轴线 + 标签
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(243,229,192,0.85)';
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      ctx.fillText(axes[i].label, cx + Math.cos(a) * (R + 12), cy + Math.sin(a) * (R + 12) + 3);
    }
    // 数据多边形
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const a = (idx / n) * Math.PI * 2 - Math.PI / 2;
      const r = R * clamp(axes[idx].v, 0.04, 1);
      ctx[i === 0 ? 'moveTo' : 'lineTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(74,159,216,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#6FD3E8';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // ============================================================
  //  顶部 / 提示 / 日志
  // ============================================================
  updateTop() {
    this.el.ecoNum.textContent = Math.floor(this.game.eco);
    const s = this.game.score;
    this.el.grade.textContent = s.grade;
    this.el.grade.className = 'grade g' + s.grade;
    this.el.scoreFill.style.width = clamp(s.composite || 0, 0, 100) + '%';
    const h = Math.floor(this.game.minutes / 60);
    const m = Math.floor(this.game.minutes % 60);
    this.el.day.textContent = `第 ${this.game.day} 天`;
    this.el.time.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const night = h < 5.5 || h >= 20;
    this.el.phase.textContent = night ? '夜晚' : h < 9 ? '清晨' : h < 16 ? '白昼' : '黄昏';
    this.el.mute.textContent = this.game.settings.muted ? '🔇' : '🔊';
  }

  setHint(t) { this.el.hint.textContent = t; }

  log(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = 'log-item ' + type;
    div.innerHTML = `<i></i>${msg}`;
    this.el.log.prepend(div);
    while (this.el.log.children.length > 7) this.el.log.lastChild.remove();
    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 600);
    }, 9000);
  }

  toast(text, kind = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast-item ' + kind;
    t.textContent = text;
    this.el.toast.appendChild(t);
    setTimeout(() => t.classList.add('show'), 16);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 2200);
  }

  // ============================================================
  //  信息浮窗（原神风）
  // ============================================================
  showInfo(ent, sx, sy) {
    const pop = this.el.infoPop;
    let html = '';
    if (ent.sp) {
      // 生物
      const sp = ent.sp;
      const bar = (label, v, color) => `
        <div class="ibar"><span>${label}</span><div class="ibar-track"><i style="width:${clamp(v, 0, 100)}%;background:${color}"></i></div><b>${Math.round(v)}</b></div>`;
      const stateName = { idle: '闲游', forage: '觅食', flee: '逃窜', hunt: '捕猎', court: '求偶', dying: '垂死', corpse: '尸体' }[ent.state] || ent.state;
      html = `
        <div class="info-head r${sp.rarity}">
          <div class="info-name">${sp.name}</div>
          <div class="info-stars">${stars(sp.rarity)}</div>
        </div>
        <div class="info-state">状态：${stateName} · ${ent.baby ? '幼体' : ent.scale > 0.85 ? '成体' : '亚成体'} · 年龄 ${ent.age.toFixed(1)} 天</div>
        <div class="info-desc">${sp.desc}</div>
        <div class="info-bars">
          ${bar('饱食', ent.satiety, '#F3E5C0')}
          ${bar('健康', ent.health, '#5FBF7F')}
          ${bar('压力', ent.stress, '#FF7A5A')}
        </div>
        <div class="info-actions">
          <button class="ibtn" data-act="feed">投喂</button>
          <button class="ibtn" data-act="net">捞出</button>
          <button class="ibtn sell" data-act="sell">出售 ◆${sp.sell}</button>
        </div>`;
    } else {
      // 物件（造景/植物/设备）
      const def = ITEM_DB[ent.type];
      if (!def) return;
      const eff = def.effects || {};
      const effNames = {
        ph: 'pH', gh: 'GH 硬度', kh: 'KH', tannin: '单宁（水色泛黄）', hideout: '躲避点', beauty: '美观度',
        bacteriaSurface: '硝化菌附着面', no3Absorb: '吸收 NO₃', o2: '产氧', nightO2: '夜间耗氧',
        shade: '遮光抑藻', growth: '生长速度', nutrition: '营养', pollution: '污染', surface: '漂浮',
        clarity: '去浊', flow: '水流', glow: '自发光',
      };
      const effHtml = Object.keys(eff).filter((k) => effNames[k]).map((k) => {
        const v = eff[k];
        const sign = typeof v === 'number' && v !== 1 ? (v > 0 ? '+' : '') + v : '';
        return `<div class="eff"><span>${effNames[k]}</span><b>${sign || (k === 'surface' ? (v ? '是' : '否') : '—')}</b></div>`;
      }).join('');
      html = `
        <div class="info-head r${def.rarity}">
          <div class="info-name">${def.name}</div>
          <div class="info-stars">${stars(def.rarity)}</div>
        </div>
        <div class="info-desc">${def.desc}</div>
        <div class="effs">${effHtml}</div>
        <div class="info-actions">
          <button class="ibtn" data-act="net">移除</button>
        </div>`;
    }
    pop.innerHTML = html;
    pop.classList.remove('hidden');
    // 定位（避免溢出屏幕）
    const w = 260, h = pop.offsetHeight || 300;
    pop.style.left = clamp(sx + 14, 8, window.innerWidth - w - 8) + 'px';
    pop.style.top = clamp(sy - h / 2, 60, window.innerHeight - h - 80) + 'px';
    pop.querySelectorAll('.ibtn').forEach((b) => {
      b.addEventListener('click', () => {
        this.hooks.onUI();
        this.hooks.onEntityAction(b.dataset.act, ent);
        this.hideInfo();
      });
    });
  }

  hideInfo() { this.el.infoPop.classList.add('hidden'); }

  // ============================================================
  //  卷轴新手教程
  // ============================================================
  buildTutorialContent() {
    this.tutorialPages = [
      {
        title: '欢迎来到微缩水境',
        body: `
          <p>这是一座摆在书桌上的<b>鱼缸微缩景观</b>。你可以投放鱼虾、栽种水草、布置造景，
          看着一个完整的生态系统在你手中日夜运转。</p>
          <p><b>基础操作：</b><br>
          · 左侧<b>图鉴商店</b>选中心仪之物 → 点击缸内水面/缸底投放<br>
          · 点击任意生物或物件查看详情（投喂 / 捞出 / 出售）<br>
          · 拖动旋转视角，滚轮缩放；底部可切换机位与时间流速<br>
          · <b>空格</b>暂停，<b>1/2/5</b> 调速，<b>W</b> 换水，<b>N</b> 捞网</p>
          <p class="tip">💡 音乐会在你第一次点击后响起。</p>`,
      },
      {
        title: '氮循环：新缸的灵魂',
        body: `
          <p>鱼的排泄与残饵会产生<b>氨（NH₃）</b>——对鱼有毒。<b>硝化菌</b>会把氨依次转化为
          亚硝酸盐（NO₂⁻）与硝酸盐（NO₃⁻），后者再由水草吸收或换水移除。</p>
          <p><b>养水期：</b>新缸的硝化菌群需要约 <b>2 天</b>才能成熟。前期直接投鱼容易氨中毒死亡——
          先放火山石/陶粒/开过滤器加速培菌，几天后再请鱼入住。</p>
          <p class="tip">💡 仪表盘的「硝化菌」进度到 60% 以上才算安全。</p>`,
      },
      {
        title: '喂食的艺术',
        body: `
          <p>每条鱼都有独立的<b>饱食度</b>，随代谢下降；<b>饱食度归零会快速掉健康并死亡</b>，
          尸体在缸内会持续释放大量氨氮，引发连锁崩缸——<b>尸体必须捞出！</b></p>
          <p><b>切勿过量投喂：</b>吃剩的饲料沉底腐败 → 推高氨氮、降低清澈度，
          → 鱼中毒 → 死亡 → 更多氨……形成死亡螺旋。每次少量，1 分钟内吃完为宜。</p>
          <p class="tip">💡 密度过高时鱼类压力上升，注意「生物量」提示。</p>`,
      },
      {
        title: '藻类与生态平衡',
        body: `
          <p>藻类是把双刃剑：适量<b>绿藻</b>是草食鱼和虾螺的美食；但 <b>NO₃ 过高 + 强光</b>
          会引发<b>藻华</b>（全缸绿水，夜间溶氧暴跌），<b>蓝绿藻</b>更是直接毒害鱼类。</p>
          <p>控制手段：换水降 NO₃、缩短光照、放养清道夫/虾/螺啃藻、种植水草竞争营养。</p>
          <p><b>昼夜循环：</b>一天 24 分钟。白天水草产氧、鱼群活跃；夜晚转耗氧，
          溶氧下降（考验气泵），BGM 也会切换为夜晚变奏。</p>
          <p class="tip">💡 试着养出一缸 S 级评分的微缩水境吧！</p>`,
      },
    ];
    const dots = this.el.tutorial.querySelector('.dots');
    dots.innerHTML = this.tutorialPages.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
  }

  openTutorial(page = 0) {
    this.tutorialPage = page;
    this.renderTutorialPage();
    this.el.tutorial.classList.remove('hidden');
  }
  closeTutorial() { this.el.tutorial.classList.add('hidden'); }

  renderTutorialPage() {
    const p = this.tutorialPages[this.tutorialPage];
    const page = this.el.tutorial.querySelector('.scroll-page');
    page.style.opacity = 0;
    setTimeout(() => {
      page.innerHTML = `<h2>${p.title}</h2>${p.body}`;
      page.style.opacity = 1;
    }, 180);
    this.el.tutorial.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i === this.tutorialPage));
    const prev = $('#tut-prev'), next = $('#tut-next');
    prev.disabled = this.tutorialPage === 0;
    next.textContent = this.tutorialPage === this.tutorialPages.length - 1 ? '开始养鱼 ✓' : '下一页';
  }

  // ============================================================
  //  评分庆祝
  // ============================================================
  celebrate(grade, sub) {
    const c = this.el.celebrate;
    c.querySelector('.celebrate-grade').textContent = grade;
    c.querySelector('.celebrate-grade').className = 'celebrate-grade g' + grade;
    c.querySelector('.celebrate-sub').textContent = sub || '';
    c.classList.remove('hidden');
    // 上升粒子
    const rays = c.querySelector('.celebrate-rays');
    rays.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('i');
      p.style.left = 10 + Math.random() * 80 + '%';
      p.style.animationDelay = Math.random() * 0.8 + 's';
      p.style.animationDuration = 1.2 + Math.random() * 1.2 + 's';
      rays.appendChild(p);
    }
    setTimeout(() => c.classList.add('hidden'), 2600);
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  bind() {
    // 时间控制
    document.querySelectorAll('.speed-btn').forEach((b) => {
      b.addEventListener('click', () => {
        this.hooks.onUI();
        document.querySelectorAll('.speed-btn').forEach((x) => x.classList.toggle('on', x === b));
        this.hooks.onSpeed(parseInt(b.dataset.speed));
      });
    });
    // 快捷操作
    $('#q-water').addEventListener('click', () => { this.hooks.onUI(); this.hooks.onWaterChange(); });
    $('#q-net').addEventListener('click', () => { this.hooks.onUI(); this.hooks.onTool('net'); });
    $('#q-feed').addEventListener('click', () => { this.hooks.onUI(); this.hooks.onFeed(); });
    $('#q-view').addEventListener('click', () => { this.hooks.onUI(); this.hooks.onResetView(); });
    // 静音 / 设置
    this.el.mute.addEventListener('click', () => { this.hooks.onUI(); this.hooks.onMute(); });
    $('.btn-settings').addEventListener('click', () => { this.hooks.onUI(); this.openSettings(); });
    // 教程翻页
    $('#tut-prev').addEventListener('click', () => {
      this.hooks.onUI();
      if (this.tutorialPage > 0) { this.tutorialPage--; this.renderTutorialPage(); }
    });
    $('#tut-next').addEventListener('click', () => {
      this.hooks.onUI();
      if (this.tutorialPage < this.tutorialPages.length - 1) {
        this.tutorialPage++; this.renderTutorialPage();
      } else this.closeTutorial();
    });
    $('#tut-close').addEventListener('click', () => { this.hooks.onUI(); this.closeTutorial(); });
    // 设置
    $('#set-close').addEventListener('click', () => { this.hooks.onUI(); this.closeSettings(); });
    $('#set-tutorial').addEventListener('click', () => { this.hooks.onUI(); this.closeSettings(); this.openTutorial(0); });
    $('#set-reset').addEventListener('click', () => { this.hooks.onUI(); this.hooks.onReset(); });
    const vol = (id, key) => {
      const r = $(id);
      r.value = this.game.settings[key === 'master' ? 'masterVol' : key + 'Vol'];
      $(id + '-v').textContent = Math.round(r.value * 100) + '%';
      r.addEventListener('input', () => {
        $(id + '-v').textContent = Math.round(r.value * 100) + '%';
        this.hooks.onVolume(key, parseFloat(r.value));
      });
    };
    vol('#vol-master', 'master');
    vol('#vol-bgm', 'bgm');
    vol('#vol-sfx', 'sfx');
    $('#set-lowspec').addEventListener('click', () => {
      this.hooks.onUI();
      this.hooks.onLowSpec();
      $('#set-lowspec').textContent = this.game.settings.lowSpec ? '开' : '关';
    });
    $('#set-lowspec').textContent = this.game.settings.lowSpec ? '开' : '关';
  }

  openSettings() {
    $('#vol-master').value = this.game.settings.masterVol;
    $('#vol-bgm').value = this.game.settings.bgmVol;
    $('#vol-sfx').value = this.game.settings.sfxVol;
    this.el.settings.classList.remove('hidden');
  }
  closeSettings() { this.el.settings.classList.add('hidden'); }
}
