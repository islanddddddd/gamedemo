/* =========================================================================
 * sand.js —— 砂面（Three.js 版）
 *
 * 思路（和老版本本质不同）：
 *   ① 离屏 pass 把「流函数 ψ」逐像素算成一张高度图（fieldRT）。
 *   ② 砂面是一张高细分网格，顶点着色器按高度图把 y 顶起来（真实位移），
 *      片元着色器用高度图的差分重算法线 → 沟是真的有凹凸、会吃光。
 *   ③ 手耙的笔触叠进另一张 rakeRT，加进高度图。
 *   ④ 重算时的"重新淌过一遍"= 新旧两张高度图之间，一道沿水流方向扫过
 *      的混合前沿（uWipe）。
 *
 * 全部参数都在 params.js。改完按 P 实时看，或抄回 params.js。
 * ========================================================================= */
(function () {
  'use strict';

  const MAXOBJ = KS.Shaders.MAXOBJ;
  const Sh = KS.Shaders;

  function Sand(renderer, bounds, polygon) {
    this.renderer = renderer;
    this.bounds = bounds;                 // { ox, oz, W, H }  砂在世界里的范围
    this.polygon = polygon;               // [[x,z], ...] 院子形状（用于遮罩）
    this.flowDir = new THREE.Vector2(1, 0);

    const b = bounds;
    const fr = KS.P.sand.fieldRes;
    let fw = Math.min(1536, Math.max(64, Math.round(b.W * fr)));
    let fh = Math.min(1536, Math.max(64, Math.round(b.H * fr)));
    this.texW = fw; this.texH = fh;
    this.texel = 1 / fw;

    // ── 高度场离屏纹理（新 / 旧）──
    const rtOpt = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: false, stencilBuffer: false,
    };
    this.fieldNew = new THREE.WebGLRenderTarget(fw, fh, rtOpt);
    this.fieldOld = new THREE.WebGLRenderTarget(fw, fh, rtOpt);
    this.rakeRT = new THREE.WebGLRenderTarget(fw, fh, rtOpt);

    // ── 高度场 pass 的 uniforms（也是 ψ 的载体）──
    // uOA..uOD 由 objects.packField 填；S.fieldU 整个共享给 fieldMat
    const v4a = () => { const a = []; for (let i = 0; i < MAXOBJ; i++) a.push(new THREE.Vector4()); return a; };
    this.fieldU = {
      uOA: { value: v4a() },           // (x, z, 半轴a, 半轴b)
      uOB: { value: v4a() },           // (cosA, sinA, blx, blz)
      uOC: { value: v4a() },           // (nlx, nlz, L, wake)
      uOD: { value: v4a() },           // (str, inA, outA, kind)  kind: 1石 0.4苔 2钵
      uCount: { value: 0 },
      uBDir: { value: this.flowDir },
      uWobble: { value: KS.P.sand.wobble },
      uWobbleFreq: { value: KS.P.sand.wobbleFreq },
      uOrigin: { value: new THREE.Vector2(b.ox, b.oz) },
      uSize: { value: new THREE.Vector2(b.W, b.H) },
      uSpacing: { value: KS.P.sand.spacing },
      uDepth: { value: KS.P.sand.depth },
      uRidge: { value: KS.P.sand.ridge },
      uGrooveSharp: { value: KS.P.sand.grooveSharp },
      uRidgeSoft: { value: KS.P.sand.ridgeSoft },
      uPressDepth: { value: KS.P.sand.pressDepth },
      uPressRise: { value: KS.P.sand.pressRise },
    };

    // ── 高度场材质 + 全屏 quad ──
    this.fieldMat = new THREE.ShaderMaterial({
      vertexShader: Sh.FIELD_VERT, fragmentShader: Sh.FIELD_FRAG,
      uniforms: this.fieldU, depthTest: false, depthWrite: false,
    });
    this.fieldScene = new THREE.Scene();
    this.fieldQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fieldMat);
    this.fieldScene.add(this.fieldQuad);
    this.dummyCam = new THREE.Camera();

    // ── rake 笔刷 ──
    // ★ side: DoubleSide 是必须的，别删：
    //   PlaneGeometry 本来是 XY 平面（正面朝 +Z），rotateX(-π/2) 后躺平朝上，
    //   绕序相对「世界 XZ → 屏幕 XY」的映射变成了顺时针。而 Three 默认 FrontSide
    //   会开背面剔除，于是整块笔刷在光栅化阶段被全数丢弃 —— 症状是
    //   draw call 有、三角形有，但 rakeRT 永远全 0，手耙完全失效。
    this.brushMat = new THREE.ShaderMaterial({
      vertexShader: Sh.BRUSH_VERT, fragmentShader: Sh.BRUSH_FRAG,
      transparent: true, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDepth: { value: KS.P.sand.depth * 1.1 },
        uRidge: { value: KS.P.sand.ridge * 0.8 },
        uWidth: { value: 0.42 },
        uOrigin: { value: this.fieldU.uOrigin.value },
        uSize: { value: this.fieldU.uSize.value },
      },
    });
    this.brushScene = new THREE.Scene();
    this.brush = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.brushMat);
    this.brush.frustumCulled = false;
    this.brushScene.add(this.brush);

    // ── 砂面材质（MeshStandardMaterial + 注入砂着色器）──
    const S = this;
    const cov = makeCoverage(bounds, polygon);
    this.sandU = {
      uFieldNew: { value: this.fieldNew.texture },
      uFieldOld: { value: this.fieldOld.texture },
      uRake: { value: this.rakeRT.texture },
      uOrigin: { value: this.fieldU.uOrigin.value },
      uSize: { value: this.fieldU.uSize.value },
      uWipe: { value: 1 }, uWipeR: { value: 1 }, uWipeSoft: { value: 1.2 }, uAnim: { value: 0 },
      uWipeC: { value: new THREE.Vector2(0, 0) },
      uWipeDir: { value: new THREE.Vector2(1, 0) },
      uCrest: { value: KS.P.flow.crest }, uCrestW: { value: KS.P.flow.crestW },
      uUndAmp: { value: KS.P.sand.undulationAmp }, uUndFreq: { value: KS.P.sand.undulationFreq },
      uHeightScale: { value: 1.0 },
      uTexel: { value: this.texel },
      uNormalStrength: { value: 0.5 },   // 粉彩风：法线只做极轻的明暗，体积交给顶点色块
      uGrainScale: { value: KS.P.sand.grainScale },
      uGrainAmp: { value: KS.P.sand.grainAmp },
      uRippleTint: { value: new THREE.Color(KS.P.style.rippleTint) },
      uRippleMix: { value: KS.P.style.rippleMix },
      uSpacing: { value: KS.P.sand.spacing },
      uCoverage: { value: cov },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(KS.P.sand.color),
      roughness: KS.P.sand.roughness, metalness: 0.0,
      vertexColors: true,               // 每个三角面一个略微不同的色 → low poly 的灵魂
    });
    mat.onBeforeCompile = function (shader) {
      for (const k in S.sandU) shader.uniforms[k] = S.sandU[k];
      shader.vertexShader = Sh.SAND_VERT_HEAD + '\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n' + Sh.SAND_VERT_BODY);
      shader.fragmentShader = Sh.SAND_FRAG_HEAD + '\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {', 'void main() {\n  if (texture2D(uCoverage, vSuv).r < 0.5) discard;');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + Sh.SAND_FRAG_NORMAL);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>', '#include <color_fragment>\n' + Sh.SAND_FRAG_TINT);
      mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = function () { return 'karesansui-sand-v2'; };
    this.material = mat;

    // ── 砂面网格 ──
    // 面片故意做大（style.sandSeg 控制）：low poly 的色块感来自这里。
    // 纹路是片元里逐像素算的，跟网格密度无关 —— 面片再大纹路依然清晰。
    const segX = Math.min(240, Math.max(10, Math.round(b.W * KS.P.style.sandSeg)));
    const segY = Math.min(240, Math.max(10, Math.round(b.H * KS.P.style.sandSeg)));
    let geo = new THREE.PlaneGeometry(b.W, b.H, segX, segY);
    geo.rotateX(-Math.PI / 2);                       // 躺平到 XZ 平面
    geo.translate(b.ox + b.W / 2, 0, b.oz + b.H / 2); // 移到世界坐标
    geo = KS.Facet.tint(geo, KS.P.style.facetAmp, 20261014);   // 每面一个色差
    this.sandGeo = geo;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    // 流动动画状态
    this.anim = 0; this.animating = false; this.animT = 0;
    this.clearRake();
  }

  // 把多边形画成一张遮罩纹理（bbox 内 1=院内 0=院外）
  function makeCoverage(bounds, polygon) {
    const cw = 256, ch = 256;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      const u = (p[0] - bounds.ox) / bounds.W * cw;
      const v = (p[1] - bounds.oz) / bounds.H * ch;
      if (i === 0) g.moveTo(u, v); else g.lineTo(u, v);
    }
    g.closePath(); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  // 渲染高度场到 fieldNew（先把 fieldNew 的旧内容留给 fieldOld 做动画）
  Sand.prototype.regen = function (objs, animate) {
    KS.Obj.packField(objs, this.flowDir, this.fieldU);
    // 交换：旧的 fieldNew 变成 fieldOld
    const tmp = this.fieldOld; this.fieldOld = this.fieldNew; this.fieldNew = tmp;
    this.sandU.uFieldOld.value = this.fieldOld.texture;
    this.sandU.uFieldNew.value = this.fieldNew.texture;

    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.fieldNew);
    r.clear();
    r.render(this.fieldScene, this.dummyCam);
    r.setRenderTarget(prev);

    // 流动动画
    const diag = Math.hypot(this.bounds.W, this.bounds.H);
    this.sandU.uWipeR.value = diag * 0.62;
    this.sandU.uWipeC.value.set(this.bounds.ox + this.bounds.W / 2, this.bounds.oz + this.bounds.H / 2);
    this.sandU.uWipeDir.value.copy(this.flowDir);
    this.sandU.uWipeSoft.value = KS.P.flow.soft * this.bounds.W * 0.06 + 0.6;
    if (animate) {
      this.animating = true; this.animT = 0; this.sandU.uAnim.value = 1; this.sandU.uWipe.value = 0;
    } else {
      this.animating = false; this.sandU.uAnim.value = 0; this.sandU.uWipe.value = 1;
    }
  };

  // 手耙一笔：从 (x0,z0) 到 (x1,z1)
  Sand.prototype.paintRake = function (x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const ang = Math.atan2(-dz, dx);                  // 让笔刷本地 +x 对齐笔画方向
    const bw = KS.P.sand.spacing * 1.5;
    this.brush.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
    this.brush.rotation.set(0, ang, 0);
    this.brush.scale.set(len + bw, 1, bw);

    const r = this.renderer;
    const prev = r.getRenderTarget();
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rakeRT);
    r.render(this.brushScene, this.dummyCam);
    r.setRenderTarget(prev);
    r.autoClear = ac;
  };

  Sand.prototype.clearRake = function () {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const ac = r.autoClear;
    r.autoClear = true;
    r.setRenderTarget(this.rakeRT);
    r.setClearColor(0x000000, 1); r.clear();
    r.setRenderTarget(prev);
    r.autoClear = ac;
  };

  // 每帧推进流动动画
  Sand.prototype.update = function (dt) {
    if (!this.animating) return;
    this.animT += dt * 1000;
    const t = Math.min(1, this.animT / KS.P.flow.ms);
    this.sandU.uWipe.value = t;
    if (t >= 1) { this.animating = false; this.sandU.uAnim.value = 0; }
  };

  // 参数改了，同步 uniform（用于实时调参）
  Sand.prototype.syncParams = function () {
    const s = KS.P.sand, f = KS.P.flow, st = KS.P.style;
    this.fieldU.uWobble.value = s.wobble;
    this.fieldU.uWobbleFreq.value = s.wobbleFreq;
    this.fieldU.uSpacing.value = s.spacing;
    this.fieldU.uDepth.value = s.depth;
    this.fieldU.uRidge.value = s.ridge;
    this.fieldU.uGrooveSharp.value = s.grooveSharp;
    this.fieldU.uRidgeSoft.value = s.ridgeSoft;
    this.fieldU.uPressDepth.value = s.pressDepth;
    this.fieldU.uPressRise.value = s.pressRise;
    this.sandU.uUndAmp.value = s.undulationAmp;
    this.sandU.uUndFreq.value = s.undulationFreq;
    this.sandU.uNormalStrength.value = 0.5;
    this.sandU.uGrainScale.value = s.grainScale;
    this.sandU.uGrainAmp.value = s.grainAmp;
    this.sandU.uSpacing.value = s.spacing;
    this.sandU.uRippleMix.value = st.rippleMix;
    this.sandU.uRippleTint.value.set(st.rippleTint);
    this.sandU.uCrest.value = f.crest;
    this.sandU.uCrestW.value = f.crestW;
    this.material.color.set(s.color);
  };

  // 只改色块强度，不重建几何 → 「色块反差」滑块可以实时拖
  Sand.prototype.syncStyle = function () {
    const d = this.sandGeo.userData.facet;
    if (d) { d.amp = KS.P.style.facetAmp; KS.Facet.apply(this.sandGeo); }
  };

  KS.Sand = Sand;
})();
