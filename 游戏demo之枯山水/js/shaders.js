/* =========================================================================
 * shaders.js —— 全部 GLSL
 *
 * ★★ 这里是新版的核心思路，和老版本有本质区别 ★★
 *
 * 老版本：追踪流线 → 画出一条条线。
 * 新版本：直接在着色器里逐像素求「流函数 ψ」，然后
 *
 *        高度 = 沟的横截面( fract( ψ / 间距 ) )
 *
 *   因为 ψ 的等值线就是流线，所以 fract(ψ/间距) 天然就是一排排等间距、
 *   完美光滑、绕着石头走的砂纹 —— 不需要追踪任何一条线。
 *
 * 这样做的好处：
 *   1. 纹路永远是光滑连续的，不会有描边毛刺
 *   2. 重算是在 GPU 上做一次全屏 pass，几乎不要时间 —— 拖石头时纹路
 *      可以每帧实时跟着变，手感完全不一样
 *   3. "重新淌过一遍"的动画变成一道沿水流方向扫过的新旧混合前沿
 *
 * ψ 的组成（和 CPU 版完全一致的数学）：
 *   ① 均匀流   ψ = BX·z − BZ·x
 *   ② 石头     ψ -= str · taper · η / ρ²       （椭圆偶极子，椭圆跟着朝向转）
 *              其中下游做了坐标压缩 ξ' = ξ/λ，这就是尾流
 *   ③ 水钵     环带内把 ψ 换成「到中心的距离」→ 自然变成同心圆
 *   ④ 苔藓     同石头但没有尾流
 * ========================================================================= */
