/* =========================================================================
 * objects.js —— 物件（石头 / 水钵 / 苔藓 / 植物）的 3D 网格，
 *              以及把它们打包进流函数 uniform 的函数。
 *
 * ★ 低多边形粉彩风的三条规矩（改这个文件前先读懂）：
 *   ① 几何要"粗"：石头用 20 面体、水钵 9 棱、松 6 棱、竹 6 棱。
 *      粗不是偷懒 —— 面少了，每个面才大到能看清是一块色块。
 *   ② 每个面一个略微不同的顶点色（Facet.tint）→ 粗几何也读得出体积。
 *      这是把简陋变成设计的关键，比加光照有效得多。
 *   ③ 一律 flatShading + roughness 1.0 + metalness 0：粉彩不要高光。
 *
 * 颜色集中在这里改，都是低饱和的"粉彩"调子，不要往写实灰上调。
 * ========================================================================= */
(function () {
  'use strict';

  const N = KS.Noise;
  const ST = KS.P.style;

  /* ── 物件栏里的工具（每个都带默认大小，世界单位）── */
  const ITEMS = {
    stoneL: { kind: 'stone', label: '大石', a: 2.4, b: 1.7, h: 1.5 },
    stoneM: { kind: 'stone', label: '中石', a: 1.5, b: 1.1, h: 1.0 },
    stoneS: { kind: 'stone', label: '小石', a: 0.95, b: 0.72, h: 0.62 },
    basin:  { kind: 'basin', label: '水钵', a: 1.9, b: 1.9, h: 0.5, r: 1.9 },
    moss:   { kind: 'moss',  label: '苔藓', a: 2.6, b: 1.8, h: 0.22 },
    bamboo: { kind: 'bamboo', label: '竹',  a: 0.5, b: 0.5, h: 4.0 },
    pine:   { kind: 'pine',  label: '松',  a: 0.7, b: 0.7, h: 3.2 },
  };

  function make(tool, x, z, opts) {
    const it = ITEMS[tool];
    const kd = it.kind;                 // 工具键名(stoneL) → 真实种类(stone)
    opts = opts || {};
    const o = {
      tool: tool, kind: kd, x: x, z: z,
      angle: (opts.angle != null ? opts.angle : 0),
      a: it.a, b: it.b, h: it.h,
      seed: (opts.seed != null ? opts.seed : (Math.random() * 1e6) | 0),
      mesh: null, yBase: 0,
    };
    if (kd === 'basin') o.r = it.r;
    if (kd === 'stone') o.yBase = o.h * 0.12;
    if (kd === 'moss') o.yBase = 0.04;
    return o;
  }

  /* ── 把物件数组写进高度场的 uniform（只有石/苔/钵进场，植物不进场）── */
  function packField(objs, flowDir, U) {
    const F = KS.P.field;
    const BX = flowDir.x, BZ = flowDir.y;
    // 流向的法向（垂直于流）
    const nfx = -BZ, nfz = BX;
    let n = 0;
    for (let i = 0; i < objs.length && n < KS.Shaders.MAXOBJ; i++) {
      const o = objs[i];
      if (o.kind === 'bamboo' || o.kind === 'pine') continue;
      const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
      let kind, str, inA, outA, wake = 0;
      if (o.kind === 'basin') {
        kind = 2; str = 1; inA = 1.0; outA = F.basinReach * F.basinReach;
      } else if (o.kind === 'moss') {
        kind = 0.4; str = F.mossStrength; inA = (F.soft * 0.6) * (F.soft * 0.6); outA = F.mossReach * F.mossReach;
      } else { // stone
        kind = 1; str = F.strength; inA = F.soft * F.soft; outA = F.reach * F.reach;
        const sizeN = Math.max(o.a, o.b);
        wake = F.wakeStretch * (1 + F.wakeGain * (sizeN / 1.6 - 1));
        wake = Math.max(0.15, Math.min(5, wake));
      }
      // 本地"长轴方向" = (ca, sa)；法向分量 = 长轴·n_flow
      const nlx = ca * nfx + sa * nfz;
      const nlz = -sa * nfx + ca * nfz;
      const L = Math.max(o.a, o.b);
      U.uOA.value[n].set(o.x, o.z, o.a, o.b);
      U.uOB.value[n].set(ca, sa, BX, BZ);
      U.uOC.value[n].set(nlx, nlz, L, wake);
      U.uOD.value[n].set(str, inA, outA, kind);
      n++;
    }
    U.uCount.value = n;
    U.uBDir.value.set(BX, BZ);
  }

  /* ───────── 材质：粉彩风的两种 ───────── */

  // 纯色（不给顶点色）。注意：一旦 material.vertexColors = true，
  // 几何体就**必须**有 color 属性，否则 WebGL 会拿默认值 (0,0,0) → 整块变黑。
  // 所以这里严格分成两个函数，别混用。
  function solid(hex, o) {
    o = o || {};
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      roughness: o.rough != null ? o.rough : 1.0,
      metalness: o.metal != null ? o.metal : 0.0,
      flatShading: true,
    });
  }
  // 带色块的：顺手给几何体写顶点色（这是 low poly 的灵魂）
  function faceted(geo, hex, seed, o) {
    o = o || {};
    KS.Facet.tint(geo, ST.facetAmp, seed);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      roughness: o.rough != null ? o.rough : 1.0,
      metalness: o.metal != null ? o.metal : 0.0,
      flatShading: true,
      vertexColors: true,
    });
  }

  /* ───────── 网格构建 ───────── */

  // 一块带棱角的石头：20 面体 → 按噪声把顶点往外/里挤 → 压成椭球 → 坐进砂里。
  // 用低面数 + flatShading，每个三角面就是一块明确的色块。
  function stoneGeo(o) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const dir = v.clone().normalize();
      // 多处噪声叠加 → 坑洼（同一 seed 永远得到同一块石头）
      let n = 0;
      n += N.vn(dir.x * 2.1 + o.seed, dir.y * 2.1, dir.z * 2.1 + o.seed) - 0.5;
      n += 0.5 * (N.vn(dir.x * 4.7 - 11, dir.y * 4.7, dir.z * 4.7 + 7) - 0.5);
      n += 0.25 * (N.vn(dir.x * 9.3 + 3, dir.y * 9.3, dir.z * 9.3 - 5) - 0.5);
      const r = 1 + n * 0.42;
      v.copy(dir).multiplyScalar(r);
      // 底部压平，像坐在砂上
      if (v.y < -0.4) v.y = -0.4 - (v.y + 0.4) * 0.22;
      v.multiply(new THREE.Vector3(o.a, o.h, o.b));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  function stoneMesh(o) {
    const geo = stoneGeo(o);
    // 暗梅紫的石头：在暖奶白砂面上既分明又不抢戏，比写实深灰更"粉彩"
    const m = faceted(geo, '#9a8fb4', o.seed);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return KS.Facet.outline(mesh, ST.outline, ST.outlineCol);
  }

  function basinMesh(o) {
    const grp = new THREE.Group();
    const r = o.r;
    // 石钵外壁（9 棱：面大到能看清色块）
    const wallG = new THREE.CylinderGeometry(r * 1.18, r * 1.32, 0.62, 9, 1, true);
    const wall = new THREE.Mesh(wallG, faceted(wallG, '#b3aabf', o.seed + 11));
    wall.material.side = THREE.DoubleSide;
    wall.position.y = 0.31; wall.castShadow = true; wall.receiveShadow = true;
    // 钵底
    const baseG = new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.12, 9);
    const base = new THREE.Mesh(baseG, faceted(baseG, '#9c93a9', o.seed + 23));
    base.position.y = 0.06; base.receiveShadow = true;
    // 水面（深色、微反光）——不给描边，不然会破坏"碗"的感觉
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(r * 1.0, 9).rotateX(-Math.PI / 2),
      solid('#9dc3d6', { rough: 0.4, metal: 0.15 }));
    water.position.y = 0.42;
    water.userData.noOutline = true;
    grp.add(wall, base, water);
    grp.userData.water = water;
    KS.Facet.outline(grp, ST.outline, ST.outlineCol);
    return grp;
  }

  function mossMesh(o) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = (N.vn(v.x * 5 + o.seed, v.y * 5, v.z * 5 + o.seed) - 0.5) * 0.4;
      v.multiply(new THREE.Vector3(o.a * (1 + n * 0.3), o.h, o.b * (1 + n * 0.3)));
      if (v.y < 0) v.y = 0;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const m = faceted(geo, '#a3bd8a', o.seed);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return KS.Facet.outline(mesh, ST.outline, ST.outlineCol);
  }

  function bambooMesh(o) {
    const grp = new THREE.Group();
    const culms = 3;                                  // 三株一丛，远看才成"一簇竹"
    // 叶片要双面：单面片在倾斜视角下会整片消失，细叶片本来就细，再消失就只剩划痕了
    const leafMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#aec482'), roughness: 0.85, metalness: 0.0,
      flatShading: true, side: THREE.DoubleSide });
    const culmMat = solid('#c8d3a2', { rough: 0.75 });
    for (let c = 0; c < culms; c++) {
      const ph = (c - (culms - 1) / 2) * 0.34;
      const hh = o.h * (0.78 + 0.22 * ((o.seed + c) % 3) / 2);
      const seg = 4;                                   // 少几节，更像风格化的竹
      for (let s = 0; s < seg; s++) {
        const y0 = (s / seg) * hh, y1 = ((s + 1) / seg) * hh;
        // 秆要够粗：细秆在庭院尺度下就是一根线，加了叶也救不回来
        const segMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.13, (y1 - y0) * 0.98, 6), culmMat);
        segMesh.position.set(ph, (y0 + y1) / 2, 0);
        segMesh.castShadow = true;
        grp.add(segMesh);
      }
      // 顶上一簇叶子：叶片放大，且在秆顶摊开成一捧。
      // 叶片要放得平（rotation.x 小）—— 庭院是俯视的，立起来的叶片会被压成一条线，
      // 只有摊平的叶片才铺得开、看得见。
      for (let l = 0; l < 5; l++) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 2.0), leafMat);
        const a = l * 1.35 + (o.seed % 7) * 0.11;
        leaf.position.set(ph + Math.cos(a) * 0.34, hh - 0.28 + (l % 2) * 0.16, Math.sin(a) * 0.34);
        leaf.rotation.set(0.3 + (l % 2) * 0.34, a, (l - 2) * 0.26);
        leaf.userData.noOutline = true;      // 叶片不描边：细边会糊成一团
        grp.add(leaf);
      }
    }
    KS.Facet.outline(grp, ST.outline, ST.outlineCol);
    return grp;
  }

  function pineMesh(o) {
    const grp = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.2, o.h * 0.55, 6),
      solid('#b58d66', { rough: 0.9 }));
    trunk.position.y = o.h * 0.275; trunk.castShadow = true;
    grp.add(trunk);
    const ndl = solid('#93b27c', { rough: 0.95 });
    const tiers = 3;
    for (let t = 0; t < tiers; t++) {
      const rr = o.a * (1 - t * 0.22);
      const yy = o.h * 0.48 + t * o.h * 0.19;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(rr, o.h * 0.44, 6), ndl);
      cone.position.y = yy; cone.castShadow = true;
      grp.add(cone);
    }
    KS.Facet.outline(grp, ST.outline, ST.outlineCol);
    return grp;
  }

  function buildMesh(o) {
    let mesh;
    if (o.kind === 'stone') mesh = stoneMesh(o);
    else if (o.kind === 'basin') mesh = basinMesh(o);
    else if (o.kind === 'moss') mesh = mossMesh(o);
    else if (o.kind === 'bamboo') mesh = bambooMesh(o);
    else if (o.kind === 'pine') mesh = pineMesh(o);
    if (!mesh) return null;
    mesh.position.set(o.x, o.yBase, o.z);
    if (o.kind === 'stone' || o.kind === 'moss') mesh.rotation.y = -o.angle;
    // 描边 mesh 不带 userData.obj → 鼠标拾取会自动跳过它
    mesh.traverse(function (c) {
      if (c.isMesh && !c.userData.noPick) c.userData.obj = o;
    });
    o.mesh = mesh;
    return mesh;
  }

  // 调 style.facetAmp 时把所有物件的色块强度改一遍（不重建几何）
  function resyncFacet(objs) {
    for (const o of objs) {
      if (!o.mesh) continue;
      o.mesh.traverse(function (c) {
        if (!c.isMesh || c.userData.noPick) return;
        const d = c.geometry && c.geometry.userData.facet;
        if (d) { d.amp = KS.P.style.facetAmp; KS.Facet.apply(c.geometry); }
      });
    }
  }

  /* ── 院子围墙（木回廊 / 苔边 / 竹篱）── */
  function buildBorder(garden) {
    const grp = new THREE.Group();
    const poly = garden.polygon, W = garden.bounds.W, H = garden.bounds.H;
    const t = KS.P.garden.border, bw = KS.P.garden.borderW, bh = KS.P.garden.borderH;

    function mat(color, rough) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), roughness: rough == null ? 0.9 : rough, flatShading: true });
    }
    let mtl;
    if (t === 'moss') mtl = mat('#93a86e', 1.0);
    else if (t === 'bamboo') mtl = mat('#c0cd90', 0.75);
    else mtl = mat('#c99a6b', 0.85);   // 木回廊：暖木色，和奶白砂面同调子

    if (t === 'bamboo') {
      // 竹篱：沿边放细柱 + 两道横档
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz);
        const phi = Math.atan2(dz, dx);           // 边的走向角
        const posts = Math.max(2, Math.round(len / 1.1));
        for (let k = 0; k <= posts; k++) {
          const px = a[0] + dx * (k / posts), pz = a[1] + dz * (k / posts);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, bh + 0.6, 6), mtl);
          post.position.set(px, (bh + 0.6) / 2, pz); post.castShadow = true; post.receiveShadow = true;
          grp.add(post);
        }
        // 横档
        for (const ry of [0.35, 0.95]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 0.1, 0.12), mtl);
          rail.position.set((a[0] + c[0]) / 2, ry, (a[1] + c[1]) / 2);
          rail.rotation.y = -phi; rail.castShadow = true;
          grp.add(rail);
        }
      }
      return grp;
    }

    // 木 / 苔：每边一根 box
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      const phi = Math.atan2(dz, dx);
      const box = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, bh, bw), mtl);
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      // 向外挪一点，让内边贴着院子边界
      const nx = dz / len, nz = -dx / len;       // 边的外法向（CCW 多边形取右法向）
      const ox = mx + nx * (bw / 2), oz = mz + nz * (bw / 2);
      box.position.set(ox, bh / 2, oz);
      box.rotation.y = -phi;
      box.castShadow = true; box.receiveShadow = true;
      grp.add(box);
    }
    return grp;
  }

  KS.Obj = {
    ITEMS: ITEMS, make: make, packField: packField, buildMesh: buildMesh, buildBorder: buildBorder,
    resyncFacet: resyncFacet,
  };
})();
