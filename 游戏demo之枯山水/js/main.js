/* =========================================================================
 * main.js —— 把一切粘起来（UI / 输入 / 保存）
 *
 * 玩法（和老版本一致，但手感因为真 3D 完全不同）：
 *   · 鼠标移到屏幕底边 → 物件栏浮出 → 点一个 → 点砂面放下去
 *   · 在砂上划一下 = 耙纹（有沙沙声）
 *   · 拖物件 = 挪位置，纹路实时跟着变
 *   · 在物件上滚轮 = 转朝向（最重要的旋钮）
 *   · 右键物件 = 拿走
 *   · 右上角几个淡字：推平 / 声 / 光 / 缘 / 庭院 / 参数
 *   · 快捷键：P 参数  M 静音  S 留下来  Esc 放下手里的
 * ========================================================================= */
(function () {
  'use strict';

  const S = KS.Scene;

  function err(msg) {
    const el = document.getElementById('glerr');
    if (el) { el.textContent = msg; el.classList.add('show'); }
    console.error(msg);
  }
  window.addEventListener('error', function (e) { err('运行出错：' + (e.message || e.error)); });

  /* ── 点是否落在院子里（射线法）── */
  function inGarden(g) {
    const poly = S.garden.polygon; let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if (((zi > g.z) !== (zj > g.z)) && (g.x < (xj - xi) * (g.z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ── 状态 ── */
  let tool = null;            // 当前拿着的工具：物件 kind / 'rake' / null
  let dragObj = null, dragMoved = false;
  let raking = false, lastRake = null;
  let lastInteract = performance.now();
  let savebarOn = false;
  const LIGHT_MODES = ['drift', 'still', 'day'];
  const BORDER_TYPES = ['wood', 'moss', 'bamboo'];

  function touch() { lastInteract = performance.now(); }
  function toast(t) {
    const el = document.getElementById('toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ── 物件栏 ── */
  function buildPalette() {
    const pal = document.getElementById('palette');
    pal.innerHTML = '';
    pal.addEventListener('mouseenter', function () { clearTimeout(pal._t); });
    pal.addEventListener('mouseleave', function () { pal._t = setTimeout(function () { pal.classList.remove('show'); }, 1400); });
    const order = ['stoneL', 'stoneM', 'stoneS', 'basin', 'moss', 'bamboo', 'pine', 'rake'];
    for (const k of order) {
      const it = KS.Obj.ITEMS[k];
      const b = document.createElement('button');
      b.className = 'pbtn'; b.dataset.kind = k;
      b.textContent = (k === 'rake' ? '耙纹' : it.label);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        arm(k === tool ? null : k);
      });
      pal.appendChild(b);
    }
  }
  function arm(k) {
    tool = k;
    document.querySelectorAll('#palette .pbtn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.kind === k);
    });
    if (!k) S.setCursor(0, 0, 0, 0, false);
    touch();
  }

  /* ── 输入 ── */
  function bindInput() {
    const cv = document.getElementById('stage');

    cv.addEventListener('pointerdown', function (e) {
      KS.Audio.unlock(); touch();
      const g = S.screenToGround(e.clientX, e.clientY);
      const hit = S.pickObject(e.clientX, e.clientY);
      if (hit) { dragObj = hit; dragMoved = false; cv.setPointerCapture(e.pointerId); return; }
      if (!g) return;
      if (tool === 'rake') {
        raking = true; lastRake = g; KS.Audio.rakeStart(); cv.setPointerCapture(e.pointerId); return;
      }
      if (tool && tool !== 'rake') {
        if (inGarden(g)) {
          const o = KS.Obj.make(tool, g.x, g.z, { seed: (Math.random() * 1e6) | 0 });
          if (o.kind === 'stone' || o.kind === 'moss') o.angle = Math.random() * Math.PI;
          S.addObject(o);
          KS.Audio.thud(o.kind === 'stone' ? o.a / 2 : 0.6);
          touch();
        }
        return;
      }
    });

    cv.addEventListener('pointermove', function (e) {
      const px = (e.clientX / window.innerWidth) * 2 - 1;
      const py = (e.clientY / window.innerHeight) * 2 - 1;
      S.setParallax(px, py);
      // 靠近底边 → 物件栏浮出
      const pal = document.getElementById('palette');
      if (e.clientY > window.innerHeight - 140) {
        pal.classList.add('show');
        clearTimeout(pal._t);
        pal._t = setTimeout(function () { pal.classList.remove('show'); }, 3200);
      }
      const g = S.screenToGround(e.clientX, e.clientY);
      if (dragObj) {
        if (g) { S.moveObject(dragObj, g.x, g.z); dragMoved = true; }
        return;
      }
      if (raking) {
        if (g && lastRake) {
          S.paintRake(lastRake.x, lastRake.z, g.x, g.z);
          const sp = Math.hypot(g.x - lastRake.x, g.z - lastRake.z) / Math.max(0.008, 0.016);
          KS.Audio.rakeMove(sp * 0.02);
          lastRake = g;
        }
        return;
      }
      // 悬浮预览圈
      if (tool && tool !== 'rake') {
        const it = KS.Obj.ITEMS[tool];
        if (g && inGarden(g)) S.setCursor(g.x, g.z, it.a, it.b, true);
        else S.setCursor(0, 0, 0, 0, false);
      } else S.setCursor(0, 0, 0, 0, false);
    });

    function endPointer() {
      if (dragObj) dragObj = null;
      if (raking) { raking = false; lastRake = null; KS.Audio.rakeEnd(); }
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', endPointer);

    cv.addEventListener('wheel', function (e) {
      const hit = S.pickObject(e.clientX, e.clientY);
      if (hit && (hit.kind === 'stone' || hit.kind === 'moss')) {
        S.rotateObject(hit, Math.sign(e.deltaY) * 0.16);
        touch(); e.preventDefault();
      }
    }, { passive: false });

    cv.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      const hit = S.pickObject(e.clientX, e.clientY);
      if (hit) { S.removeObject(hit); touch(); }
    });

    // 键盘
    window.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'p') { togglePanel(); }
      else if (k === 'm') { toggleSound(); }
      else if (k === 's') { showSavebar(); }
      else if (k === 'escape') { arm(null); }
    });
  }

  /* ── 右上角 ── */
  function bindCorner() {
    const corner = document.getElementById('corner');
    corner.addEventListener('click', function (e) {
      const act = e.target.dataset.act; if (!act) return;
      touch();
      if (act === 'flat') { S.clearObjects(); S.clearRake(); toast('已推平，随时重来'); }
      else if (act === 'sound') { toggleSound(); }
      else if (act === 'light') {
        const i = (LIGHT_MODES.indexOf(KS.P.light.mode) + 1) % LIGHT_MODES.length;
        KS.P.light.mode = LIGHT_MODES[i]; toast('光 · ' + ({ still: '静', drift: '缓移', day: '一天' })[KS.P.light.mode]);
      }
      else if (act === 'border') {
        const i = (BORDER_TYPES.indexOf(KS.P.garden.border) + 1) % BORDER_TYPES.length;
        S.setBorder(BORDER_TYPES[i]); toast('缘 · ' + ({ wood: '木', moss: '苔', bamboo: '竹' })[KS.P.garden.border]);
      }
      else if (act === 'gardens') { openGallery(); }
      else if (act === 'params') { togglePanel(); }
    });
  }
  function toggleSound() {
    KS.Audio.unlock();
    const on = !KS.Audio.isOn();
    KS.Audio.setOn(on);
    document.querySelectorAll('#corner button').forEach(function (b) {
      if (b.dataset.act === 'sound') b.textContent = on ? '声' : '静';
    });
    toast(on ? '声 · 开' : '声 · 关');
  }

  /* ── 参数面板 ── */
  function buildPanel() {
    const panel = document.getElementById('panel');
    panel.innerHTML = '<div class="ptitle">参数（实时）</div>';
    for (const sp of KS.PARAM_SPEC) {
      const [grp, path, name, mn, mx, step] = sp;
      const row = document.createElement('div'); row.className = 'prow';
      const lab = document.createElement('span'); lab.className = 'plab'; lab.textContent = name;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = mn; inp.max = mx; inp.step = step;
      inp.value = KS.getP(path);
      const val = document.createElement('span'); val.className = 'pval'; val.textContent = (+inp.value).toFixed(2);
      inp.addEventListener('input', function () {
        KS.setP(path, parseFloat(inp.value));
        val.textContent = (+inp.value).toFixed(2);
        if (path.indexOf('sand.') === 0 || path.indexOf('field.') === 0) {
          S.sand.syncParams(); S.regenFlow(false);
        } else if (path.indexOf('style.') === 0) {
          S.syncStyle();          // 色块反差：只重写顶点色，不重建几何 → 可以实时拖
        }
      });
      row.appendChild(lab); row.appendChild(inp); row.appendChild(val);
      panel.appendChild(row);
    }
  }
  function togglePanel() {
    const panel = document.getElementById('panel');
    panel.classList.toggle('show');
  }

  /* ── 保存 / 画廊 ── */
  const KEY = 'ks_gardens_v1';
  function loadStore() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function saveStore(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }

  function showSavebar() {
    const bar = document.getElementById('savebar');
    bar.classList.add('show'); savebarOn = true;
    setTimeout(function () { const i = document.getElementById('nameInput'); if (i) i.focus(); }, 50);
  }
  function bindSavebar() {
    const bar = document.getElementById('savebar');
    bar.addEventListener('click', function (e) {
      const act = e.target.dataset.act; if (!act) return;
      if (act === 'save') {
        const name = (document.getElementById('nameInput').value || '无题').trim();
        const data = {
          name: name, shape: S.garden.shape, border: KS.P.garden.border,
          objs: S.objs.map(function (o) { return { kind: o.kind, x: o.x, z: o.z, angle: o.angle, seed: o.seed }; }),
          thumb: S.renderer.domElement.toDataURL('image/jpeg', 0.55),
        };
        const a = loadStore(); a.unshift(data); saveStore(a.slice(0, 24));
        bar.classList.remove('show'); savebarOn = false;
        toast('已留下 · ' + name);
      } else if (act === 'later') {
        bar.classList.remove('show'); savebarOn = false;
      }
    });
  }

  function openGallery() {
    const gal = document.getElementById('gallery');
    const inner = document.getElementById('gInner');
    const a = loadStore();
    inner.innerHTML = '';
    if (!a.length) {
      const tip = document.createElement('div'); tip.className = 'gtip'; tip.textContent = '还没有留下的庭院。摆几块石头，静置一会儿，它会轻轻问你。';
      inner.appendChild(tip);
    }
    a.forEach(function (d, idx) {
      const tile = document.createElement('div'); tile.className = 'gtile';
      const img = document.createElement('img'); img.src = d.thumb || ''; img.alt = d.name;
      const cap = document.createElement('div'); cap.className = 'gcap'; cap.textContent = d.name;
      tile.appendChild(img); tile.appendChild(cap);
      tile.addEventListener('click', function () { loadGarden(d); gal.classList.remove('show'); });
      inner.appendChild(tile);
    });
    gal.classList.add('show');
  }
  function loadGarden(d) {
    S.buildGarden(d.shape);
    if (d.border && d.border !== KS.P.garden.border) S.setBorder(d.border);
    for (const so of d.objs) {
      const o = KS.Obj.make(so.kind, so.x, so.z, { seed: so.seed, angle: so.angle });
      S.addObject(o);
    }
    S.regenFlow(true);
    toast('回到 · ' + d.name);
  }

  /* ── 静置提示 ── */
  function idleCheck(now) {
    if (S.objs.length > 0 && !savebarOn && (now - lastInteract) > 55000) {
      showSavebar();
    }
  }

  /* ── 启动 ── */
  function boot() {
    const canvas = document.getElementById('stage');
    try {
      S.init(canvas);
    } catch (e) { err('初始化失败：' + e.message); return; }
    S.buildGarden('rect');
    buildPalette();
    bindInput();
    bindCorner();
    buildPanel();
    bindSavebar();
    S.start(function (dt, now) { idleCheck(now); });
    toast('摆一块石头，看砂自己流动');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