(function () {
  'use strict';

  const MAXOBJ = 32;

  /* ---------------------------------------------------------------
   *  公共：哈希 / 值噪声 / fbm
   * --------------------------------------------------------------- */
  const NOISE = `
float h21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p){
  return 0.55 * vn(p) + 0.28 * vn(p * 2.03 + 11.7) + 0.17 * vn(p * 4.11 - 5.3);
}
`;

  /* ---------------------------------------------------------------
   *  流函数 ψ
   *  p = (x, z) 世界平面坐标。注意 GLSL 里 p.y 就是世界 z。
   * --------------------------------------------------------------- */
  const PSI = `
#define MAXOBJ ${MAXOBJ}
uniform int   uCount;
uniform vec4  uOA[MAXOBJ];   // 位置(cx,cz) + 影响椭圆半轴(A,B)
uniform vec4  uOB[MAXOBJ];   // cosA, sinA, blx, blz        （本地流向）
uniform vec4  uOC[MAXOBJ];   // nlx, nlz, L, wake
uniform vec4  uOD[MAXOBJ];   // str, inA, outA, kind  kind: 1=石/苔 2=水钵
uniform vec2  uBDir;         // 基础流向 (BX, BZ)
uniform float uWobble, uWobbleFreq;

float taperF(float r2, float inA, float outA){
  if (r2 <= inA) return 1.0;
  if (r2 >= outA) return 0.0;
  float t = (r2 - inA) / (outA - inA);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}

float psiAt(vec2 p){
  // ① 均匀流
  float v = uBDir.x * p.y - uBDir.y * p.x;

  // ② 偶极子（石头 / 苔藓 / 水钵外圈）
  for (int i = 0; i < MAXOBJ; i++){
    if (i >= uCount) break;
    vec4 A = uOA[i], B = uOB[i], C = uOC[i], D = uOD[i];
    vec2 d = p - A.xy;
    float reach = sqrt(D.z);
    float maxR = max(A.z, A.w) * reach * (1.0 + C.w) + 4.0;
    if (dot(d, d) > maxR * maxR) continue;

    if (D.w > 1.5){
      // 水钵：圆形的偶极子，把外面的直线挡在环带之外
      float R = A.z;
      float rho2 = dot(d, d) / (R * R);
      if (rho2 < 0.02) continue;
      float t = taperF(rho2, D.y, D.z);
      if (t <= 0.0) continue;
      float eta = d.x * (-uBDir.y) + d.y * uBDir.x;
      v -= t * eta / rho2;
      continue;
    }

    // 下游压缩：把石头下游的坐标沿流向压扁 → 影响范围向下游拉长 → 尾流
    vec2 dd = d;
    if (C.w > 0.0){
      float xi = d.x * uBDir.x + d.y * uBDir.y;
      float u = xi / C.z;
      float z = u - 0.8;
      float s = 0.5 + 0.5 * z / sqrt(z * z + 0.36);
      float lam = 1.0 + C.w * s;
      dd += uBDir * xi * (1.0 / lam - 1.0);
    }

    // 转到石头本地坐标（长轴 = x）
    float qx = dd.x * B.x + dd.y * B.y;
    float qz = -dd.x * B.y + dd.y * B.x;
    float rho2 = (qx * qx) / (A.z * A.z) + (qz * qz) / (A.w * A.w);
    if (rho2 < 0.02) continue;
    float t = taperF(rho2, D.y, D.z);
    if (t <= 0.0) continue;
    float eta = qx * C.x + qz * C.y;
    v -= D.x * t * eta / rho2;
  }

  // ③ 水钵环带内：把 ψ 换成"到中心的距离" → 纹路自然变成同心圆
  for (int i = 0; i < MAXOBJ; i++){
    if (i >= uCount) break;
    vec4 A = uOA[i], D = uOD[i];
    if (D.w < 1.5) continue;
    vec2 d = p - A.xy;
    float dist = length(d);
    float R = A.z;
    if (dist > R) continue;
    float g = 1.0 - smoothstep(R * 0.62, R * 0.99, dist);
    v = mix(v, dist, g);
  }

  // 手作感：给 ψ 加一点低频扰动，纹路就不会像尺子画的
  if (uWobble > 0.0){
    v += (fbm2(p * uWobbleFreq + 21.3) - 0.5) * 2.0 * uWobble;
  }
  return v;
}
`;

  /* ---------------------------------------------------------------
   *  高度场 pass：把 ψ 变成砂面高度，渲到一张离屏纹理上
   * --------------------------------------------------------------- */
  const FIELD_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

  const FIELD_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2  uOrigin, uSize;      // 砂面在世界里的范围
uniform float uSpacing, uDepth, uRidge, uGrooveSharp, uRidgeSoft;
uniform float uPressDepth, uPressRise;
${NOISE}
${PSI}

// 物件压进砂里：中心陷下去，周围一圈被挤起来
float pressAt(vec2 p){
  float t = 0.0;
  for (int i = 0; i < MAXOBJ; i++){
    if (i >= uCount) break;
    vec4 A = uOA[i], D = uOD[i];
    if (D.w < 0.5) continue;             // 苔藓是贴地的，不压砂
    vec2 d = p - A.xy;
    float R = max(A.z, A.w);
    float q = length(d) / max(R, 0.001);
    if (q > 2.4) continue;
    float a = q / 0.95;                  // 坑
    float b = (q - 1.18) / 0.6;          // 环
    t += -uPressDepth * exp(-a * a) + uPressRise * exp(-b * b);
  }
  return t;
}

void main(){
  vec2 p = uOrigin + vUv * uSize;        // uv → 世界平面坐标

  // —— 沟：ψ 每前进一个"间距"就是一条沟 ——
  float t = fract(psiAt(p) / uSpacing);
  float c = cos(6.2831853 * t);          // 沟心 = 1，脊顶 = -1
  float h;
  if (c > 0.0) h = -uDepth * pow(c, uGrooveSharp);
  else         h =  uRidge * pow(-c, uRidgeSoft);

  h += pressAt(p);
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}
`;

  /* ---------------------------------------------------------------
   *  手耙的笔刷：一小片"沟"的横截面，沿笔画方向叠进 rake 纹理
   * --------------------------------------------------------------- */
  const BRUSH_VERT = `
uniform vec2 uOrigin, uSize;
varying vec2 vUv;
void main(){
  vUv = uv;
  // 手耙笔刷直接按世界 XZ 映射进 rake 纹理（不受相机影响）
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 c = (wp.xz - uOrigin) / uSize * 2.0 - 1.0;
  gl_Position = vec4(c.x, c.y, 0.0, 1.0);
}
`;
  const BRUSH_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uDepth, uRidge, uWidth;
void main(){
  // vUv 是以笔刷中心为 (0.5,0.5) 的小方块；沟沿 u 方向延伸，v 是横向
  float tv = (vUv.y - 0.5) * 2.0;                 // -1..1 横向
  float tu = (vUv.x - 0.5) * 2.0;
  float r = sqrt(tu * tu + tv * tv);
  if (r > 1.0) discard;
  float q = tv / uWidth;
  float core = exp(-q * q * 4.0);                 // 沟
  float side = exp(-(abs(tv) - uWidth * 1.9) * (abs(tv) - uWidth * 1.9) * 5.0);
  float h = -uDepth * core + uRidge * side;
  float edge = 1.0 - smoothstep(0.75, 1.0, r);    // 边缘收一收，叠起来才顺
  gl_FragColor = vec4(h * edge, 0.0, 0.0, 1.0);
}
`;

  /* ---------------------------------------------------------------
   *  砂面材质：把高度场贴到 MeshStandardMaterial 上
   * --------------------------------------------------------------- */
  /* ---------------------------------------------------------------
   *  砂面材质
   *  顶点：按高度场把 y 顶起来
   *  片元：用高度场的差分重算法线（这才是沟看起来有深浅的原因）
   * --------------------------------------------------------------- */

  // 顶点/片元共用的声明与函数（两边都声明全部 uniform，未使用的会被编译器丢掉）
  const SAND_COMMON = `
varying vec2 vSuv;
varying vec2 vWorldXZ;
uniform sampler2D uFieldNew, uFieldOld, uRake;
uniform vec2  uOrigin, uSize;
uniform float uWipe, uWipeR, uWipeSoft, uAnim;
uniform vec2  uWipeC, uWipeDir;
uniform float uCrest, uCrestW;
uniform float uUndAmp, uUndFreq;
uniform float uHeightScale;
uniform float uTexel;
uniform float uNormalStrength, uGrainScale, uGrainAmp;
uniform float uSpacing;          // 纹路间距（用于抗锯齿的 LOD 判定）
uniform vec3  uRippleTint;       // 纹路色：粉彩风里沟不是阴影，是一道浅浅的色带
uniform float uRippleMix;        // 纹路着色强度
uniform sampler2D uCoverage;     // 院子多边形遮罩：外面丢弃
${NOISE}

// 自动生成的沟：在新旧两张高度场之间，按一道沿水流方向移动的前沿混合
float grooveH(vec2 suv){
  float hN = texture2D(uFieldNew, suv).r;
  float hO = texture2D(uFieldOld, suv).r;
  if (uAnim < 0.5) return hN;
  vec2 p = uOrigin + suv * uSize;
  float w = dot(p - uWipeC, uWipeDir);
  float front = mix(-uWipeR, uWipeR, uWipe);
  float k = 1.0 - smoothstep(front - uWipeSoft, front + uWipeSoft, w);
  float h = mix(hO, hN, k);
  // 前沿那一道水脊 —— 看着像水刚淌过去
  float q = (w - front) / max(uCrestW, 0.001);
  h += uCrest * exp(-q * q);
  return h;
}

// 砂面总高度 = 自动纹路 + 手耙 + 大块起伏
float sandH(vec2 suv){
  float h = grooveH(suv) + texture2D(uRake, suv).r;
  vec2 p = uOrigin + suv * uSize;
  h += (fbm2(p * uUndFreq + 3.7) - 0.5) * 2.0 * uUndAmp;
  return h;
}
`;

  const SAND_VERT_HEAD = SAND_COMMON;

  // 抗锯齿辅助：只在片元里定义（fwidth 只存在于片元着色器）。
  // 算"一个屏幕像素横跨多少世界单位"，当它接近/超过纹路间距时，逐像素采样
  // 沟纹会产生摩尔纹（远处/掠射处一道道黑纹），此时把纹路的明暗调制淡出。
  const RIPPLE_AA = `
float rippleAA(){
  vec2 fw = fwidth(vSuv) * uSize;   // 世界单位 / 像素
  float foot = max(fw.x, fw.y);
  return 1.0 - smoothstep(uSpacing * 0.5, uSpacing * 1.15, foot);
}
`;
  const SAND_FRAG_HEAD = SAND_COMMON + '\n' + RIPPLE_AA;

  // 注入到 #include <begin_vertex> 之后
  const SAND_VERT_BODY = `
  vWorldXZ = position.xz;
  vSuv = (position.xz - uOrigin) / uSize;
  transformed.y += sandH(vSuv) * uHeightScale;
`;

  // 注入到 #include <normal_fragment_maps> 的位置：重算法线
  // ★ 关键：Three 里 normal 变量是【视图空间】的，而我们用世界空间高度差算出的是
  //   【世界空间】法线，必须用 viewMatrix 转过去再赋值，否则整片砂会被当成斜的 → 发暗。
  const SAND_FRAG_NORMAL = `
  {
    float aa = rippleAA();
    vec2 e = vec2(uTexel, 0.0);
    float hL = sandH(vSuv - e.xy);
    float hR = sandH(vSuv + e.xy);
    float hD = sandH(vSuv - e.yx);
    float hU = sandH(vSuv + e.yx);
    float dxw = 2.0 * uTexel * uSize.x;
    float dzw = 2.0 * uTexel * uSize.y;
    vec3 nw = normalize(vec3(
      -(hR - hL) / dxw * uNormalStrength * aa,
      1.0,
      -(hU - hD) / dzw * uNormalStrength * aa));
    // 细颗粒：一层高频噪声，让砂在近处也是"砂"，不是塑料
    vec2 gp = vWorldXZ * uGrainScale;
    nw = normalize(nw + vec3((vn(gp) - 0.5) * uGrainAmp, 0.0, (vn(gp + 17.3) - 0.5) * uGrainAmp));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
`;

  // 纹路的着色：粉彩风不靠 AO 把沟压暗（那样会显脏、显写实），
  // 而是把凹下去的部分慢慢混向一道暖褐色带 —— 纹路因此成为"画上去的色带"。
  // 以 1.0 为基准 → 平地完整保留基色；越凹越向纹路色靠。
  // 注入到 #include <color_fragment> 之后（此时 diffuseColor 已就绪）
  const SAND_FRAG_TINT = `
  {
    float hh = sandH(vSuv);
    // hh 在沟心约为 -depth，这里按深度归一，所以调沟深不会改变着色浓度
    float k = clamp(-hh * uRippleMix * 6.0, 0.0, 1.0) * rippleAA();
    diffuseColor.rgb = mix(diffuseColor.rgb, uRippleTint, k);
  }
`;

  KS.Shaders = {
    MAXOBJ: MAXOBJ,
    NOISE: NOISE,
    PSI: PSI,
    FIELD_VERT: FIELD_VERT,
    FIELD_FRAG: FIELD_FRAG,
    BRUSH_VERT: BRUSH_VERT,
    BRUSH_FRAG: BRUSH_FRAG,
    SAND_VERT_HEAD: SAND_VERT_HEAD,
    SAND_FRAG_HEAD: SAND_FRAG_HEAD,
    SAND_VERT_BODY: SAND_VERT_BODY,
    SAND_FRAG_NORMAL: SAND_FRAG_NORMAL,
    SAND_FRAG_TINT: SAND_FRAG_TINT,
  };
})();
