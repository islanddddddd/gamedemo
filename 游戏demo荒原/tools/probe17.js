// 探针 17：同会话里对比几项改动对整帧耗时的影响（150 帧聚合）
//   ① 默认
//   ② 草不画影子（把影子门槛抬到很高）
//   ③ 关跳株（看跳株到底省了多少）
//   ④ 一株草都不画（草的总额）
// 用法：agent-browser eval "$(cat tools/probe17.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  Cam.zoom = 0.729;
  var shBase = CFG.RENDER.shadow.minHeightPx;
  var dcBase = JSON.parse(JSON.stringify(CFG.RENDER.detailCounts));

  function measure(label, n) {
    for (var w = 0; w < 6; w++) Render.frame(0.016, W, ctx, UI);
    var t0 = performance.now();
    for (var k = 0; k < n; k++) Render.frame(0.016, W, ctx, UI);
    return label + ': ' + ((performance.now() - t0) / n).toFixed(2) + 'ms/帧';
  }

  var N = 150, out = [];
  out.push(measure('① 默认', N));
  CFG.RENDER.shadow.minHeightPx = 1e9;
  out.push(measure('② 全部不画影子', N));
  CFG.RENDER.shadow.minHeightPx = shBase;
  CFG.RENDER.detailCounts = Object.assign({}, dcBase, { thinAt2: 1e9, thinAt3: 1e9 });
  out.push(measure('③ 不跳株', N));
  CFG.RENDER.detailCounts = Object.assign({}, dcBase);
  var og = Render._grass; Render._grass = function () {};
  out.push(measure('④ 不画草', N));
  Render._grass = og;

  CFG.RENDER.shadow.minHeightPx = shBase;
  CFG.RENDER.detailCounts = dcBase;
  return JSON.stringify({ plants: W.plants.length, out: out }, null, 1);
})()
