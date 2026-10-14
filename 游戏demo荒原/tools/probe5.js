// 探针 5：快进到成林 -> 全景 -> 测「真实渲染耗时」与帧率 -> 返回统计
// 用法：agent-browser eval "$(cat tools/probe5.js)"
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
  Cam.zoom = 0.72;      // 全景

  // 统计各物种数量
  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }

  // 包一层 Render.frame 量真实耗时
  var realFrame = Render.frame.bind(Render);
  var times = [];
  Render.frame = function () {
    var a = performance.now();
    realFrame.apply(null, arguments);
    times.push(performance.now() - a);
  };

  return new Promise(function (resolve) {
    var frames = 0, t0 = 0, lastT = 0, rafGaps = [];
    function loop(now) {
      if (!t0) { t0 = now; lastT = now; }
      rafGaps.push(now - lastT); lastT = now;
      frames++;
      if (now - t0 < 2400) { requestAnimationFrame(loop); return; }
      Render.frame = realFrame;
      times.sort(function (a, b) { return a - b; });
      rafGaps.sort(function (a, b) { return a - b; });
      var avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
      resolve(JSON.stringify({
        renderMsAvg: +avg.toFixed(2),
        renderMsP50: +times[(times.length * 0.5) | 0].toFixed(2),
        renderMsP95: +times[(times.length * 0.95) | 0].toFixed(2),
        renderMsMax: +times[times.length - 1].toFixed(2),
        rafFps: +(1000 / (rafGaps.reduce(function (a, b) { return a + b; }, 0) / rafGaps.length)).toFixed(1),
        plants: W.plants.length,
        counts: counts,
        zoom: +Cam.zoom.toFixed(3),
        tick: Game.time.tick
      }));
    }
    requestAnimationFrame(loop);
  });
})()
