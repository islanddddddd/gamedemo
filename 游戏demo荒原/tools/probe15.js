// 探针 15：同一片世界、同一个会话里对比几种渲染配置的「聚合帧耗时」
// （聚合 150 帧取总时间，比单帧中位数稳得多）
// 用法：agent-browser eval "$(cat tools/probe15.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  Cam.zoom = 0.729;

  var base = JSON.parse(JSON.stringify(CFG.RENDER.detailCounts));

  function measure(label, n) {
    for (var w = 0; w < 6; w++) Render.frame(0.016, W, ctx, UI);   // 预热
    var t0 = performance.now();
    for (var k = 0; k < n; k++) Render.frame(0.016, W, ctx, UI);
    var total = performance.now() - t0;
    return label + ': 总 ' + total.toFixed(0) + 'ms / ' + n + ' 帧 = 每帧 ' + (total / n).toFixed(2) + 'ms';
  }

  var N = 150, out = [];

  // 1) 默认配置
  out.push(measure('① 默认（跳株+自适应细节）', N));

  // 2) 关跳株
  CFG.RENDER.detailCounts = Object.assign({}, base, { thinAt2: 1e9, thinAt3: 1e9 });
  out.push(measure('② 不跳株', N));

  // 3) 不降档也不会跳株（等于全细节）
  CFG.RENDER.detailCounts = Object.assign({}, base, { thinAt2: 1e9, thinAt3: 1e9, downTo1: 1e9, downTo0: 1e9 });
  out.push(measure('③ 全细节（基准）', N));

  // 4) 恢复默认，只关草
  CFG.RENDER.detailCounts = Object.assign({}, base);
  var og = Render._grass; Render._grass = function () {};
  out.push(measure('④ 默认但一株草都不画', N));
  Render._grass = og;

  CFG.RENDER.detailCounts = base;

  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return JSON.stringify({ plants: W.plants.length, counts: counts, out: out }, null, 1);
})()
