// ============================================================
// plants.js —— 水草 / 藻类 / 程序化植物贴图
// 藻类以 InstancedMesh 贴片形式附着在缸壁、底砂、水草与造景上，
// 覆盖率 density 由 sim.js 驱动，本模块负责可视化。
// ============================================================

import * as THREE from 'three';
import { ITEM_DB, TANK_CFG } from './db.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- 藻类可附着点（静态：三面墙 + 底砂） ----------
export function algaeSpots() {
  const T = TANK_CFG;
  const spots = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const y = 0.45 + j * 0.62;
      const zc = -T.d / 2 + 0.45 + (i * (T.d - 0.9)) / 3;
      spots.push({ x: -T.w / 2 + 0.05, y, z: zc, rot: Math.PI / 2 });          // 左墙
      spots.push({ x: T.w / 2 - 0.05, y, z: zc, rot: -Math.PI / 2 });          // 右墙
      const xc = -T.w / 2 + 0.55 + (i * (T.w - 1.1)) / 3;
      spots.push({ x: xc, y, z: -T.d / 2 + 0.05, rot: 0 });                    // 后墙
      spots.push({ x: xc, y: 0.04 + j * 0.05, z: -0.5 + i * 0.7, rot: -Math.PI / 2, floor: true }); // 底砂
    }
  }
  return spots;
}

// ---------- 程序化噪点贴图（藻斑 / 底砂颗粒） ----------
function makeNoiseTex(size, dots, alpha) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < dots; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 2 + Math.random() * (size / 10);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 底砂颗粒贴图（中性色，实际颜色由 material.color 着色）
export function makeSandTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  // 颗粒
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const l = 0.62 + Math.random() * 0.62;
    g.fillStyle = `rgba(${255 * l | 0},${232 * l | 0},${192 * l | 0},${0.3 + Math.random() * 0.45})`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  // 起伏暗纹
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(60,40,20,${0.05 + Math.random() * 0.09})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(Math.random() * 256, Math.random() * 256);
    g.bezierCurveTo(Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256, Math.random() * 256);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}

// ---------- 藻种配色 ----------
const ALGAE_TYPES = [
  { key: 'green', color: 0x6FA84F, name: '绿藻' },
  { key: 'brown', color: 0x8A6A3A, name: '褐藻' },
  { key: 'filament', color: 0x5A7A3A, name: '丝状藻' },
  { key: 'bluegreen', color: 0x7A5A8A, name: '蓝绿藻' },
];

// ============================================================
//  植物 / 藻类管理器
// ============================================================
export class PlantManager {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'plants';
    scene.add(this.group);

    this._gm = (() => {
      const data = new Uint8Array([70, 140, 210, 255]);
      const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
      tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      return tex;
    })();

