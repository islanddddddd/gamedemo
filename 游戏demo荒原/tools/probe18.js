// 探针 18：验证「每株换一次颜色」是不是真正的开销来源
//   关掉跳株，保持每帧都画满 ~6000 株草，只改「颜色变不变」这一个变量。
// 用法：agent-browser eval "$(cat tools/probe18.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  Cam.zoom = 0.729;
  var dcBase = JSON.parse(JSON.stringify(CFG.RENDER.detailCounts));
  CFG.RENDER.detailCounts = Object.assign({}, dcBase, { thinAt2: 1e9, thinAt3: 1e9 });  // 不跳株

  var oc = Render.computeEnv;

  function measure(label, n) {
    for (var w = 0; w < 6; w++) Render.frame(0.016, W, ctx, UI);
    var t0 = performance.now();
    for (var k = 0; k < n; k++) Render.frame(0.016, W, ctx, UI);
    return label + ': ' + ((performance.now() - t0) / n).toFixed(2) + 'ms/帧';
  }

  var N = 120, out = [];

  // ① 原样（每株颜色都不同）
  out.push(measure('① 原样：颜色逐株变化', N));

  // ② 所有植物用同一个颜色字符串
  var PAL1 = [];
  Render.computeEnv = function () {
    var e = oc.apply(this, arguments);
    e.col = function () { return 'rgb(120,140,70)'; };
    return e;
  };
  out.push(measure('② 全局单色', N));

  // ③ 6 色板（模拟少量颜色反复用）
  if (PAL1.length === 0) for (var i = 0; i < 6; i++) PAL1.push('rgb(' + (100 + i * 8) + ',' + (130 + i * 5) + ',70)');
  var n6 = 0;
  Render.computeEnv = function () {
    var e = oc.apply(this, arguments);
    e.col = function () { return PAL1[(n6++) % 6]; };
    return e;
  };
  out.push(measure('③ 只有 6 种颜色', N));

  // ④ 32 色板
  var PAL32 = [];
  for (var j = 0; j < 32; j++) PAL32.push('rgb(' + (95 + j) + ',' + (125 + (j % 7) * 4) + ',70)');
  var n32 = 0;
  Render.computeEnv = function () {
    var e = oc.apply(this, arguments);
    e.col = function () { return PAL32[(n32++) % 32]; };
    return e;
  };
  out.push(measure('④ 只有 32 种颜色', N));

  Render.computeEnv = oc;
  CFG.RENDER.detailCounts = dcBase;
  return JSON.stringify({ plants: W.plants.length, out: out }, null, 1);
})()
