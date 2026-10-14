// 探针 10：同一片世界里做受控 A/B，定位「草」的真实开销
//   1) 现状（降档 + 抖动）
//   2) 换成旧的「细长叶片」降档形状
//   3) 完全不画草（其它一切照旧）—— 这是草的天花板
// 用法：agent-browser eval "$(cat tools/probe10.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);

  function measure(label, zoom) {
    Cam.zoom = zoom;
    for (var w = 0; w < 4; w++) Render.frame(0.016, W, ctx, UI);
    var times = [];
    for (var k = 0; k < 30; k++) {
      var a = performance.now();
      Render.frame(0.016, W, ctx, UI);
      times.push(performance.now() - a);
    }
    times.sort(function (x, y) { return x - y; });
    var avg = times.reduce(function (x, y) { return x + y; }, 0) / times.length;
    return label + ': avg ' + avg.toFixed(2) + 'ms  p95 ' + times[28].toFixed(2) + 'ms';
  }

  var results = [];
  var orig = Render._grass;

  // --- 1. 现状 ---
  [0.72, 1.30].forEach(function (z) { results.push(measure('现状  z=' + z, z)); });

  // --- 2. 旧降档形状 ---
  function oldFar(g, x, y, s, h, sa, l, grow, seed, sway, env, detail) {
    if (detail !== 0) return orig.call(Render, g, x, y, s, h, sa, l, grow, seed, sway, env, detail);
    var len = (9 + grow * 12) * s;
    var w = 2.2 * s + 1.0;
    g.fillStyle = env.col(h, sa, l, 0.8);
    g.beginPath();
    g.moveTo(x - w, y);
    g.quadraticCurveTo(x + sway * w * 2, y - len * 0.95, x + w, y);
    g.closePath(); g.fill();
  }
  Render._grass = oldFar;
  [0.72, 1.30].forEach(function (z) { results.push(measure('旧形状 z=' + z, z)); });

  // --- 3. 完全不画草 ---
  Render._grass = function () {};
  [0.72, 1.30].forEach(function (z) { results.push(measure('无草  z=' + z, z)); });

  Render._grass = orig;

  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return JSON.stringify({ plants: W.plants.length, counts: counts, results: results }, null, 1);
})()