    this._leafGeo = new THREE.PlaneGeometry(0.09, 0.34, 1, 4);
    this._mossGeo = new THREE.SphereGeometry(0.05, 7, 6);
    this._stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 1, 6);
    this._duckGeo = new THREE.CircleGeometry(0.035, 10);

    // 藻类 InstancedMesh
    this._algaeTex = makeNoiseTex(128, 70, 0.9);
    this._algaeGeo = new THREE.PlaneGeometry(0.75, 0.55);
    this._algaeMesh = new THREE.InstancedMesh(
      this._algaeGeo,
      new THREE.MeshBasicMaterial({ map: this._algaeTex, transparent: true, opacity: 0.92, depthWrite: false }),
      160,
    );
    this._algaeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._algaeMesh.frustumCulled = false;
    this._algaeMesh.count = 0;
    this._algaeMesh.userData.algae = true;
    this.group.add(this._algaeMesh);
    this._algaeDirty = true;
    this._instances = [];
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // ---- 种植 / 放置 ----
  spawn(type, x, z) {
    const def = ITEM_DB[type];
    if (!def) return null;
    const p = { type, x, z, y: 0.08, biomass: 0.3, seed: Math.random() * 10, meshes: [] };
    p.mesh = this.buildPlant(p);
    this.group.add(p.mesh);
    this.game.plants.push(p);
    // 硬景也登记一个藻类附着点
    this.addAlgaeSpot(x + rand(-0.2, 0.2), 0.1 + Math.random() * 0.4, z + rand(-0.15, 0.15), rand(0, Math.PI));
    return p;
  }

  buildPlant(p) {
    const grp = new THREE.Group();
    const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: this._gm });
    switch (p.type) {
      case 'moss': {
        // 莫斯：一团小球
        const mat = toon(0x5FA84F);
        for (let i = 0; i < 12; i++) {
          const s = new THREE.Mesh(this._mossGeo, mat);
          s.position.set(rand(-0.22, 0.22), rand(0.02, 0.12), rand(-0.16, 0.16));
          s.scale.setScalar(rand(0.5, 1.2));
          grp.add(s);
        }
        break;
      }
      case 'hornwort': {
        // 金鱼藻：茎 + 轮生叶
        const stem = new THREE.Mesh(this._stemGeo, toon(0x4F8A3F));
        stem.scale.y = 1.3;
        stem.position.y = 0.65;
        grp.add(stem);
        const leafMat = toon(0x6FBF5A);
        for (let i = 0; i < 9; i++) {
          const y = 0.15 + i * 0.14;
          for (let k = 0; k < 3; k++) {
            const l = new THREE.Mesh(this._leafGeo, leafMat);
            l.position.y = y;
            l.rotation.y = (k / 3) * Math.PI * 2 + p.seed;
            l.rotation.x = -0.5;
            l.translateY(0.1);
            grp.add(l);
          }
        }
        break;
      }
      case 'anubias': {
        // 水榕：放射状宽叶
        const leafMat = toon(0x3F7A4F);
        for (let i = 0; i < 6; i++) {
          const l = new THREE.Mesh(this._leafGeo, leafMat);
          l.scale.set(1.4, 1.1, 1);
          l.position.y = 0.16;
          l.rotation.y = (i / 6) * Math.PI * 2;
          l.rotation.x = -0.35;
          l.translateY(0.12);
          grp.add(l);
        }
        break;
      }
      case 'duckweed': {
        // 浮萍：水面小圆片
        const mat = toon(0x7FA84F);
        for (let i = 0; i < 16; i++) {
          const d = new THREE.Mesh(this._duckGeo, mat);
          d.rotation.x = -Math.PI / 2;
          d.position.set(rand(-0.4, 0.4), 0, rand(-0.3, 0.3));
          d.userData.base = d.position.clone();
          grp.add(d);
        }
        break;
      }
      default: {
        const s = new THREE.Mesh(this._mossGeo, toon(0x5FA84F));
        grp.add(s);
      }
    }
    grp.position.set(p.x, p.y, p.z);
    grp.traverse((o) => { o.userData.plant = p; });
    return grp;
  }

  // ---- 新增藻类附着点（植物/造景上方） ----
  addAlgaeSpot(x, y, z, rot) {
    if (this._instances.length >= 160) return;
    this._instances.push({
      pos: new THREE.Vector3(x, y, z),
      quat: new THREE.Quaternion().setFromAxisAngle(this._up, rot),
      rand: rand(0.35, 1),
      type: ALGAE_TYPES[(Math.random() * ALGAE_TYPES.length) | 0].key,
    });
    this._algaeDirty = true;
  }

  // ---- 每帧更新（参数顺序：游戏分钟、真实秒、game 状态） ----
  update(dt, elapsed, game) {
    // 水草生长与摇曳
    for (const p of this.game.plants) {
      const def = ITEM_DB[p.type];
      const e = def.effects || {};
      const light = clamp(game._light || 0.5, 0, 1.15);
      const grow = (e.growth || 1) * light * (game.equip.co2 ? 1.5 : 1) * (1 - game.algae.filament * 0.5);
      p.biomass = clamp(p.biomass + grow * 0.00022 * dt, 0.15, 2.4);
      const m = p.mesh;
      if (!m) continue;
      if (p.type === 'hornwort') {
        m.scale.set(0.8 + p.biomass * 0.25, 0.5 + p.biomass * 0.55, 0.8 + p.biomass * 0.25);
        m.rotation.z = Math.sin(elapsed * 0.8 + p.seed) * 0.05;
      } else if (p.type === 'moss') {
        m.scale.setScalar(0.55 + p.biomass * 0.4);
      } else if (p.type === 'anubias') {
        m.scale.setScalar(0.7 + p.biomass * 0.25);
        m.rotation.z = Math.sin(elapsed * 0.5 + p.seed) * 0.03;
      } else if (p.type === 'duckweed') {
        // 浮萍漂动 + 按生物量显隐
        const n = Math.floor(p.biomass * 7);
        m.children.forEach((d, i) => {
          d.visible = i < n;
          const b = d.userData.base;
          d.position.x = b.x + Math.sin(elapsed * 0.3 + i + p.seed) * 0.12;
          d.position.z = b.z + Math.cos(elapsed * 0.24 + i * 1.3) * 0.1;
        });
        m.position.y = TANK_CFG.waterH - 0.015;
      }
    }
    this.updateAlgae(game);
  }

  // ---- 藻类覆盖率可视化 ----
  updateAlgae(game) {
    const a = game.algae;
    const dens = { green: a.green, brown: a.brown, filament: a.filament, bluegreen: a.bluegreen };
    // 首次或结构变化时写入实例颜色
    if (this._algaeDirty) {
      const cm = new THREE.Color();
      for (let i = 0; i < this._instances.length; i++) {
        const inst = this._instances[i];
        const def = ALGAE_TYPES.find((t) => t.key === inst.type) || ALGAE_TYPES[0];
        cm.setHex(def.color);
        this._algaeMesh.setColorAt(i, cm);
      }
      if (this._algaeMesh.instanceColor) this._algaeMesh.instanceColor.needsUpdate = true;
      this._algaeMesh.count = this._instances.length;
      this._algaeDirty = false;
    }
    for (let i = 0; i < this._instances.length; i++) {
      const inst = this._instances[i];
      const d = dens[inst.type] || 0;
      const s = d * inst.rand;
      if (s < 0.015) {
        this._s.set(0, 0, 0);
      } else {
        const stretch = inst.type === 'filament' ? 1.8 : 1;
        this._s.set(0.5 + s * 0.8, (0.5 + s * 0.8) * stretch, 1);
      }
      this._m4.compose(inst.pos, inst.quat, this._s);
      this._algaeMesh.setMatrixAt(i, this._m4);
    }
    this._algaeMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 捞网点击藻类：降低对应藻种覆盖率 ----
  pickAlgae(instanceId) {
    const inst = this._instances[instanceId];
    if (!inst) return false;
    const a = this.game.algae;
    a[inst.type] = clamp((a[inst.type] || 0) - 0.12, 0, 1);
    return true;
  }

  // ---- 移除指定/最后一株植物（捞网操作） ----
  removePlant(p) {
    const i = p ? this.game.plants.indexOf(p) : -1;
    const target = i >= 0 ? this.game.plants.splice(i, 1)[0] : this.game.plants.pop();
    if (target && target.mesh) {
      this.group.remove(target.mesh);
      target.mesh.traverse((o) => { if (o.isMesh && o.material.dispose) o.material.dispose(); });
    }
    return target;
  }
}
