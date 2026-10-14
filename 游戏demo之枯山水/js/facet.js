/* =========================================================================
 * facet.js —— 低多边形（low poly）粉彩风的两个小工具
 *
 * ★ 为什么需要它：低多边形的灵魂是「同一个颜色，但每个三角面略微不同」。
 *   这样即使几何很粗（二十面的石头、九棱的水钵），也能读出体积和光影，
 *   而不是一片死板的纯色。这也是把简陋几何变成「设计」的关键一招。
 *
 *   Facet.tint(geo, amp, seed)  给每个三角面写一份围绕 1.0 的顶点色
 *   Facet.apply(geo)            只改强度不重建几何 → 可以实时拖滑块
 *   Facet.outline(obj, s, col)  套一层「背面外扩」的描边（风格化最省事的一招）
 *
 * 注意：有索引的几何体（PlaneGeometry 等）会被先转成非索引，
 * 否则共用顶点会拿到同一个颜色、色块就被插值抹平了。
 * ========================================================================= */
(function () {
  'use strict';

  // 给每个三角面写一个围绕 1.0 的明度因子。
  // amp = 0 → 整片同色（等于关闭）；amp 大 → 色块感强、更像低多边形。
  // 因子存进 geo.userData.facet，之后调 Facet.apply 即可只改强度。
  function tint(geo, amp, seed) {
    // 索引几何要先拆开，否则顶点被多个面共用、颜色会被插值成渐变
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const fac = new Float32Array(n);
    let s = (seed >>> 0) || 1;
    // 线性同余随机：可复现（同一个 seed 永远得到同一块石头）
    const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let f = 0; f < n; f += 3) {
      const r = rnd();
      for (let k = 0; k < 3; k++) {
        fac[f + k] = r;
        col[(f + k) * 3] = 1; col[(f + k) * 3 + 1] = 1; col[(f + k) * 3 + 2] = 1;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.userData.facet = { fac: fac, amp: amp };
    apply(g);
    return g;
  }

  // 按 userData.facet 把顶点色重写一遍（强度可随时改，不动几何）
  function apply(geo) {
    const d = geo.userData && geo.userData.facet;
    if (!d) return;
    const col = geo.attributes.color, arr = col.array, fac = d.fac, amp = d.amp;
    for (let i = 0; i < fac.length; i++) {
      const v = 1 + (fac[i] - 0.5) * amp;
      arr[i * 3] = v; arr[i * 3 + 1] = v; arr[i * 3 + 2] = v;
    }
    col.needsUpdate = true;
  }

  // 描边：复制一份几何、整体外扩一点点、只用背面 + 纯色。
  // 于是从任何角度都看到一圈深色轮廓。作为子物体挂上去，会跟着父级变换。
  // noPick / noOutline 两种跳过标记：前者是描边自身，后者是"要拾取但别描边"（如水钵水面）
  function outline(obj, scale, color) {
    if (!(scale > 0) || !obj) return obj;
    const col = new THREE.Color(color);
    obj.traverse(function (c) {
      if (!c.isMesh || c.userData.noPick || c.userData.noOutline) return;
      const og = c.geometry.clone();
      if (og.attributes.color) og.deleteAttribute('color');   // 描边要纯色，不吃顶点色
      const om = new THREE.Mesh(og, new THREE.MeshBasicMaterial({
        color: col, side: THREE.BackSide }));
      om.scale.setScalar(scale);
      om.castShadow = false; om.receiveShadow = false;
      om.userData.noPick = true;          // 别让描边参与鼠标拾取
      c.add(om);
    });
    return obj;
  }

  KS.Facet = { tint: tint, apply: apply, outline: outline };
})();
