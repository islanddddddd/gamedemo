// 探针 13：用「中位数」做鲁棒 A/B —— 逐个把绘制阶段掐掉，看谁在拖后腿 / 谁在制造毛刺
// 用法：agent-browser eval "$(cat tools/probe13.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  Cam.zoom = 0.72;

  function bench(label, n) {
    for (var w = 0; w < 3; w++) Render.frame(0.016, W, ctx, UI);
    var t = [];
    for (var k = 0; k < n; k++) {
      var a = performance.now(); Render.frame(0.016, W, ctx, UI); t.push(performance.now() - a);
    }
    t.sort(function (x, y) { return x - y; });
    var p = function (q) { return t[Math.min(n - 1, (n * q) | 0)].toFixed(1); };
    var avg = (t.reduce(function (x, y) { return x + y; }, 0) / n).toFixed(1);
    var spikes = t.filter(function (v) { return v > 50; }).length;
    return label + ':  p50 ' + p(0.5) + '  p90 ' + p(0.9) + '  p99 ' + p(0.99) + '  avg ' + avg +
           '  超50ms的帧 ' + spikes + '/' + n;
  }

  var N = 40;
  var out = [];
  out.push(bench('① 原样', N));

  var noopTargets = ['drawPlant', 'drawFog', 'drawParticles', 'updateParticles', 'drawWater', 'updateGround', 'drawCursor'];
  var saved = {};
  noopTargets.forEach(function (nm) { saved[nm] = Render[nm]; });

  noopTargets.forEach(function (nm) {
    if (typeof saved[nm] !== 'function') return;
    Render[nm] = function () {};
    out.push(bench('② 掐掉 ' + nm, N));
    Render[nm] = saved[nm];
  });

  // 全部掐掉：只剩循环 + 背景 + 地面贴图
  noopTargets.forEach(function (nm) { if (typeof saved[nm] === 'function') Render[nm] = function () {}; });
  out.push(bench('③ 全掐（地板）', N));
  noopTargets.forEach(function (nm) { Render[nm] = saved[nm]; });

  return JSON.stringify({ plants: W.plants.length, tick: Game.time.tick, out: out }, null, 1);
})()
