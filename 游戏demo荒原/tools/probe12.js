// 探针 12：把 updateGround / putImageData / 植物循环 分开单独计时（各跑 30 次取平均）
// 用法：agent-browser eval "$(cat tools/probe12.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  var out = [];

  function bench(label, fn, n) {
    fn(); fn(); fn(); fn();                       // 预热
    var t = [];
    for (var k = 0; k < n; k++) {
      var a = performance.now(); fn(); t.push(performance.now() - a);
    }
    t.sort(function (x, y) { return x - y; });
    var avg = t.reduce(function (x, y) { return x + y; }, 0) / t.length;
    out.push(label + ': avg ' + avg.toFixed(2) + '  p50 ' + t[(n / 2) | 0].toFixed(2) + '  max ' + t[n - 1].toFixed(2));
    return avg;
  }

  Cam.zoom = 0.72;
  bench('updateGround  单跑', function () { Render.updateGround(W, Render.env, ctx); }, 30);
  bench('putImageData  单跑', function () { Render.gndCtx.putImageData(Render.gndImg, 0, 0); }, 30);
  bench('computeEnv    单跑', function () { Render.computeEnv(ctx.dayFrac, ctx.season); }, 30);

  // drawImage 把 100x72 的地面图放大铺开
  var g = Render.g;
  bench('drawImage 地面 单跑', function () {
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(Render.gnd, 0, 0, W.cols, W.rows, 0, 0, Cam.vw, Cam.vh);
    g.restore();
  }, 30);

  // 整帧
  bench('Render.frame  整帧', function () { Render.frame(0.016, W, ctx, UI); }, 30);

  // 关掉 updateGround 后的整帧
  var og = Render.updateGround;
  Render.updateGround = function () {};
  bench('整帧(跳过地面重算)', function () { Render.frame(0.016, W, ctx, UI); }, 30);
  Render.updateGround = og;

  return JSON.stringify({ plants: W.plants.length, tick: Game.time.tick, out: out }, null, 1);
})()
