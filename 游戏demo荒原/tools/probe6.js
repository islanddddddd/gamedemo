// 探针 6：同步直测 Render.frame 真实耗时（不依赖 requestAnimationFrame 节流）
(function () {
  var W = Game.world;
  ['tree', 'shrub', 'flower', 'grass', 'moss', 'lichen', 'rock'].forEach(function (id) { Game.unlocked.add(id); });
  function sow(id) {
    var si = SP_INDEX[id], best = -1, bestSuit = 0.05;
    for (var t = 0; t < 80; t++) {
      var gx = 8 + ((Math.random() * 84) | 0), gy = 6 + ((Math.random() * 60) | 0);
      if (!W.canSow(gx, gy, id)) continue;
      var s = W.suitAt(si, W.idx(gx, gy), 0);
      if (s > bestSuit) { bestSuit = s; best = W.idx(gx, gy); }
    }
    if (best >= 0) W.plant(best % W.cols, (best / W.cols) | 0, id);
  }
  for (var t = 1; t <= 7000; t++) {
    var every = t < 500 ? 8 : (t < 2000 ? 30 : 110);
    if (t % every === 0) {
      if (t < 900) sow('grass'); else if (t < 2600) sow('shrub'); else sow('tree');
    }
    Game.tick();
  }
  Game.time.dayFrac = 0.40; Game.time.season = 1; Game.time.dayInSeason = 1;
  Game.centerCam();

  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }

  var out = { plants: W.plants.length, counts: counts, tick: Game.time.tick, zoom: {} };
  var ctx = Game.buildCtx(1);

  // 两种视角各测一遍：全景（被降档）与贴近（全细节）
  [['全景', 0.72], ['近景', 1.30]].forEach(function (pair) {
    Cam.zoom = pair[1];
    Game.centerCam(); Cam.zoom = pair[1];
    for (var w = 0; w < 4; w++) Render.frame(0.016, W, ctx, UI);   // 预热（含纹理/缓存建立）
    var times = [];
    for (var k = 0; k < 40; k++) {
      var a = performance.now();
      Render.frame(0.016, W, ctx, UI);
      times.push(performance.now() - a);
    }
    times.sort(function (x, y) { return x - y; });
    var avg = times.reduce(function (x, y) { return x + y; }, 0) / times.length;
    out.zoom[pair[0]] = {
      zoom: pair[1],
      avg: +avg.toFixed(2), p50: +times[20].toFixed(2), max: +times[39].toFixed(2),
      fps: +(1000 / avg).toFixed(1)
    };
  });

  return JSON.stringify(out);
})()
