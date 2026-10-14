// 探针 FPS：真实帧率（必须有头模式跑，无头模式 rAF 会被节流）
// 用法：agent-browser eval "$(cat tools/probe_fps.js)"
new Promise(function (resolve) {
  var W = Game.world;
  var gaps = [], t0 = 0, last = 0, stop = false;
  var realFrame = Render.frame.bind(Render);
  var renderMs = [];
  Render.frame = function () {
    var a = performance.now();
    realFrame.apply(null, arguments);
    renderMs.push(performance.now() - a);
  };
  function loop(now) {
    if (!t0) { t0 = now; last = now; }
    gaps.push(now - last); last = now;
    if (now - t0 < 4000) { requestAnimationFrame(loop); return; }
    Render.frame = realFrame;
    gaps.sort(function (a, b) { return a - b; });
    renderMs.sort(function (a, b) { return a - b; });
    var n = gaps.length, m = renderMs.length;
    var sum = gaps.reduce(function (a, b) { return a + b; }, 0);
    resolve(JSON.stringify({
      plants: W.plants.length,
      zoom: +Cam.zoom.toFixed(2),
      frames: n,
      fps: +(1000 / (sum / n)).toFixed(1),
      gap_p50: +gaps[(n * 0.5) | 0].toFixed(1),
      gap_p95: +gaps[(n * 0.95) | 0].toFixed(1),
      gap_max: +gaps[n - 1].toFixed(1),
      renderJS_p50: +renderMs[(m * 0.5) | 0].toFixed(1),
      renderJS_p95: +renderMs[(m * 0.95) | 0].toFixed(1),
      renderJS_max: +renderMs[m - 1].toFixed(1)
    }, null, 1));
  }
  requestAnimationFrame(loop);
})
