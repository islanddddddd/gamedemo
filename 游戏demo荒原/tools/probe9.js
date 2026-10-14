// 探针 9：对「当前这片世界」同步直测 Render.frame 真实耗时（不依赖 rAF）
// 用法：agent-browser eval "$(cat tools/probe9.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }
  var out = { plants: W.plants.length, counts: counts, tick: Game.time.tick, zoom: {} };
  [['全景', 0.72], ['中景', 1.00], ['近景', 1.30]].forEach(function (pair) {
    Cam.zoom = pair[1];
    for (var w = 0; w < 4; w++) Render.frame(0.016, W, ctx, UI);
    var times = [];
    for (var k = 0; k < 36; k++) {
      var a = performance.now();
      Render.frame(0.016, W, ctx, UI);
      times.push(performance.now() - a);
    }
    times.sort(function (x, y) { return x - y; });
    var avg = times.reduce(function (x, y) { return x + y; }, 0) / times.length;
    out.zoom[pair[0]] = { z: pair[1], avg: +avg.toFixed(2), p95: +times[34].toFixed(2), fps: +(1000 / avg).toFixed(1) };
  });
  return JSON.stringify(out);
})()
