/* =========================================================================
 * scene.js —— Three.js 世界
 *
 * 负责：渲染器 / 相机 / 会动的光与影子 / 院子（砂+围墙+地板）/
 *       物件组 / 每帧更新（光漂移、流动动画、视差、偶尔一阵风）/
 *       鼠标拾取（点哪块石头、划到砂面哪一点）。
 *
 * 游戏状态（objs 数组）也由这里持有；main.js 通过这里的接口操作它。
 * ========================================================================= */
(function () {
  'use strict';

  const Scene = {
    renderer: null, scene: null, camera: null,
    sun: null, hemi: null, floor: null,
    sand: null, sandMesh: null, borderGroup: null,
    objectsGroup: null, garden: null, objs: [], floorGeo: null,
    canvas: null, onFrame: null,
    raycaster: new THREE.Raycaster(), groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    cursorRing: null,
    _windT: 0, _last: 0, _par: new THREE.Vector2(0, 0), _parT: new THREE.Vector2(0, 0),

    init: function (canvas) {
      this.canvas = canvas;
      const renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, KS.P.render.pixelRatio[1]));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = KS.P.render.exposure;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(KS.P.light.skyColor);
      scene.fog = new THREE.Fog(KS.P.light.skyColor, 120, 320);
      this.scene = scene;

      this.camera = new THREE.PerspectiveCamera(KS.P.camera.fov, window.innerWidth / window.innerHeight, 0.1, 600);

      // 太阳（方向光 + 阴影）
      const sun = new THREE.DirectionalLight(0xffffff, KS.P.light.intensity);
      sun.castShadow = true;
      sun.shadow.mapSize.set(KS.P.render.shadowMap, KS.P.render.shadowMap);
      // normalBias 要够大：砂面被高度场顶起来 ~0.1 个单位，太小的 bias 会自遮蔽出
      // 一道道黑色"划痕"（shadow acne）。
      sun.shadow.bias = -0.0012;
      sun.shadow.normalBias = 0.14;
      sun.shadow.radius = KS.P.light.shadowRadius;
      sun.target.position.set(0, 0, 0);
      scene.add(sun); scene.add(sun.target);
      this.sun = sun;

      const hemi = new THREE.HemisphereLight(
        new THREE.Color(KS.P.light.skyColor), new THREE.Color(KS.P.light.groundColor), KS.P.light.ambient);
      scene.add(hemi);
      this.hemi = hemi;

      this.objectsGroup = new THREE.Group();
      scene.add(this.objectsGroup);

      // 放物件时的光标圈
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.04, 8, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x5a5462, transparent: true, opacity: 0.5 }));
      ring.position.y = 0.06; ring.visible = false;
      scene.add(ring);
      this.cursorRing = ring;

      window.addEventListener('resize', this._onResize.bind(this));
    },

    _onResize: function () {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    },

    /* ── 造一座院子 ── */
    buildGarden: function (shape) {
      const b = this.bounds; if (!this.bounds) this.bounds = {};
      const P = KS.P.garden;
      let aspect;
      if (shape === 'long') aspect = 1.7;
      else if (shape === 'irregular') aspect = 1.35;
      else aspect = 1.18 + (Math.random() * 0.18);   // rect 略随机
      const H = P.height, W = H * aspect;
      const bounds = { ox: -W / 2, oz: -H / 2, W: W, H: H };
      const polygon = this._polygon(shape, bounds);

      // 清掉旧的
      if (this.sandMesh) { this.scene.remove(this.sandMesh); this.sandMesh.geometry.dispose(); }
      if (this.borderGroup) { this.scene.remove(this.borderGroup); }
      if (this.floor) { this.scene.remove(this.floor); this.floor.geometry.dispose(); }

      // 砂
      this.sand = new KS.Sand(this.renderer, bounds, polygon);
      this.sandMesh = this.sand.mesh;
      this.scene.add(this.sandMesh);

      // 围墙
      this.borderGroup = KS.Obj.buildBorder({ polygon: polygon, bounds: bounds });
      this.scene.add(this.borderGroup);

      // 地板（院子外那片安静的地）——粉彩风里它不再是"幽暗的背景"，
      // 而是一层比砂面更冷、更灰的淡紫，让暖奶白的院子轻轻浮起来。
      // 同样吃顶点色块，且反差放大一点：远看才有一片柔和的高低变化，
      // 不是一块死板的纯色（纯色大平面在粉彩风里特别假）。
      let fp = new THREE.PlaneGeometry(W * 3, H * 3, 22, 14).rotateX(-Math.PI / 2);
      fp = KS.Facet.tint(fp, KS.P.style.facetAmp * 1.8, 4242);
      const fm = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#c8c4d4'), roughness: 1.0, metalness: 0.0,
        flatShading: true, vertexColors: true });
      const floor = new THREE.Mesh(fp, fm);
      floor.position.y = -0.06; floor.receiveShadow = true;
      this.floor = floor; this.floorGeo = fp; this.scene.add(floor);

      this.garden = { shape: shape, bounds: bounds, polygon: polygon };
      this.objs.length = 0;

      // 阴影相机范围
      const half = Math.max(W, H) * 0.8;
      const sc = this.sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = 260; sc.updateProjectionMatrix();

      this.sand.regen([], false);
      this.frameCamera();
    },

    _polygon: function (shape, b) {
      if (shape !== 'irregular') {
        const { ox, oz, W, H } = b;
        return [[ox, oz], [ox + W, oz], [ox + W, oz + H], [ox, oz + H]];
      }
      // 不规则：椭圆 + 低频扰动
      const cx = 0, cz = 0, rx = b.W / 2, rz = b.H / 2, n = 30, pts = [];
      const Nz = KS.Noise;
      for (let i = 0; i < n; i++) {
        const t = i / n * Math.PI * 2;
        const f = 1 + 0.14 * (Nz.vn(Math.cos(t) * 2 + 5, Math.sin(t) * 2, 9) - 0.5) * 2
                    + 0.08 * (Nz.vn(Math.cos(t) * 5, Math.sin(t) * 5, 3) - 0.5) * 2;
        pts.push([cx + Math.cos(t) * rx * f, cz + Math.sin(t) * rz * f]);
      }
      return pts;
    },

    /* ── 物件操作 ── */
    addObject: function (o) {
      const m = KS.Obj.buildMesh(o);
      if (!m) return o;
      this.objectsGroup.add(m);
      this.objs.push(o);
      this.regenFlow(true);
      return o;
    },
    removeObject: function (o) {
      const i = this.objs.indexOf(o);
      if (i < 0) return;
      this.objs.splice(i, 1);
      if (o.mesh) { this.objectsGroup.remove(o.mesh); }
      this.regenFlow(true);
    },
    clearObjects: function () {
      for (const o of this.objs) if (o.mesh) this.objectsGroup.remove(o.mesh);
      this.objs.length = 0;
      this.sand.clearRake();
      this.regenFlow(false);
    },
    moveObject: function (o, x, z) {
      o.x = x; o.z = z;
      if (o.mesh) o.mesh.position.set(x, o.yBase, z);
      this.regenFlow(false);
    },
    rotateObject: function (o, da) {
      o.angle += da;
      if (o.mesh && (o.kind === 'stone' || o.kind === 'moss')) o.mesh.rotation.y = -o.angle;
      this.regenFlow(false);
    },
    regenFlow: function (animate) { if (this.sand) this.sand.regen(this.objs, animate); },
    paintRake: function (x0, z0, x1, z1) { if (this.sand) this.sand.paintRake(x0, z0, x1, z1); },
    clearRake: function () { if (this.sand) this.sand.clearRake(); },

    setBorder: function (type) {
      KS.P.garden.border = type;
      if (this.borderGroup) this.scene.remove(this.borderGroup);
      this.borderGroup = KS.Obj.buildBorder({ polygon: this.garden.polygon, bounds: this.garden.bounds });
      this.scene.add(this.borderGroup);
    },

    // 画风参数变了（目前是「色块反差」）：砂面 + 地板 + 所有物件一起改强度。
    // 只重写顶点色、不重建几何，所以可以实时拖滑块。
    syncStyle: function () {
      if (this.sand && this.sand.syncStyle) this.sand.syncStyle();
      if (this.floorGeo && this.floorGeo.userData.facet) {
        this.floorGeo.userData.facet.amp = KS.P.style.facetAmp * 1.8;
        KS.Facet.apply(this.floorGeo);
      }
      KS.Obj.resyncFacet(this.objs);
    },

    /* ── 拾取 / 投影 ── */
    screenToGround: function (cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return { x: hit.x, z: hit.z };
      return null;
    },
    pickObject: function (cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.objectsGroup.children, true);
      for (const h of hits) {
        let o = h.object.userData.obj;
        if (o) return o;
      }
      return null;
    },

    setCursor: function (x, z, a, b, visible) {
      const ring = this.cursorRing;
      ring.visible = !!visible;
      if (visible) {
        ring.position.set(x, 0.06, z);
        ring.scale.set(Math.max(a, b) * 1.1, 1, Math.min(a, b) * 1.1);
      }
    },

    frameCamera: function () {
      // 相机基准位置（每帧重算，参数可实时调）
      const tilt = KS.P.camera.tilt * Math.PI / 180;
      const b = this.garden.bounds;
      const dist = Math.max(b.W, b.H) * KS.P.camera.dist;
      const hd = dist * Math.cos(tilt), hy = dist * Math.sin(tilt);
      const dir = new THREE.Vector3(0.26, 0, 1).normalize();
      this._camBase = new THREE.Vector3(dir.x * hd, hy, dir.z * hd);
    },

    /* ── 每帧更新 ── */
    update: function (dt, now) {
      // 光
      const L = KS.P.light;
      let az = L.baseAngle * Math.PI / 180, el = L.baseElev * Math.PI / 180;
      if (L.mode === 'drift') {
        const ph = now / 1000 * (Math.PI * 2 / L.driftPeriod);
        az += L.driftAmp * Math.PI / 180 * Math.sin(ph);
        el += 8 * Math.PI / 180 * Math.sin(ph * 0.5);
      } else if (L.mode === 'day') {
        const ph = (now / 1000 / L.dayPeriod) % 1;
        az = (ph * 2 - 1) * Math.PI;            // 从东到西
        el = 12 * Math.PI / 180 + Math.abs(Math.sin(ph * Math.PI)) * 60 * Math.PI / 180;
      }
      const R = Math.max(this.garden.bounds.W, this.garden.bounds.H) * 1.1 + 60;
      this.sun.position.set(
        R * Math.cos(el) * Math.sin(az), R * Math.sin(el), R * Math.cos(el) * Math.cos(az));
      // 低太阳偏暖、偏弱
      const tt = Math.max(0, Math.min(1, (el * 180 / Math.PI - 8) / 50));
      this.sun.color.copy(new THREE.Color(L.warmColor).lerp(new THREE.Color(L.noonColor), tt));
      this.sun.intensity = L.intensity * (0.5 + 0.5 * tt);
      this.sun.shadow.radius = L.shadowRadius;
      this.hemi.intensity = L.ambient;
      this.renderer.toneMappingExposure = KS.P.render.exposure;

      // 影子虚化（半径）在 shadow.radius 上已设

      // 视差
      const k = KS.P.camera.parallaxEase;
      this._par.x += (this._parT.x - this._par.x) * k;
      this._par.y += (this._parT.y - this._par.y) * k;
      const base = this._camBase;
      const off = KS.P.camera.parallax;
      this.camera.position.set(
        base.x + this._par.x * off * 8,
        base.y - this._par.y * off * 4,
        base.z);
      this.camera.lookAt(0, 0, 0);

      // 流动动画 + 水面微动
      if (this.sand) this.sand.update(dt);

      // 风：偶尔一阵（音效）
      this._windT -= dt;
      if (this._windT <= 0) {
        this._windT = KS.P.wind.every[0] + Math.random() * (KS.P.wind.every[1] - KS.P.wind.every[0]);
        try { if (KS.Audio && KS.Audio.wind) KS.Audio.wind(); } catch (e) {}
      }
    },

    setParallax: function (px, py) { this._parT.set(px, py); },

    render: function (dt, now) {
      this.update(dt, now);
      this.renderer.render(this.scene, this.camera);
    },

    start: function (onFrame) {
      this.onFrame = onFrame;
      const self = this;
      this._last = performance.now();
      function loop(t) {
        const dt = Math.min(0.05, (t - self._last) / 1000);
        self._last = t;
        try {
          if (self.onFrame) self.onFrame(dt, t);
          self.render(dt, t);
        } catch (e) {
          if (!self._loopErr) { self._loopErr = true; console.error('主循环出错：', e); }
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
    },
  };

  KS.Scene = Scene;
})();
