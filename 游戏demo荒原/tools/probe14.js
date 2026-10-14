// 探针 14：看每帧还分配多少内存（残留的毛刺多半是垃圾回收）
// 用法：agent-browser eval "$(cat tools/probe14.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  Cam.zoom = 0.72;
  var pm = performance.memory;
  if (!pm) return 'no performance.memory';
  for (var w = 0; w < 5; w++) Render.frame(0.016, W, ctx, UI);

  var times = [], allocs = [];
  for (var k = 0; k < 60; k++) {
    var h0 = pm.usedJSHeapSize;
    var a = performance.now();
    Render.frame(0.016, W, ctx, UI);
    var dt = performance.now() - a;
    var h1 = pm.usedJSHeapSize;
    times.push(dt); allocs.push(h1 - h0);
  }
  var sortedT = times.slice().sort(function (x, y) { return x - y; });
  var sortedA = allocs.slice().sort(function (x, y) { return x - y; });
  var avgA = allocs.reduce(function (x, y) { return x + y; }, 0) / allocs.length;

  // 再测一遍：不画植物
  var dp = Render.drawPlant; Render.drawPlant = function () {};
  for (var w2 = 0; w2 < 5; w2++) Render.frame(0.016, W, ctx, UI);
  var allocs2 = [];
  for (var k2 = 0; k2 < 60; k2++) {
    var h2 = pm.usedJSHeapSize;
    Render.frame(0.016, W, ctx, UI);
    allocs2.push(pm.usedJSHeapSize - h2);
  }
  Render.drawPlant = dp;
  var avgA2 = allocs2.reduce(function (x, y) { return x + y; }, 0) / allocs2.length;

  return JSON.stringify({
    plants: W.plants.length,
    frame_p50: +sortedT[30].toFixed(1),
    frame_max: +sortedT[59].toFixed(1),
    alloc_per_frame_drawPlant_on: Math.round(avgA) + ' B',
    alloc_per_frame_drawPlant_off: Math.round(avgA2) + ' B'
  }, null, 1);
})()
