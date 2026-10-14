// 探针 11：给 Render.frame 的各个阶段分别计时，找出真正的瓶颈
// 用法：agent-browser eval "$(cat tools/probe11.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);

  // 需要计时的阶段（写在 frame() 里被调用的方法）
  var stages = ['updateGround', 'drawWater', 'updateParticles', 'drawParticles', 'drawFog',
                'drawCursors', 'drawCursor', 'computeEnv', 'fogAmount'];
  var acc = {};
  stages.forEach(function (n) { acc[n] = { t: 0, n: 0 }; });

  stages.forEach(function (name) {
    if (typeof Render[name] !== 'function') return;
    var orig = Render[name];
    Render[name] = function () {
      var a = performance.now();
      var r = orig.apply(this, arguments);
      var d = performance.now() - a;
      acc[name].t += d; acc[name].n++;
      return r;
    };
  });

  var results = [];
  [0.72, 1.30].forEach(function (z) {
    Cam.zoom = z;
    for (var w = 0; w < 4; w++) Render.frame(0.016, W, ctx, UI);
    stages.forEach(function (n) { acc[n].t = 0; acc[n].n = 0; });
    var times = [];
    for (var k = 0; k < 30; k++) {
      var a = performance.now();
      Render.frame(0.016, W, ctx, UI);
      times.push(performance.now() - a);
    }
    var total = times.reduce(function (x, y) { return x + y; }, 0) / times.length;
    var line = 'z=' + z + '  total ' + total.toFixed(2) + 'ms | ';
    var sum = 0;
    stages.forEach(function (n) {
      if (!acc[n].n) return;
      var v = acc[n].t / acc[n].n;
      sum += v;
      if (v >= 0.3) line += n + ' ' + v.toFixed(1) + '  ';
    });
    line += '| 其余(主要是植物+' + (total - sum).toFixed(2) + 'ms)';
    results.push(line);
  });

  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return JSON.stringify({ plants: W.plants.length, counts: counts, tick: Game.time.tick, results: results }, null, 1);
})()
