// ============================================================
// creatures.js —— 程序化生物模型 + Boids AI + 状态机
// 模型：全部由几何体程序化生成（身体环线 + 鱼鳍三角面），
//      摆尾通过 MeshToonMaterial.onBeforeCompile 注入顶点正弦波（沿体轴衰减）。
// AI：boids（分离/对齐/聚合）+ 状态机 idle/forage/flee/hunt/court/dying/corpse。
// ============================================================

import * as THREE from 'three';
import { SPECIES_DB, TANK_CFG } from './db.js';
import { algaeSpots } from './plants.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

// 全局共享 uniform：所有鱼材质引用同一 uTime 对象，一处更新全局生效
const U = { uTime: { value: 0 } };

// ---------- 卡通硬边梯度图（MeshToonMaterial 的 gradientMap，NearestFilter） ----------
let _gradientMap = null;
export function getGradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([70, 140, 210, 255]); // 4 阶灰阶
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _gradientMap = tex;
  return tex;
}

// ============================================================
//  程序化贴图（Canvas 2D 动态生成）
// ============================================================
// 贴图坐标约定：u 绕体一周（0=右侧 0.25=背 0.5=左侧 0.75=腹），v 沿体轴（0=吻 1=尾）
function makeScalesTexture(sp, seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const p = sp.palette;

  // 1) 体色：背部偏深、腹部偏浅（沿 u 轴 = canvas x 轴）
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0.0, p.body);
  grad.addColorStop(0.18, shade(p.body, -0.35));  // 背脊加深
  grad.addColorStop(0.45, p.body);
  grad.addColorStop(0.72, p.belly);               // 腹部提亮
  grad.addColorStop(0.86, p.belly);
  grad.addColorStop(1.0, p.body);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  // 2) 鳞片：沿体轴的弧线
  g.lineWidth = 2;
  for (let row = 0; row < 14; row++) {
    const y = (row / 14) * 256;
    for (let col = 0; col < 8; col++) {
      const x = (col / 8) * 256 + (row % 2 ? 16 : 0);
      g.strokeStyle = row % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.13)';
      g.beginPath();
      g.arc(x + 16, y + 10, 13, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
    }
  }

  // 3) 物种花纹
  if (sp.pattern === 'stripe') {
    if (sp.stripeDir === 'around') {
      // 环状横带（小丑鱼）：沿 v 方向的白带
      g.fillStyle = p.accent;
      g.globalAlpha = 0.92;
      g.fillRect(0, 88, 256, 30);
      g.fillRect(0, 168, 256, 24);
      g.globalAlpha = 1;
    } else {
      // 纵带（霓虹灯）：沿体轴方向、位于体侧的色带
      g.fillStyle = p.accent;
      g.globalAlpha = 0.95;
      g.fillRect(216, 0, 22, 256);          // 体侧红纵带
      g.fillStyle = shade(p.body, 0.45);
      g.globalAlpha = 0.85;
      g.fillRect(48, 0, 28, 256);           // 背部亮蓝纵带
      g.globalAlpha = 1;
    }
  } else if (sp.pattern === 'patch') {
    const rng = mulberry32(seed);
    g.fillStyle = p.accent;
    for (let i = 0; i < 10; i++) {
      const x = rng() * 256, y = rng() * 256, r = 10 + rng() * 26;
      g.globalAlpha = 0.5 + rng() * 0.5;
      g.beginPath(); g.ellipse(x, y, r, r * 0.6, rng() * 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  } else if (sp.pattern === 'spot') {
    g.fillStyle = p.accent;
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 5;
      g.globalAlpha = 0.4 + Math.random() * 0.5;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  } else if (sp.pattern === 'gradient') {
    g.fillStyle = p.accent;
    g.globalAlpha = 0.35;
    g.fillRect(0, 0, 256, 70);
    g.globalAlpha = 1;
  }

  // 4) 左侧极窄条带预置「鳍色」，供所有鳍的 UV 采样（u≈0.012）
  g.fillStyle = p.fin;
  g.fillRect(0, 0, 7, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 颜色明暗调整（>0 变亮，<0 变暗）
function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(0xffffff), k);
  else c.multiplyScalar(1 + k);
  return '#' + c.getHexString();
}

// 可复现随机数（保证每条孔雀鱼尾纹独特但存档可恢复）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
//  鱼体几何体：体轴环线 + 鱼鳍三角面（非索引，携带摆尾属性）
// ============================================================
// 体轴轮廓：[t, 半径系数]，t=0 吻端 → t=1 尾柄
const BODY_PROF = [
  [0.00, 0.018], [0.05, 0.15], [0.12, 0.32], [0.22, 0.52], [0.34, 0.72],
  [0.48, 0.87], [0.60, 0.95], [0.72, 1.00], [0.82, 0.94], [0.90, 0.80],
  [0.96, 0.58], [1.00, 0.34],
];
function sampleProf(t) {
  for (let i = 1; i < BODY_PROF.length; i++) {
    if (t <= BODY_PROF[i][0]) {
      const [t0, r0] = BODY_PROF[i - 1], [t1, r1] = BODY_PROF[i];
      const k = (t - t0) / Math.max(1e-6, t1 - t0);
      return [t, r0 + (r1 - r0) * k];
    }
  }
  return [1, 0.34];
}
// 摆尾振幅：头≈0，尾≈1（平方衰减让摆动集中在尾柄）
function ampT(t) { return Math.pow(clamp((t - 0.28) / 0.72, 0, 1), 1.6); }

const SEG = 24, RING = 10;

function buildFishGeometry(sp) {
  const L = 1;
  const halfH = L * sp.body.h * 0.5;
  const halfW = L * sp.body.w * 0.5;
  const pos = [], nor = [], uv = [], amp = [], alp = [], reg = [], pha = [];

  const zOf = (t) => (0.5 - t) * L; // 头在 +z，尾在 -z
  const ringVert = (i, j) => {
    const t = i / SEG;
    const [, pr] = sampleProf(t);
    const a = (j / RING) * Math.PI * 2;
    let y = Math.sin(a) * pr * halfH;
    let x = Math.cos(a) * pr * halfW;
    if (y < 0) y *= 0.72; // 腹部略扁平
    return [x, y, zOf(t)];
  };
  const pushVert = (p, u, v, a, al, rg, ph) => {
    pos.push(p[0], p[1], p[2]); uv.push(u, v);
    amp.push(a); alp.push(al); reg.push(rg); pha.push(ph);
  };
  const pushTri = (a, b, c, uva, uvb, uvc, aa, al, rg, ph) => {
    pushVert(a, ...uva, aa, al, rg, ph);
    pushVert(b, ...uvb, aa, al, rg, ph);
    pushVert(c, ...uvc, aa, al, rg, ph);
  };

  // ---- 身体表面 ----
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < RING; j++) {
      const v00 = ringVert(i, j), v10 = ringVert(i + 1, j);
      const v11 = ringVert(i + 1, j + 1), v01 = ringVert(i, j + 1);
      const u0 = j / RING, u1 = (j + 1) / RING;
      const t0 = i / SEG, t1 = (i + 1) / SEG;
      const a0 = ampT(t0), a1 = ampT(t1);
      pushTri(v00, v10, v11, [u0, t0], [u0, t1], [u1, t1], a0, 1, 0, 0);
      pushTri(v00, v11, v01, [u0, t0], [u1, t1], [u1, t0], a0, 1, 0, 0);
    }
  }
  // 尾部收口（尾柄 t=1 处半径已很小，加一个中心点封口）
  {
    const t = 1, z = zOf(1), pr = 0.34;
    const c0 = [0, 0, z];
    for (let j = 0; j < RING; j++) {
      const a0 = (j / RING) * Math.PI * 2, a1 = ((j + 1) / RING) * Math.PI * 2;
      const p0 = [Math.cos(a0) * pr * halfW, Math.sin(a0) * pr * halfH, z];
      const p1 = [Math.cos(a1) * pr * halfW, Math.sin(a1) * pr * halfH, z];
      pushTri(c0, p1, p0, [0.5, 1], [(j + 1) / RING, 1], [j / RING, 1], 1, 1, 0, 0);
    }
  }

  // ---- 鱼鳍（region=1，半透明；胸鳍 region=2 带独立抖动相位） ----
  // 鳍的 UV 统一指向贴图最左侧的「鳍色条带」，避免鳍上出现鳞片与条纹
  const FU = 0.012;
  const veil = sp.fin === 'veil', long = sp.fin === 'long';
  const finAlpha = veil ? 0.55 : 0.7;
  const caudalScale = veil ? 1.5 : long ? 1.25 : 1.0;
  const dorsalScale = veil ? 1.3 : 1.0;

  // 尾鳍（叉形，位于 x=0 的竖直面）
  {
    const zb = zOf(0.86), zt = zOf(1.0 + 0.20 * caudalScale);
    const hUp = halfH * 0.85 * caudalScale, hLow = halfH * 0.62 * caudalScale;
    pushTri([0, 0.04 * halfH, zb], [0, hUp, zt], [0, 0.04 * halfH + hUp * 0.28, zb - 0.05],
      [FU, 0.9], [FU, 0.4], [FU, 0.9], 1, finAlpha, 1, 0);
    pushTri([0, -0.04 * halfH, zb], [0, -hLow, zt], [0, -0.04 * halfH - hLow * 0.28, zb - 0.05],
      [FU, 0.9], [FU, 0.4], [FU, 0.9], 1, finAlpha, 1, 0);
    pushTri([0, 0.04 * halfH, zb], [0, -0.04 * halfH, zb], [0, 0.012 * halfH, zt * 0.9],
      [FU, 0.9], [FU, 0.9], [FU, 0.5], 1, finAlpha, 1, 0);
  }
  // 背鳍
  {
    const z0 = zOf(0.42), z1 = zOf(0.60), z2 = zOf(0.74);
    const h = halfH * 0.62 * dorsalScale;
    pushTri([0, halfH * 0.72, z0], [0, halfH + h, z1], [0, halfH * 0.68, z2],
      [FU, 0.8], [FU, 0.6], [FU, 0.95], ampT(0.5), finAlpha, 1, 0);
  }
  // 臀鳍
  {
    const z0 = zOf(0.74), z1 = zOf(0.85), z2 = zOf(0.93);
    const h = halfH * 0.5;
    pushTri([0, -halfH * 0.62, z0], [0, -(halfH + h), z1], [0, -halfH * 0.5, z2],
      [FU, 0.9], [FU, 0.7], [FU, 0.95], ampT(0.85), finAlpha, 1, 0);
  }
  // 胸鳍（左右各一，水平小扇，region=2 独立抖动）
  for (const s of [1, -1]) {
    pushTri([s * halfW * 0.75, 0.01, zOf(0.26)], [s * halfW * 1.45, -0.012, zOf(0.12)], [s * halfW * 1.25, -0.026, zOf(0.20)],
      [FU, 0.7], [FU, 0.85], [FU, 0.8], 0.12, 0.62, 2, 1.7);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aAmp', new THREE.Float32BufferAttribute(amp, 1));
  geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alp, 1));
  geo.setAttribute('aRegion', new THREE.Float32BufferAttribute(reg, 1));
  geo.setAttribute('aPh', new THREE.Float32BufferAttribute(pha, 1));
  geo.computeVertexNormals();
  return geo;
}

