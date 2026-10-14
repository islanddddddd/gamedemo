// ============================================================
// scene.js —— 缸体 / 水面 / 光照 / 后处理 / 焦散 / 体积光柱
// 美术目标：原神风卡通渲染（MeshToonMaterial + 硬边描边 + 辉光 + 通透感）
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ITEM_DB, TANK_CFG } from './db.js';
import { makeSandTexture } from './plants.js';

const T = TANK_CFG;
const C = (hex) => new THREE.Color(hex).convertSRGBToLinear(); // shader uniform 用线性色

// ---------- 自定义后处理：径向模糊 + 暗角（轻微景深感） ----------
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0.0022 },
    uVig: { value: 0.85 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uBlur; uniform float uVig;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float r = length( c );
      vec3 col = vec3( 0.0 ); float total = 0.0;
      for ( int i = 0; i < 6; i ++ ) {
        float f = 1.0 - float( i ) * 0.16;
        vec2 uv = 0.5 + c * f * ( 1.0 - uBlur * r * 2.0 );
        float w = 1.0 - float( i ) * 0.12;
        col += texture2D( tDiffuse, uv ).rgb * w;
        total += w;
      }
      col /= total;
      col *= smoothstep( uVig + 0.35, uVig - 0.25, r );      // 暗角
      float lum = dot( col, vec3( 0.299, 0.587, 0.114 ) );
      col = mix( vec3( lum ), col, 1.10 );                     // 轻微加饱和
      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

// ---------- 程序化 Voronoi 焦散贴图 ----------
function makeCausticTex(size, cells) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const pts = [];
  for (let i = 0; i < cells * cells; i++) {
    pts.push([(Math.floor(i / cells) + 0.5 + (Math.random() - 0.5) * 0.7) / cells * size,
              (Math.floor(i % cells) + 0.5 + (Math.random() - 0.5) * 0.7) / cells * size]);
  }
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = 1e9, d2 = 1e9;
      for (const p of pts) {
        const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      // Voronoi 边缘亮线 → 类似焦样网状纹理
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const v = Math.pow(Math.max(0, 1 - edge / (size / cells) * 1.1), 2.2);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- 水面 Shader（Gerstner 波 + Fresnel + 涟漪 + 折射扰动） ----------
const WaterShader = {
  uniforms: {
    uTime: { value: 0 },
    uDeep: { value: C(0x1B6E8E) },
    uShallow: { value: C(0x6FD3E8) },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uSunCol: { value: C(0xFFF0D8) },
    uRipples: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -10, 0)) },
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform vec4 uRipples[ 8 ];
    varying vec3 vWorld; varying vec3 vN; varying float vRipple;
    // 单个方向波（仅取高度分量用于求法线）
    float waveH( vec2 xz ) {
      float h = 0.0;
      h += sin( dot( xz, vec2( 0.9, 0.4 ) ) * 1.6 + uTime * 1.7 ) * 0.030;
      h += sin( dot( xz, vec2( -0.5, 0.85 ) ) * 2.3 + uTime * 2.2 ) * 0.022;
      h += sin( dot( xz, vec2( 0.3, -0.95 ) ) * 3.4 + uTime * 2.9 ) * 0.013;
      h += sin( dot( xz, vec2( 0.8, 0.6 ) ) * 5.1 + uTime * 3.6 ) * 0.008;
      // 点击/落水涟漪（环形行波，随时间扩散衰减）
      for ( int i = 0; i < 8; i ++ ) {
        vec4 r = uRipples[ i ];
        if ( r.w < 0.5 ) continue;
        float t = uTime - r.z;
        if ( t < 0.0 || t > 3.0 ) continue;
        float d = distance( xz, r.xy );
        float front = t * 1.3;
        h += sin( ( d - front ) * 11.0 ) * exp( -abs( d - front ) * 2.4 ) * exp( -t * 1.5 ) * 0.028;
      }
      return h;
    }
    void main(){
      vec3 p = position;
      p.y += waveH( p.xz );
      // 中心差分求法线
      float e = 0.06;
      float hx = waveH( p.xz + vec2( e, 0.0 ) ) - waveH( p.xz - vec2( e, 0.0 ) );
      float hz = waveH( p.xz + vec2( 0.0, e ) ) - waveH( p.xz - vec2( 0.0, e ) );
      vN = normalize( vec3( -hx, 2.0 * e, -hz ) );
      vec4 wp = modelMatrix * vec4( p, 1.0 );
      vWorld = wp.xyz;
      // 记录涟漪强度供片元高亮
      vRipple = 0.0;
      for ( int i = 0; i < 8; i ++ ) {
        vec4 r = uRipples[ i ];
        if ( r.w < 0.5 ) continue;
        float t = uTime - r.z;
        if ( t < 0.0 || t > 3.0 ) continue;
        float d = distance( p.xz, r.xy );
        float front = t * 1.3;
        vRipple += exp( -abs( d - front ) * 3.0 ) * exp( -t * 1.5 );
      }
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uDeep, uShallow, uSunDir, uSunCol;
    uniform float uTime;
    varying vec3 vWorld; varying vec3 vN; varying float vRipple;
    void main(){
      vec3 N = normalize( vN );
      vec3 V = normalize( cameraPosition - vWorld );
      float fres = pow( 1.0 - max( dot( N, V ), 0.0 ), 3.0 );
      // 正视（俯视）时近乎透明，可看清水中生物；掠射时如镜面反射天空
      vec3 col = mix( uDeep, uShallow, fres * 0.9 + 0.06 );
      vec3 H = normalize( normalize( uSunDir ) + V );
      col += uSunCol * pow( max( dot( N, H ), 0.0 ), 240.0 ) * 1.5; // 太阳镜面（波光粼粼）
      col += uSunCol * fres * 0.25;
      col += vec3( 0.85, 0.95, 1.0 ) * vRipple * 0.6;              // 涟漪亮环
      float alpha = clamp( 0.10 + fres * 0.85 + vRipple * 0.3, 0.0, 0.95 );
      gl_FragColor = vec4( col, alpha );
    }
  `,
};

// ---------- 焦散 Shader（两层噪声贴图叠加滚动） ----------
const CausticShader = {
  uniforms: {
    uT1: { value: null }, uT2: { value: null },
    uTime: { value: 0 }, uIntensity: { value: 0.7 },
    uColor: { value: C(0xFFF6E0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uT1, uT2; uniform float uTime, uIntensity; uniform vec3 uColor;
    varying vec2 vUv;
    void main(){
      float a = texture2D( uT1, vUv * 1.15 + vec2( uTime * 0.030, uTime * 0.021 ) ).r;
      float b = texture2D( uT2, vUv * 1.5 - vec2( uTime * 0.024, uTime * 0.034 ) ).r;
      float v = pow( max( a, b ), 1.7 ) * uIntensity;
      gl_FragColor = vec4( uColor * v, 1.0 );
    }
  `,
};

// ---------- 体积光柱 Shader ----------
const ShaftShader = {
  uniforms: {
    uTime: { value: 0 }, uOpacity: { value: 0.0 }, uColor: { value: C(0xFFF0C8) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime, uOpacity; uniform vec3 uColor;
    varying vec2 vUv;
    void main(){
      float grad = pow( 1.0 - vUv.y, 1.6 );            // 上窄下宽
      float n = 0.55 + 0.45 * sin( vUv.x * 26.0 + uTime * 0.8 ) * cos( vUv.y * 9.0 - uTime * 0.6 );
      float a = grad * n * uOpacity;
      gl_FragColor = vec4( uColor, a );
    }
  `,
};

// ---------- 程序化天空球 ----------
const SkyShader = {
  uniforms: {
    uTop: { value: C(0x7EC8E8) }, uBottom: { value: C(0xF3F5F0) }, uNight: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main(){
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uTop, uBottom; uniform float uNight;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize( vDir );
      float h = clamp( d.y * 0.5 + 0.5, 0.0, 1.0 );
      vec3 col = mix( uBottom, uTop, pow( h, 1.25 ) );
      // 简易云带
      float band = sin( d.x * 3.0 + d.z * 2.0 ) * cos( d.y * 5.0 );
      col += vec3( 0.06 ) * smoothstep( 0.3, 1.0, band ) * ( 1.0 - uNight );
      col = mix( col, vec3( 0.05, 0.08, 0.16 ), uNight * 0.75 );
      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

// ---------- 木质贴图 ----------
function makeWoodTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8A6242'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(60,38,20,${0.1 + Math.random() * 0.2})`;
    g.lineWidth = 1 + Math.random() * 4;
    const y = Math.random() * 256;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(80, y + rand2(-14, 14), 170, y + rand2(-14, 14), 256, y + rand2(-8, 8));
    g.stroke();
  }
  function rand2(a, b) { return a + Math.random() * (b - a); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ============================================================
//  场景管理器
// ============================================================
export class SceneManager {
  constructor(canvas, game) {
    this.game = game;
    this.lowSpec = false;
    this.nightF = 0;
    this.rippleIdx = 0;
    this._camTween = null;

    // ---- 渲染器 ----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping; // 干净高明度卡通感，交给 OutputPass 做 sRGB
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ---- 场景 / 相机 ----
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9ADCFF, 0.02);
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 120);
    this.camera.position.set(0, 3.6, 8.0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.15, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 13;
    this.controls.maxPolarAngle = 1.48; // 限制俯仰角，不穿到台座下方
    this.controls.minPolarAngle = 0.15;

    this._buildLights();
    this._buildSky();
    this._buildDust();
    this._buildTank();
    this._buildSand();
    this._buildWater();
    this._buildCaustics();
    this._buildShafts();
    this._buildParticles();
    this._buildComposer();

    window.addEventListener('resize', () => this.onResize());
  }

  // ============================================================
  //  光照：暖色主平行光（晨光）+ 冷色半球光（天光）+ 灯具 + 水晶点光
  // ============================================================
  _buildLights() {
    // 卡通材质：gradientMap 的最高阶即为满照度，故各光源强度之和需控制在 ~1.0，
    // 否则颜色会整体溢出成白色（通透感 ≠ 过曝）
    this.sun = new THREE.DirectionalLight(0xFFE8C8, 0.85);
    this.sun.position.set(4.5, 6.5, 3.5);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xBFE8FF, 0xE8D5A8, 0.24);
    this.scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xFFFFFF, 0.06);
    this.scene.add(this.amb);

    // 灯具（聚光灯，色温/强度可调）
    this.lampLight = new THREE.SpotLight(0xFFF2DC, 0, 9, 0.72, 0.55, 1.2);
    this.lampLight.position.set(0, 3.35, 0.4);
    this.lampLight.target.position.set(0, 0.6, 0);
    this.scene.add(this.lampLight, this.lampLight.target);

    // 夜灯（冷蓝月光）
    this.moonLight = new THREE.DirectionalLight(0x8FB0FF, 0);
    this.moonLight.position.set(-3, 5, -2);
    this.scene.add(this.moonLight);

    // 水晶簇点光源（夜间亮起）
    this.crystalLights = [];
  }

  _buildSky() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(45, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: SkyShader.uniforms, vertexShader: SkyShader.vertexShader,
        fragmentShader: SkyShader.fragmentShader, side: THREE.BackSide, fog: false, depthWrite: false,
      }),
    );
    this.scene.add(this.sky);
  }

  _buildDust() {
    // 缸外漂浮光尘（暖金）+ 大颗粒柔和虚化
    const N = 150;
    const pos = new Float32Array(N * 3);
    this._dustBase = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 7 + Math.random() * 6;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(ph) * Math.cos(th);
      const y = Math.abs(r * Math.cos(ph)) * 0.7 + 0.5;
      const z = r * Math.sin(ph) * Math.sin(th);
      pos.set([x, y, z], i * 3);
      this._dustBase.set([x, y, z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xF3D9A0, size: 0.075, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
    }));
    this.scene.add(this.dust);
    // 大颗粒（景深虚化感）
    const N2 = 40;
    const pos2 = new Float32Array(N2 * 3);
    for (let i = 0; i < N2; i++) {
      const r = 5 + Math.random() * 5;
      const th = Math.random() * Math.PI * 2;
      pos2.set([r * Math.cos(th), 0.5 + Math.random() * 4, r * Math.sin(th)], i * 3);
    }
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    this.dust2 = new THREE.Points(geo2, new THREE.PointsMaterial({
      color: 0xFFE9C0, size: 0.22, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.scene.add(this.dust2);
  }

  // ============================================================
  //  鱼缸本体：玻璃缸体（透射）+ 金色包边 + 木质台座
  // ============================================================
  _buildTank() {
    const tank = new THREE.Group();
    // 玻璃（MeshPhysicalMaterial：transmission 透射，ior 1.33 模拟水/玻璃）
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xEEF8FF, transmission: 0.95, roughness: 0.05, ior: 1.33,
      thickness: 0.35, transparent: true, metalness: 0, envMapIntensity: 0.6,
    });
    // 玻璃必须「不写深度 + 最先绘制」：
    // three 的渲染顺序是 透射缓冲 → 不透明 → 透射(玻璃) → 透明，
    // 若玻璃写深度，缸内的透明物（水面/气泡/水花）会被它挡住。
    this.glassMat.depthWrite = false;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(T.w, T.wallH, T.d), this.glassMat);
    glass.position.y = T.wallH / 2;
    glass.renderOrder = -1;
    tank.add(glass);
    // 低配降级用的廉价玻璃
    this.glassMatLite = new THREE.MeshPhysicalMaterial({
      color: 0xBFE8F5, transparent: true, opacity: 0.10, roughness: 0.06, metalness: 0, depthWrite: false,
    });

    // 金色包边（金属描边条）
    const gold = new THREE.MeshStandardMaterial({ color: 0xD4A24C, metalness: 0.85, roughness: 0.28 });
    const bar = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gold);
      m.position.set(x, y, z);
      tank.add(m);
    };
    const e = 0.045;
    // 四角立柱
    bar(e, T.wallH, e, -T.w / 2 - e / 2, T.wallH / 2, -T.d / 2 - e / 2);
    bar(e, T.wallH, e, T.w / 2 + e / 2, T.wallH / 2, -T.d / 2 - e / 2);
    bar(e, T.wallH, e, -T.w / 2 - e / 2, T.wallH / 2, T.d / 2 + e / 2);
    bar(e, T.wallH, e, T.w / 2 + e / 2, T.wallH / 2, T.d / 2 + e / 2);
    // 顶框
    bar(T.w + e * 2, e, e, 0, T.wallH, -T.d / 2 - e / 2);
    bar(T.w + e * 2, e, e, 0, T.wallH, T.d / 2 + e / 2);
    bar(e, e, T.d + e * 2, -T.w / 2 - e / 2, T.wallH, 0);
    bar(e, e, T.d + e * 2, T.w / 2 + e / 2, T.wallH, 0);
    // 底框
    bar(T.w + e * 2, e, e, 0, 0, -T.d / 2 - e / 2);
    bar(T.w + e * 2, e, e, 0, 0, T.d / 2 + e / 2);
    bar(e, e, T.d + e * 2, -T.w / 2 - e / 2, 0, 0);
    bar(e, e, T.d + e * 2, T.w / 2 + e / 2, 0, 0);

    // 台座（木质 + 石质顶面）
    const woodTex = makeWoodTex();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(T.w + 0.7, T.baseH, T.d + 0.7),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7, metalness: 0.05 }),
    );
    base.position.y = -T.baseH / 2 - 0.02;
    tank.add(base);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(T.w + 0.3, 0.05, T.d + 0.3),
      new THREE.MeshToonMaterial({ color: 0x3A4A58, gradientMap: this._gm() }),
    );
    slab.position.y = -0.025;
    tank.add(slab);
    this.scene.add(tank);
    this.tankGroup = tank;
  }

  _gm() {
    if (!this._gradientMap) {
      const data = new Uint8Array([70, 140, 210, 255]);
      const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
      tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      this._gradientMap = tex;
    }
    return this._gradientMap;
  }

  _buildSand() {
    const geo = new THREE.PlaneGeometry(T.w - 0.06, T.d - 0.06, 40, 40);
    // 噪声起伏
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const h = Math.sin(x * 5.2) * Math.cos(y * 4.3) * 0.012 + Math.sin(x * 11 + y * 7) * 0.006;
      p.setZ(i, h);
    }
    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    this.sandMat = new THREE.MeshToonMaterial({
      map: makeSandTexture(), color: 0xDCC79B, gradientMap: this._gm(),
    });
    this.sand = new THREE.Mesh(geo, this.sandMat);
    this.sand.position.y = 0.012;
    this.scene.add(this.sand);
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(T.w - 0.05, T.d - 0.05, 56, 56);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = WaterShader.uniforms;
    this.water = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: WaterShader.vertexShader,
      fragmentShader: WaterShader.fragmentShader,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.water.position.y = T.waterH;
    this.scene.add(this.water);
  }

  _buildCaustics() {
    this.causticUniforms = CausticShader.uniforms;
    this.causticUniforms.uT1.value = makeCausticTex(128, 6);
    this.causticUniforms.uT2.value = makeCausticTex(128, 9);
    const mkMat = () => new THREE.ShaderMaterial({
      uniforms: this.causticUniforms, vertexShader: CausticShader.vertexShader,
      fragmentShader: CausticShader.fragmentShader, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // 缸底焦散
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(T.w - 0.1, T.d - 0.1), mkMat());
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.05;
    this.scene.add(bottom);
    this.caustics = [bottom];
  }

  _buildShafts() {
    this.shaftUniforms = ShaftShader.uniforms;
    this.shafts = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.55 + i * 0.12, T.wallH - 0.2, 12, 1, true),
        new THREE.ShaderMaterial({
          uniforms: this.shaftUniforms, vertexShader: ShaftShader.vertexShader,
          fragmentShader: ShaftShader.fragmentShader, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        }),
      );
      cone.position.set(-1.4 + i * 0.95, (T.wallH - 0.2) / 2 + 0.1, -0.5 + i * 0.32);
      cone.rotation.z = (i - 1.5) * 0.06;
      this.shafts.add(cone);
    }
    this.scene.add(this.shafts);
  }

  _buildParticles() {
    // 气泡对象池
    this.bubbles = [];
    this.bubbleGeo = new THREE.SphereGeometry(0.022, 6, 5);
    this.bubbleMat = new THREE.MeshBasicMaterial({ color: 0xDFF6FF, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(this.bubbleGeo, this.bubbleMat);
      m.visible = false;
      this.scene.add(m);
      this.bubbles.push({ mesh: m, active: false, vy: 0, wob: Math.random() * 10 });
    }
    // 水花粒子对象池
    this.splashes = [];
    this.splashGeo = new THREE.SphereGeometry(0.014, 5, 4);
    this.splashMat = new THREE.MeshBasicMaterial({ color: 0xCFEFFF, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(this.splashGeo, this.splashMat);
      m.visible = false;
      this.scene.add(m);
      this.splashes.push({ mesh: m, active: false, vx: 0, vy: 0, vz: 0, life: 0 });
    }
  }

  _buildComposer() {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 细描边（暖棕色）
    this.outline = new OutlinePass(size.clone(), this.scene, this.camera);
    this.outline.edgeStrength = 2.6;
    this.outline.edgeGlow = 0.3;
    this.outline.edgeThickness = 1.0;
    this.outline.pulsePeriod = 0;
    this.outline.visibleEdgeColor.set(0xD4A24C);
    this.outline.hiddenEdgeColor.set(0x8A6A3A);
    this.composer.addPass(this.outline);

    // 辉光：本工程未使用色调映射，漫反射面亮度已达 ~0.9（线性），
    // 阈值若取 0.85 会让底砂/水面/天空整片起辉 → 画面蒙上一层白雾。
    // 因此阈值设为 1.0，只让镜面高光（水面波光、金边）与自发光（水晶、荧光鱼）起辉。
    this.bloom = new UnrealBloomPass(size.clone(), 0.28, 0.3, 1.15);
    this.composer.addPass(this.bloom);

    // 径向模糊 + 暗角
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);

    this.composer.addPass(new OutputPass());

    // FXAA 抗锯齿
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.material.uniforms.resolution.value.set(1 / window.innerWidth, 1 / window.innerHeight);
    this.composer.addPass(this.fxaa);
  }

  // ============================================================
  //  造景 / 设备模型（程序化）
  // ============================================================
  addHardscape(type, x, z) {
    const def = ITEM_DB[type];
    if (!def) return null;
    const grp = new THREE.Group();
    const gm = this._gm();
    const rnd = (a, b) => a + Math.random() * (b - a);
    if (type === 'volcanic') {
      const mat = new THREE.MeshToonMaterial({ color: 0x6E4A3A, gradientMap: gm });
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd(0.12, 0.26), 0), mat);
        r.position.set(x + rnd(-0.35, 0.35), 0.08, z + rnd(-0.25, 0.25));
        r.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
        r.scale.y = rnd(0.7, 1.1);
        grp.add(r);
      }
    } else if (type === 'dragonstone') {
      const mat = new THREE.MeshToonMaterial({ color: 0x7A8B96, gradientMap: gm });
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd(0.18, 0.34), 0), mat);
        r.position.set(x + rnd(-0.3, 0.3), 0.1, z + rnd(-0.2, 0.2));
        r.scale.y = rnd(0.6, 0.95);
        grp.add(r);
      }
    } else if (type === 'driftwood') {
      const mat = new THREE.MeshToonMaterial({ color: 0x6B4A2E, gradientMap: gm });
      let px = x, py = 0.1, pz = z;
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.05 - i * 0.008, 0.07 - i * 0.01, rnd(0.3, 0.55), 7), mat);
        seg.position.set(px, py, pz);
        seg.rotation.set(rnd(-0.5, 0.5), rnd(0, 3), rnd(0.9, 1.4));
        grp.add(seg);
        px += rnd(-0.2, 0.2); py += rnd(0.02, 0.12); pz += rnd(-0.18, 0.18);
      }
    } else if (type === 'crystal') {
      const mat = new THREE.MeshToonMaterial({
        color: 0xB57CE0, gradientMap: gm, emissive: 0x7A4AB0, emissiveIntensity: 0.25, transparent: true, opacity: 0.92,
      });
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(rnd(0.05, 0.13), 0), mat);
        c.position.set(x + rnd(-0.2, 0.2), 0.08 + rnd(0, 0.18), z + rnd(-0.15, 0.15));
        c.scale.y = rnd(1.6, 2.6);
        c.rotation.y = rnd(0, 3);
        grp.add(c);
      }
      // 夜间点光源
      const pl = new THREE.PointLight(0xB57CE0, 0.2, 3.2, 1.5);
      pl.position.set(x, 0.3, z);
      grp.add(pl);
      grp.userData.crystalLight = pl;
      this.crystalLights.push(pl);
    } else if (type === 'sand' || type === 'clay' || type === 'blacksand') {
      // 底砂直接换色，不生成模型
      return null;
    } else if (type === 'coralsand') {
      // 珊瑚骨砂：浅色贝壳状碎块
      const mat = new THREE.MeshToonMaterial({ color: 0xF0E8D8, gradientMap: gm });
      for (let i = 0; i < 6; i++) {
        const r = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.05, 0.11), 6, 5), mat);
        r.position.set(x + rnd(-0.3, 0.3), 0.05, z + rnd(-0.22, 0.22));
        r.scale.y = rnd(0.4, 0.7);
        grp.add(r);
      }
    } else {
      const mat = new THREE.MeshToonMaterial({ color: 0x8A9AAA, gradientMap: gm });
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), mat);
      r.position.set(x, 0.1, z);
      grp.add(r);
    }
    grp.position.y = 0;
    grp.traverse((o) => { o.userData.item = { kind: 'hardscape', type, x, z }; });
    this.scene.add(grp);
    return grp;
  }

  addEquipment(type, slot) {
    const gm = this._gm();
    const grp = new THREE.Group();
    if (type === 'filter') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.22),
        new THREE.MeshToonMaterial({ color: 0x2E3A46, gradientMap: gm }));
      body.position.set(T.w / 2 - 0.45, 0.32, -T.d / 2 + 0.2);
      grp.add(body);
      const out = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8),
        new THREE.MeshToonMaterial({ color: 0x4A9FD8, gradientMap: gm }));
      out.rotation.x = Math.PI / 2.4;
      out.position.set(T.w / 2 - 0.45, 0.55, -T.d / 2 + 0.45);
      grp.add(out);
    } else if (type === 'heater') {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10),
        new THREE.MeshToonMaterial({ color: 0xBFE8F5, gradientMap: gm, transparent: true, opacity: 0.6 }));
      h.position.set(-T.w / 2 + 0.18, 0.5, -T.d / 2 + 0.18);
      grp.add(h);
      this.heaterGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.4, 8),
        new THREE.MeshBasicMaterial({ color: 0xFF5A3A }));
      this.heaterGlow.position.copy(h.position);
      grp.add(this.heaterGlow);
    } else if (type === 'lamp') {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.18),
        new THREE.MeshToonMaterial({ color: 0x2E3A46, gradientMap: gm }));
      strip.position.set(0, T.wallH + 0.09, 0.3);
      grp.add(strip);
      this.lampStripMat = new THREE.MeshBasicMaterial({ color: 0xFFF2DC });
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.12), this.lampStripMat);
      bulb.position.set(0, T.wallH + 0.05, 0.3);
      grp.add(bulb);
    } else if (type === 'co2') {
      const tank2 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10),
        new THREE.MeshToonMaterial({ color: 0x3A5A3A, gradientMap: gm }));
      tank2.position.set(T.w / 2 - 0.3, 0.35, T.d / 2 - 0.2);
      grp.add(tank2);
      this._co2Pos = new THREE.Vector3(T.w / 2 - 0.3, 0.12, T.d / 2 - 0.2);
    } else if (type === 'pump') {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.18),
        new THREE.MeshToonMaterial({ color: 0x2E3A46, gradientMap: gm }));
      p.position.set(T.w / 2 - 0.25, 0.1, T.d / 2 - 0.2);
      grp.add(p);
      this._pumpPos = new THREE.Vector3(T.w / 2 - 0.25, 0.2, T.d / 2 - 0.2);
    } else if (type === 'feeder') {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.2),
        new THREE.MeshToonMaterial({ color: 0xD4A24C, gradientMap: gm }));
      f.position.set(-T.w / 2 + 0.35, T.wallH + 0.02, -0.2);
      grp.add(f);
    }
    grp.traverse((o) => { o.userData.equip = { kind: 'equip', type }; });
    this.scene.add(grp);
    return grp;
  }

  // ============================================================
  //  交互：水面拾取 / 涟漪 / 水花 / 气泡
  // ============================================================
  // 拾取缸内投放点：先与缸体包围盒求交（点击缸体任意位置都有效），
  // 再退化为与水面平面求交。返回点 y 统一为水面高度。
  pickWater(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this._ray = this._ray || new THREE.Raycaster();
    this._ray.setFromCamera(ndc, this.camera);
    if (!this._tankBox) {
      this._tankBox = new THREE.Box3(
        new THREE.Vector3(-T.w / 2, 0, -T.d / 2),
        new THREE.Vector3(T.w / 2, T.wallH, T.d / 2),
      );
    }
    const out = new THREE.Vector3();
    const hit = this._ray.ray.intersectBox(this._tankBox, out);
    if (hit) {
      hit.y = T.waterH;
      hit.x = clamp(hit.x, -(T.w / 2 - 0.4), T.w / 2 - 0.4);
      hit.z = clamp(hit.z, -(T.d / 2 - 0.35), T.d / 2 - 0.35);
      return hit;
    }
    // 退化：与水面平面求交（贴近缸体时才接受）
    this._plane = this._plane || new THREE.Plane(new THREE.Vector3(0, 1, 0), -T.waterH);
    const ph = this._ray.ray.intersectPlane(this._plane, out);
    if (!ph) return null;
    if (Math.abs(ph.x) > T.w / 2 + 1.2 || Math.abs(ph.z) > T.d / 2 + 1.2) return null;
    ph.x = clamp(ph.x, -(T.w / 2 - 0.4), T.w / 2 - 0.4);
    ph.z = clamp(ph.z, -(T.d / 2 - 0.35), T.d / 2 - 0.35);
    return ph;
  }

  addRipple(x, z, strength = 1) {
    const r = this.waterUniforms.uRipples.value[this.rippleIdx % 8];
    r.set(x, z, this.waterUniforms.uTime.value, strength);
    this.rippleIdx++;
  }

  splash(x, y, z) {
    this.addRipple(x, z, 1.2);
    for (let i = 0; i < 9; i++) {
      const s = this.splashes.find((p) => !p.active);
      if (!s) break;
      s.active = true;
      s.life = 0.55;
      s.mesh.visible = true;
      s.mesh.position.set(x, y, z);
      s.mesh.material = this.splashMat;
      const a = Math.random() * Math.PI * 2;
      const sp2 = 0.5 + Math.random() * 1.2;
      s.vx = Math.cos(a) * sp2 * 0.35;
      s.vy = 1.2 + Math.random() * 1.4;
      s.vz = Math.sin(a) * sp2 * 0.35;
    }
  }

  addBubble(x, y, z) {
    const b = this.bubbles.find((p) => !p.active);
    if (!b) return;
    b.active = true;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
    b.mesh.scale.setScalar(0.6 + Math.random() * 0.8);
    b.vy = 0.28 + Math.random() * 0.3;
    b.wob = Math.random() * 10;
    b.x = x; b.z = z;
  }

  setSelection(objs) {
    this.outline.selectedObjects = objs || [];
  }

  // ============================================================
  //  昼夜 / 低配降级
  // ============================================================
  setNightFactor(f) {
    this.nightF = f;
    const day = 1 - f;
    this.sun.intensity = 0.85 * day;
    this.sun.color.setHex(0xFFE8C8).lerp(new THREE.Color(0x9AB8E8), f);
    this.hemi.intensity = 0.24 * day + 0.16 * f;
    this.hemi.color.setHex(0xBFE8FF).lerp(new THREE.Color(0x3A5A8A), f);
    this.moonLight.intensity = 0.5 * f;
    this.shaftUniforms.uOpacity.value = this.lowSpec ? 0 : 0.18 * day * (this.game.equip.lamp || day > 0.05 ? 1 : 0.2);
    this.causticUniforms.uIntensity.value = this.lowSpec ? 0 : 0.34 * day + 0.06 * f;
    this.sky.material.uniforms.uNight.value = f;
    this.waterUniforms.uShallow.value.copy(C(0x6FD3E8)).lerp(C(0x2A5A8A), f * 0.8);
    this.waterUniforms.uSunDir.value.set(0.5, 0.85 - f * 0.6, 0.3).normalize();
    // 水晶簇夜间自发光
    for (const pl of this.crystalLights) pl.intensity = 0.2 + 1.6 * f;
    // 夜灯蓝色环境
    this.amb.intensity = 0.12 + 0.1 * f;
    this.amb.color.setHex(f > 0.5 ? 0x6A8AC8 : 0xFFFFFF);
  }

  setLowSpec(b) {
    this.lowSpec = b;
    this.bloom.enabled = !b;
    this.vignette.enabled = !b;
    this.causticUniforms.uIntensity.value = b ? 0 : 0.34 * (1 - this.nightF);
    this.shaftUniforms.uOpacity.value = b ? 0 : 0.18 * (1 - this.nightF);
    // 玻璃改为廉价半透明
    const glass = this.tankGroup.children[0];
    if (glass && glass.isMesh) {
      glass.material = b ? this.glassMatLite : this.glassMat;
      if (b) glass.material.needsUpdate = true;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, b ? 1 : 2));
    this.onResize();
  }

  setSubstrateColor(hex) {
    this.sandMat.color.set(hex);
  }

  setLamp(colorTemp, intensity) {
    const on = this.game.equip.lamp;
    // 色温（K）近似 RGB
    const t = colorTemp / 100;
    let r, g, b;
    if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
    else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
    const col = new THREE.Color(clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255).convertSRGBToLinear();
    this.lampLight.color.copy(col);
    this.lampLight.intensity = on ? intensity * 2.4 : 0;
    if (this.lampStripMat) this.lampStripMat.color.copy(col);
    if (this.heaterGlow) this.heaterGlow.visible = this.game.equip.heater;
  }

  // ============================================================
  //  相机预设（平滑插值 easeInOutCubic）
  // ============================================================
  static PRESETS = {
    overview: { pos: [0, 3.6, 8.0], target: [0, 1.05, 0] },
    macro: { pos: [2.1, 1.75, 3.7], target: [0.35, 1.0, -0.15] },
    top: { pos: [0.01, 8.6, 0.01], target: [0, 0, 0] },
  };
  moveCameraTo(name) {
    const p = SceneManager.PRESETS[name];
    if (!p) return;
    this._camTween = {
      t: 0, dur: 1.2,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(...p.pos),
      fromTgt: this.controls.target.clone(),
      toTgt: new THREE.Vector3(...p.target),
    };
    this.controls.enabled = false;
  }

  // ============================================================
  //  每帧更新
  // ============================================================
  update(realDt, elapsed, game) {
    // 水面时间
    this.waterUniforms.uTime.value = elapsed;
    this.causticUniforms.uTime.value = elapsed;
    this.shaftUniforms.uTime.value = elapsed;
    // 相机补间
    if (this._camTween) {
      const tw = this._camTween;
      tw.t += realDt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTgt, tw.toTgt, e);
      if (k >= 1) { this._camTween = null; this.controls.enabled = true; }
    }
    this.controls.update();
    // 气泡上浮
    for (const b of this.bubbles) {
      if (!b.active) continue;
      b.mesh.position.y += b.vy * realDt;
      b.wob += realDt * 3;
      b.mesh.position.x = b.x + Math.sin(b.wob) * 0.03;
      if (b.mesh.position.y >= T.waterH - 0.03) {
        b.active = false; b.mesh.visible = false;
        this.addRipple(b.x, b.z, 0.35);
      }
    }
    // 水花粒子
    for (const s of this.splashes) {
      if (!s.active) continue;
      s.life -= realDt;
      if (s.life <= 0) { s.active = false; s.mesh.visible = false; continue; }
      s.vy -= 4.2 * realDt;
      s.mesh.position.x += s.vx * realDt;
      s.mesh.position.y += s.vy * realDt;
      s.mesh.position.z += s.vz * realDt;
      s.mesh.scale.setScalar(Math.max(0.05, s.life / 0.55));
    }
    // 光尘漂浮
    this.dust.rotation.y += realDt * 0.01;
    this.dust2.rotation.y -= realDt * 0.006;
    const dp = this.dust.geometry.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      const by = this._dustBase[i * 3 + 1];
      dp.setY(i, by + Math.sin(elapsed * 0.6 + i) * 0.12);
    }
    dp.needsUpdate = true;
    // 气泵 / CO2 气泡源
    if (game.equip.pump && Math.random() < realDt * 2.2) {
      this.addBubble(this._pumpPos.x + rand3(-0.05, 0.05), 0.15, this._pumpPos.z + rand3(-0.05, 0.05));
    }
    if (game.equip.co2 && Math.random() < realDt * 1.6) {
      this.addBubble(this._co2Pos.x + rand3(-0.04, 0.04), 0.12, this._co2Pos.z + rand3(-0.04, 0.04));
    }
  }

  render() { this.composer.render(); }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand3 = (a, b) => a + Math.random() * (b - a);