// ============================================================
//  虾 / 螺 模型（小型无脊椎，MeshToonMaterial + 共享梯度图）
// ============================================================
function buildShrimpMesh(f) {
  const grp = new THREE.Group();
  const gm = getGradientMap();
  const red = new THREE.MeshToonMaterial({ color: 0xFF6B6B, gradientMap: gm });
  const white = new THREE.MeshToonMaterial({ color: 0xFFF3E8, gradientMap: gm });
  const segs = [
    [0.045, 0.032, 0, red], [0.032, 0.026, -0.05, white], [0.024, 0.020, -0.09, red],
  ];
  segs.forEach(([r, h, z, m]) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
    s.scale.set(1, 0.8, 1.4); s.position.z = z; grp.add(s);
  });
  // 尾扇
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.05), white);
    t.position.set(0, 0, -0.13); t.rotation.y = (i - 1) * 0.5; t.rotation.x = -0.4;
    grp.add(t);
  }
  // 步足与触须
  const legMat = new THREE.MeshToonMaterial({ color: 0xE8A0A0, gradientMap: gm });
  for (let i = 0; i < 4; i++) {
    for (const s of [1, -1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.004), legMat);
      l.position.set(s * 0.02, -0.02, -0.02 - i * 0.02);
      grp.add(l);
    }
  }
  const antMat = new THREE.MeshToonMaterial({ color: 0xFFD5D5, gradientMap: gm });
  for (const s of [1, -1]) {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.001, 0.09, 4), antMat);
    a.position.set(s * 0.012, 0.01, 0.05); a.rotation.x = Math.PI / 2.6; a.rotation.z = s * 0.4;
    grp.add(a);
  }
  // 眼睛
  for (const s of [1, -1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), new THREE.MeshBasicMaterial({ color: 0x1B2A3A }));
    e.position.set(s * 0.02, 0.02, 0.045); grp.add(e);
  }
  grp.scale.setScalar(f.len / 0.16); // 模型按 0.16 体长建模，按实际体长归一
  return grp;
}

function buildSnailMesh(f) {
  const grp = new THREE.Group();
  const gm = getGradientMap();
  const shellTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#C98A4B'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#8A5A2B'; g.lineWidth = 5;
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(32, 32, 6 + i * 6, 0, Math.PI * 2); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 10),
    new THREE.MeshToonMaterial({ map: shellTex, gradientMap: gm }),
  );
  shell.scale.set(1, 0.85, 1); shell.position.y = 0.07;
  grp.add(shell);
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.035, 0.07, 4, 8),
    new THREE.MeshToonMaterial({ color: 0xE8C08A, gradientMap: gm }),
  );
  body.rotation.x = Math.PI / 2; body.position.set(0, 0.022, 0.06);
  grp.add(body);
  for (const s of [1, -1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4),
      new THREE.MeshToonMaterial({ color: 0xE8C08A, gradientMap: gm }));
    stalk.position.set(s * 0.018, 0.035, 0.1); grp.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), new THREE.MeshBasicMaterial({ color: 0x1B2A3A }));
    eye.position.set(s * 0.018, 0.05, 0.1); grp.add(eye);
  }
  grp.scale.setScalar(f.len / 0.2);
  return grp;
}

// ============================================================
//  鱼类实例（数据 + 网格句柄）
// ============================================================
let _fid = 1;
export class Fish {
  constructor(spId, x, y, z, opts = {}) {
    this.id = _fid++;
    this.sp = SPECIES_DB[spId];
    this.speciesId = spId;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3(rand(-0.01, 0.01), 0, rand(-0.01, 0.01));
    this.state = 'idle';
    this.satiety = opts.satiety ?? 75;
    this.health = opts.health ?? 100;
    this.stress = opts.stress ?? 0;
    this.age = opts.age ?? 0;
    this.baby = !!opts.baby;
    this.scale = opts.scale ?? (this.baby ? this.sp.babyScale : 0.9);
    this.len = this.sp.adultLen * this.scale;
    this.phase = Math.random() * Math.PI * 2;
    this.seed = Math.random() * 1000;
    this.target = null;       // 食物
    this.prey = null;         // 猎物
    this.threat = null;       // 威胁
    this.partner = null;      // 求偶对象
    this.courtT = 0; this.courtTarget = null;
    this.panicT = 0; this.eatT = 0; this.breedT = rand(60, 180);
    this.grazeT = 0; this.grazeSpot = null;
    this.starving = false; this.gasping = false; this.chased = false;
    this.dieT = 0; this.flip = 0; this.bellyUp = 0;
    this._roll = 0; this._bubbleT = 0; this._eatSndT = 0;
  }
}

// ============================================================
//  生物管理器
// ============================================================
export class CreatureManager {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'creatures';
    scene.add(this.group);
    this._geoCache = {};   // 物种 → 几何体（共享）
    this._texCache = {};   // 物种 → 贴图（共享）
    this._eyeGeo = new THREE.SphereGeometry(1, 8, 8);
    this._spots = algaeSpots();
  }

  // ---- 生成（生物上限 60） ----
  spawn(spId, x, y, z, opts = {}) {
    if (this.game.creatures.length >= 60) return null;
    const f = new Fish(spId, x, y, z, opts);
    f.mesh = this.buildMesh(f);
    this.group.add(f.mesh);
    this.game.creatures.push(f);
    return f;
  }

  // ---- 移除（捞网 / 出售） ----
  remove(f) {
    const i = this.game.creatures.indexOf(f);
    if (i >= 0) this.game.creatures.splice(i, 1);
    if (f.mesh) {
      this.group.remove(f.mesh);
      // 释放该实例的材质（几何体与贴图按物种共享，不释放）
      f.mesh.traverse((o) => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose && m.dispose());
        }
      });
    }
    if (f.partner) f.partner.partner = null;
  }

  buildMesh(f) {
    const sp = f.sp;
    if (sp.cat === 'invert') {
      const m = sp.id === 'snail' ? buildSnailMesh(f) : buildShrimpMesh(f);
      m.traverse((o) => { o.userData.fish = f; });
      return m;
    }
    const grp = new THREE.Group();
    // 几何体 / 贴图按物种缓存共享
    if (!this._geoCache[sp.id]) this._geoCache[sp.id] = buildFishGeometry(sp);
    if (!this._texCache[sp.id]) this._texCache[sp.id] = makeScalesTexture(sp, (f.seed * 1000) | 0);
    const geo = this._geoCache[sp.id];
    const mat = this.makeFishMaterial(f, this._texCache[sp.id]);
    const body = new THREE.Mesh(geo, mat);
    body.userData.fish = f;
    grp.add(body);
    // 玻璃猫：内部骨架可见（不透明材质，否则会被玻璃缸体遮挡）
    if (sp.glassy) {
      const skel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.006, 0.8, 6),
        new THREE.MeshBasicMaterial({ color: 0x9AAEBC }),
      );
      skel.rotation.x = Math.PI / 2;
      grp.add(skel);
    }
    // 眼睛（高光小球）
    for (const s of [1, -1]) {
      const e = new THREE.Mesh(this._eyeGeo, new THREE.MeshBasicMaterial({ color: 0x101820 }));
      e.scale.setScalar(0.016 * sp.body.w * 3);
      e.position.set(s * sp.body.w * 0.32, sp.body.h * 0.16, sp.body.len * 0.42);
      e.userData.fish = f;
      grp.add(e);
      const hl = new THREE.Mesh(this._eyeGeo, new THREE.MeshBasicMaterial({ color: 0xFFFFFF }));
      hl.scale.setScalar(0.006 * sp.body.w * 3);
      hl.position.copy(e.position).multiplyScalar(1.04).add(new THREE.Vector3(s * 0.004, 0.006, 0.006));
      grp.add(hl);
    }
    grp.scale.setScalar(f.len);
    return grp;
  }

  // 每条鱼独立材质（uniform 各自持有）；所有鱼共用同一 shader 程序：
  // three 在「材质首次使用」时都会调用 onBeforeCompile 并把 uniform 记到该材质上
  // （见 WebGLRenderer.getProgram 的 materialProperties.programs 分支），
  // 而 customProgramCacheKey 默认取 onBeforeCompile 源码 → 源码相同即复用程序，
  // 避免每条鱼都新编译一个程序导致的首帧不显示与卡顿。
  // 重要：鱼体必须「不透明」——three 的透射缓冲只渲染不透明物体，
  // 透明物体又会被玻璃（先绘制且写深度）剔除，导致隔玻璃看不见鱼。
  makeFishMaterial(f, tex) {
    const sp = f.sp;
    const uniforms = {
      uTime: U.uTime,
      uPhase: { value: f.phase },
      uAmp: { value: 0.045 },
      uGray: { value: 0 },
      uHunger: { value: 0 },
    };
    const mat = new THREE.MeshToonMaterial({
      map: tex,
      gradientMap: getGradientMap(),
      side: THREE.DoubleSide,
    });
    if (sp.glow) {
      // 荧光鱼：白天几乎不发光，夜晚才亮起（emissive 取体色，避免冲淡体色）
      mat.emissive = new THREE.Color(sp.palette.body).convertSRGBToLinear();
      mat.emissiveIntensity = 0.05;
    }
    mat.userData.perFish = true;
    mat.userData.uniforms = uniforms;
    // 注入顶点摆尾（正弦波沿体轴衰减）与死亡灰化 / 饥饿变暗 / 鱼鳍透光感
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `
        attribute float aAmp; attribute float aAlpha; attribute float aRegion; attribute float aPh;
        uniform float uTime; uniform float uPhase; uniform float uAmp;
        varying float vR;
      ` + shader.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3( position );
        float phw = uPhase + aPh;
        float taper = aAmp * aAmp;
        float wv = sin( uTime * 9.0 + phw );
        transformed.x += wv * uAmp * taper;                      // 摆尾横移
        transformed.z -= cos( uTime * 9.0 + phw ) * uAmp * 0.12 * taper; // 体轴伸缩
        if ( aRegion > 1.5 ) transformed.y += sin( uTime * 11.0 + phw ) * 0.012; // 胸鳍抖动
        vR = aRegion;
      `);
      shader.fragmentShader = `
        uniform float uGray; uniform float uHunger;
        varying float vR;
      ` + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float lum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( lum * 0.55 ), uGray );
        diffuseColor.rgb *= ( 1.0 - uHunger * 0.4 );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.62 + vec3( 0.30 ),
                                clamp( vR, 0.0, 1.0 ) * 0.55 );   // 鱼鳍提亮去饱和 → 薄膜质感
      `);
    };
    return mat;
  }

  // 预热：先构建一份离屏鱼体材质并交给 renderer.compile，避免首次投鱼时编译卡顿
  warmUp() {
    const sp = SPECIES_DB.neon;
    if (!this._geoCache.neon) this._geoCache.neon = buildFishGeometry(sp);
    if (!this._texCache.neon) this._texCache.neon = makeScalesTexture(sp, 7);
    const ghost = new THREE.Mesh(this._geoCache.neon, this.makeFishMaterial({ id: -1, sp, phase: 0 }, this._texCache.neon));
    ghost.position.set(0, -50, 0); // 放到相机外，不影响画面
    this.group.add(ghost);
    return ghost;
  }

  // ============================================================
  //  每帧更新
  // ============================================================
  update(dt, elapsed) {
    U.uTime.value = elapsed;
    this._time = (this._time || 0) + dt; // 游戏内时间（AI 漫游相位）
    const cs = this.game.creatures;
    for (const f of cs) {
      this.updateAI(f, dt, cs);
      this.applyTransform(f, dt, elapsed);
      this.syncEggs(f);
    }
  }

  // ---- 姿态：偏航/俯仰/侧倾/翻白肚 ----
  applyTransform(f, dt, elapsed) {
    const m = f.mesh;
    if (!m) return;
    m.position.copy(f.pos);
    if (f.sp.cat === 'invert') {
      // 无脊椎：仅偏航 + 轻微摇晃
      const d = f.vel.lengthSq() > 1e-8 ? f.vel.clone().normalize() : new THREE.Vector3(0, 0, 1);
      m.rotation.y = Math.atan2(d.x, d.z);
      m.position.y = f.pos.y;
      m.scale.setScalar(f.len); // 成长
      return;
    }
    const sp = f.sp;
    const speed = f.vel.length();
    const dir = speed > 1e-6 ? _tv.copy(f.vel).multiplyScalar(1 / speed) : _tv.set(0, 0, 1);
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = -Math.asin(clamp(dir.y, -1, 1)) * 0.7;
    // 侧倾：由偏航变化率估算
    const dyaw = yaw - (f._yaw ?? yaw);
    f._yaw = yaw;
    const targetRoll = clamp(-dyaw * 2.2, -0.55, 0.55);
    f._roll = THREE.MathUtils.lerp(f._roll, targetRoll, 0.1);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.rotation.x = pitch;
    m.rotation.z = f._roll + f.flip * Math.PI; // flip=1 时翻白肚
    // 尺寸随成长
    m.scale.setScalar(f.len);
    // 材质状态：饥饿变暗 / 死亡灰化 / 夜晚荧光
    const mat = m.children[0] && m.children[0].material;
    if (mat && mat.userData.uniforms) {
      const u = mat.userData.uniforms;
      u.uHunger.value = f.satiety < 20 ? (20 - f.satiety) / 20 : 0;
      u.uGray.value = f.state === 'dying' || f.state === 'corpse' ? Math.min(1, (f.dieT || 0) / 30) : 0;
      u.uAmp.value = 0.045 * clamp(speed / 0.03, 0.3, 2.0);
      if (sp.glow && mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = 0.05 + 0.55 * (this._nightF || 0);
      }
    }
  }

  // ---- 鱼卵可视化（与 game.eggs 同步） ----
  syncEggs(f) { /* 由 refreshEggs 统一处理 */ }

  refreshEggs() {
    const seen = new Set(this.game.eggs);
    for (const e of this.game.eggs) {
      if (!e.meshes) {
        const grp = new THREE.Group();
        const mat = new THREE.MeshToonMaterial({ color: 0xF3E5C0, gradientMap: getGradientMap(), transparent: true, opacity: 0.9 });
        for (let i = 0; i < 5; i++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), mat);
          s.position.set(rand(-0.03, 0.03), rand(-0.02, 0.02), rand(-0.03, 0.03));
          grp.add(s);
        }
        grp.position.set(e.x, e.y, e.z);
        e.meshes = grp;
        this.group.add(grp);
      }
      e.meshes.visible = true;
    }
    // 清理已孵化/已移除的卵
    for (const e of this._lastEggs || []) {
      if (!seen.has(e) && e.meshes) {
        this.group.remove(e.meshes);
        e.meshes.traverse((o) => { if (o.isMesh) o.material.dispose(); });
        e.meshes = null;
      }
    }
    this._lastEggs = [...this.game.eggs];
  }

  // ============================================================
  //  AI：boids + 状态机
  // ============================================================
  updateAI(f, dt, cs) {
    const sp = f.sp;
    const T = TANK_CFG;
    const pos = f.pos, vel = f.vel;

    // ---- 死亡与尸体 ----
    if (f.state === 'corpse') {
      vel.multiplyScalar(Math.pow(0.9, dt));
      pos.y = Math.max(0.05, pos.y - 0.004 * dt);
      pos.x += vel.x * dt; pos.z += vel.z * dt;
      return;
    }
    if (f.state === 'dying') {
      f.dieT += dt;
      f.flip = Math.min(1, f.dieT / 45);
      // 下沉 + 灰化，随后变为尸体
      vel.multiplyScalar(Math.pow(0.92, dt));
      pos.y = Math.max(0.05, pos.y - 0.006 * dt);
      pos.addScaledVector(vel, dt);
      if (f.dieT > 50) { f.state = 'corpse'; f.flip = 1; }
      return;
    }

    const maxSpeed = sp.speed * 0.032 * (f.starving ? 0.6 : 1)
      * (f.state === 'flee' ? 1.9 : f.state === 'forage' ? 1.35 : 1);
    const maxForce = sp.turn * 0.014;
    let ax = 0, ay = 0, az = 0;
    const addF = (x, y, z) => { ax += x; ay += y; az += z; };

    // ---- 感知：威胁 / 猎物 / 食物 ----
    let threat = null, threatD = 1.8;
    let prey = null, preyD = 2.6;
    let sameFlock = [];
    const myLen = f.len;
    for (const o of cs) {
      if (o === f || o.state === 'corpse') continue;
      const dx = o.pos.x - pos.x, dy = o.pos.y - pos.y, dz = o.pos.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 9) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const oLen = o.len;
      // 威胁：明显更大的掠食者/攻击性鱼
      if (oLen > myLen * 1.25 && (o.sp.hunter || o.sp.aggression > 0.5) && d < threatD) {
        threat = o; threatD = d;
      }
      // 猎物：体型小于自身 60%
      if (sp.hunter && f.satiety < 30 && oLen < myLen * 0.6 && d < preyD) {
        prey = o; preyD = d;
      }
      // 同类（群游）
      if (sp.schooling && o.sp.id === sp.id && d < 1.4) sameFlock.push(o);
    }
    f.threat = threat; f.prey = prey;

    // ---- 状态机 ----
    if (f.panicT > 0) f.panicT -= dt;
    if (f.eatT > 0) f.eatT -= dt;

    if (threat && f.panicT <= 0 && f.state !== 'dying') {
      f.state = 'flee'; f.panicT = 3;
      f.stress = Math.min(100, f.stress + 1.5);
      f.chased = true;
      // 逃窜时冒气泡拖尾（节流）
      f._bubbleT -= dt;
      if (f._bubbleT <= 0) { f._bubbleT = 8; this._onBubble && this._onBubble(f.pos.x, f.pos.y, f.pos.z); }
    }
    if (f.state === 'flee' && f.panicT <= 0 && !threat) f.state = 'idle';

    // 觅食 / 捕食 / 啃藻（阈值取 88：有食物就抢食，投喂反馈更直观）
    if (f.state === 'idle' || f.state === 'forage') {
      if (sp.hunter && f.satiety < 30 && prey) {
        f.state = 'hunt';
      } else if (f.satiety < 88 && this.findFood(f)) {
        f.state = 'forage';
      } else if (f.state === 'forage' && f.satiety > 92) {
        f.state = 'idle';
      }
    }

    // 求偶繁殖检查
    f.breedT -= dt;
    if (f.breedT <= 0 && sp.breed && f.scale > 0.72 && f.satiety > 80 && f.health > 90 && f.stress < 20 && f.state === 'idle') {
      f.breedT = 300;
      this.tryCourt(f, cs);
    }

    // ---- 行为力 ----
    switch (f.state) {
      case 'flee': {
        // 逃离威胁
        if (threat) {
          const dx = pos.x - threat.pos.x, dy = pos.y - threat.pos.y, dz = pos.z - threat.pos.z;
          const d = Math.max(0.2, Math.sqrt(dx * dx + dy * dy + dz * dz));
          addF((dx / d) * maxForce * 3, (dy / d) * maxForce * 2.5, (dz / d) * maxForce * 3);
        } else if (f.panicT > 0) {
          // 无威胁但仍在惊慌（如刚入水）：沿当前朝向加速逃窜
          const v = Math.max(0.01, vel.length());
          addF((vel.x / v) * maxForce * 1.8, 0, (vel.z / v) * maxForce * 1.8);
        }
        break;
      }
      case 'hunt': {
        if (prey) {
          const dx = prey.pos.x - pos.x, dy = prey.pos.y - pos.y, dz = prey.pos.z - pos.z;
          const d = Math.max(0.05, Math.sqrt(dx * dx + dy * dy + dz * dz));
          addF((dx / d) * maxForce * 2.6, (dy / d) * maxForce * 2.2, (dz / d) * maxForce * 2.6);
          // 捕获！
          if (d < 0.06 + prey.len * 0.5) {
            prey.health = 0;
            prey.state = 'dying'; prey.dieT = 0;
            f.satiety = Math.min(100, f.satiety + 35);
            this._onEat && this._onEat();
            f.state = 'idle';
          }
        } else f.state = 'idle';
        break;
      }
      case 'forage': {
        const tgt = f.target;
        if (!tgt || (tgt.removed)) { if (!this.findFood(f)) f.state = 'idle'; }
        else {
          const dx = tgt.x - pos.x, dy = tgt.y - pos.y, dz = tgt.z - pos.z;
          const d = Math.max(0.03, Math.sqrt(dx * dx + dy * dy + dz * dz));
          addF((dx / d) * maxForce * 3.0, (dy / d) * maxForce * 2.8, (dz / d) * maxForce * 3.0);
          // 进食
          if (d < 0.09 + f.len * 0.35) {
            const idx = this.game.food.indexOf(tgt);
            if (idx >= 0) this.game.food.splice(idx, 1);
            tgt.removed = true;
            f.satiety = Math.min(100, f.satiety + tgt.nutrition);
            f.stress = Math.max(0, f.stress - 4);
            f.target = null;
            f.state = 'idle';
            f._eatSndT -= dt;
            if (f._eatSndT <= 0) { f._eatSndT = 12; this._onEat && this._onEat(); }
          }
        }
        break;
      }
      case 'court': {
        // 围绕产卵介质盘旋求偶
        const c = f.courtTarget;
        if (c && f.partner && f.partner.state === 'court') {
          const ang = elapsedAngle(f) ;
          const r = 0.35;
          const tx = c.x + Math.cos(ang) * r, tz = c.z + Math.sin(ang) * r;
          const dx = tx - pos.x, dz = tz - pos.z;
          const d = Math.max(0.05, Math.sqrt(dx * dx + dz * dz));
          addF((dx / d) * maxForce * 2, 0, (dz / d) * maxForce * 2);
          // 间歇性冲向对方
          if (Math.sin(f.courtT * 0.3) > 0.85) {
            const px = f.partner.pos.x - pos.x, pz = f.partner.pos.z - pos.z;
            addF(px * 2, 0, pz * 2);
          }
          f.courtT -= dt;
          if (f.courtT <= 0) this.layEggs(f);
        } else {
          f.state = 'idle';
        }
        break;
      }
      default: {
        // idle：漫游 + 啃藻 + 上层浮头
        const n1 = Math.sin(this._time * 0.11 + f.seed);
        const n2 = Math.cos(this._time * 0.07 + f.seed * 1.7);
        addF(n1 * maxForce * 0.5, 0, n2 * maxForce * 0.5);
        // 草食/碎屑食：藻多时游向藻点啃食
        f.grazeT -= dt;
        if ((sp.diet === 'herbivore' || sp.diet === 'detritivore') && f.satiety < 80 && f.grazeT <= 0) {
          f.grazeT = 40;
          const spot = this._spots[(Math.random() * this._spots.length) | 0];
          f.grazeSpot = spot;
        }
        if (f.grazeSpot) {
          const dx = f.grazeSpot.x - pos.x, dy = f.grazeSpot.y - pos.y, dz = f.grazeSpot.z - pos.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 0.2) { f.grazeSpot = null; f.satiety = Math.min(100, f.satiety + 0.5); }
          else addF((dx / d) * maxForce * 0.8, (dy / d) * maxForce * 0.6, (dz / d) * maxForce * 0.8);
        }
        break;
      }
    }

    // ---- boids：群游（对齐 + 聚合）与分离 ----
    if (sameFlock.length && sp.schooling) {
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
      for (const o of sameFlock) {
        cx += o.pos.x; cy += o.pos.y; cz += o.pos.z;
        vx += o.vel.x; vy += o.vel.y; vz += o.vel.z;
      }
      const n = sameFlock.length;
      cx /= n; cy /= n; cz /= n; vx /= n; vy /= n; vz /= n;
      const dx = cx - pos.x, dy = cy - pos.y, dz = cz - pos.z;
      const d = Math.max(0.2, Math.sqrt(dx * dx + dy * dy + dz * dz));
      addF((dx / d) * maxForce * 1.1, (dy / d) * maxForce * 0.8, (dz / d) * maxForce * 1.1);
      const vm = Math.max(0.01, Math.sqrt(vx * vx + vy * vy + vz * vz));
      addF((vx / vm - vel.x / maxSpeed) * maxForce * 0.4, 0, (vz / vm - vel.z / maxSpeed) * maxForce * 0.4);
    }
    for (const o of cs) {
      if (o === f || o.state === 'corpse') continue;
      const dx = pos.x - o.pos.x, dy = pos.y - o.pos.y, dz = pos.z - o.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const minD = (f.len + o.len) * 0.55;
      if (d2 < minD * minD && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        addF((dx / d) * maxForce * 1.4, (dy / d) * maxForce * 1.2, (dz / d) * maxForce * 1.4);
      }
    }
    // 小丑鱼领地性：驱赶靠近的鱼
    if (sp.territory) {
      for (const o of cs) {
        if (o === f || o.sp.id === sp.id || o.state === 'corpse') continue;
        const dx = pos.x - o.pos.x, dz = pos.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.5 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          addF((dx / d) * maxForce * 0.9, 0, (dz / d) * maxForce * 0.9);
          o.stress = Math.min(100, o.stress + 0.4);
          o.chased = true;
        }
      }
    }

    // ---- 边界与水深（软约束，不出缸不穿底） ----
    const m = 0.28 + f.len * 0.4;
    if (pos.x > T.w / 2 - m) addF(-(pos.x - (T.w / 2 - m)) * maxForce * 2.2, 0, 0);
    if (pos.x < -T.w / 2 + m) addF((-T.w / 2 + m - pos.x) * maxForce * 2.2, 0, 0);
    if (pos.z > T.d / 2 - m) addF(0, 0, -(pos.z - (T.d / 2 - m)) * maxForce * 2.2);
    if (pos.z < -T.d / 2 + m) addF(0, 0, (-T.d / 2 + m - pos.z) * maxForce * 2.2);
    const topY = T.waterH - 0.05 - f.len * 0.15, botY = 0.07 + f.len * 0.25;
    if (pos.y > topY) addF(0, -(pos.y - topY) * maxForce * 2.5, 0);
    if (pos.y < botY) addF(0, (botY - pos.y) * maxForce * 2.5, 0);
    // 偏好水层
    const depthT = sp.depth[0] + (sp.depth[1] - sp.depth[0]) * (0.5 + 0.5 * Math.sin(this._time * 0.05 + f.seed));
    const prefY = 0.1 + depthT * (T.waterH - 0.25);
    if (f.state !== 'flee' && f.state !== 'hunt' && f.state !== 'forage') {
      addF(0, (prefY - pos.y) * maxForce * 0.35, 0); // 觅食时不受偏好水层牵制
    }

    // ---- 饥饿浮头 / 缺氧浮头 ----
    if (f.satiety < 5 || f.gasping) {
      f.bellyUp = Math.min(1, f.bellyUp + dt * 0.02);
      addF(0, (T.waterH - 0.09 - pos.y) * maxForce * 1.2, 0);
      if (f.satiety >= 5 && !f.gasping) f.bellyUp = Math.max(0, f.bellyUp - dt * 0.05);
    } else if (f.bellyUp > 0) {
      f.bellyUp = Math.max(0, f.bellyUp - dt * 0.03);
    }

    // ---- 积分（惯性 + 限速） ----
    ax = clamp(ax, -maxForce * 4, maxForce * 4);
    ay = clamp(ay, -maxForce * 4, maxForce * 4);
    az = clamp(az, -maxForce * 4, maxForce * 4);
    vel.x += ax * dt; vel.y += ay * dt; vel.z += az * dt;
    const sp2 = vel.length();
    if (sp2 > maxSpeed) vel.multiplyScalar(maxSpeed / sp2);
    if (sp2 < maxSpeed * 0.25) vel.multiplyScalar(1 + 0.02 * dt); // 保持游动
    pos.addScaledVector(vel, dt);
  }

  // ---- 寻找可食目标（食物 / 藻点） ----
  findFood(f) {
    let best = null, bd = 3.0;
    for (const fd of this.game.food) {
      if (fd.removed) continue;
      // 肉食偏爱红虫；草食只吃沉底/藻
      if (f.sp.diet === 'herbivore' && fd.type === 'bloodworm') continue;
      const dx = fd.x - f.pos.x, dy = fd.y - f.pos.y, dz = fd.z - f.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < bd) { bd = d; best = fd; }
    }
    f.target = best;
    return !!best;
  }

  // ---- 求偶条件判定 ----
  tryCourt(f, cs) {
    const sp = f.sp;
    const same = cs.filter((o) => o !== f && o.sp.id === sp.id && o.scale > 0.72
      && o.satiety > 80 && o.health > 90 && o.stress < 20 && o.state === 'idle');
    if (same.length < sp.breed.min - 1) return;
    // 产卵介质
    let medium = null;
    for (const p of this.game.plants) {
      if (['moss', 'hornwort', 'anubias', 'duckweed'].includes(p.type)) { medium = p; break; }
    }
    if (!medium && sp.breed.medium === 'wood') {
      for (const it of this.game.items || []) {
        if (it.type === 'driftwood') { medium = it; break; }
      }
    }
    if (!medium) return;
    const partner = same[0];
    const cx = medium.x ?? medium.pos?.x ?? 0;
    const cy = medium.y ?? 0.4;
    const cz = medium.z ?? medium.pos?.z ?? 0;
    f.state = 'court'; f.courtT = 45; f.courtTarget = { x: cx, y: cy, z: cz }; f.partner = partner;
    partner.state = 'court'; partner.courtT = 45; partner.courtTarget = f.courtTarget; partner.partner = f;
  }

  // ---- 产卵 ----
  layEggs(f) {
    const c = f.courtTarget;
    f.state = 'idle'; f.satiety -= 12;
    if (f.partner) { f.partner.state = 'idle'; f.partner.satiety -= 12; f.partner.partner = null; }
    f.partner = null;
    if (this.game.eggs.length >= 12) return;
    this.game.eggs.push({
      species: f.speciesId, x: c.x, y: c.y, z: c.z,
      // 孵化倒计时（游戏分钟）：days × 2.5 游戏小时，约合现实数分钟
      timer: f.sp.breed.days * 150, count: f.sp.breed.count,
    });
  }
}

const _tv = new THREE.Vector3();
// 每鱼独立的求偶盘旋角度（以 seed 为相位）
function elapsedAngle(f) {
  return (f._courtAng = (f._courtAng || f.seed) + 0.06);
}

// 供外部注入的音效/粒子回调
export function bindCreatureCallbacks(mgr, cbs) {
  mgr._onBubble = cbs.onBubble;
  mgr._onEat = cbs.onEat;
}
