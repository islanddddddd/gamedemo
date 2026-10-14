// 探针 16：把「草的 JS 计算」和「草的画布调用」分开量，看哪一半贵
// 用法：agent-browser eval "$(cat tools/probe16.js)"
(function () {
  var W = Game.world;
  var ctx = Game.buildCtx(1);
  var env = Render.env;
  Cam.zoom = 0.729;
  var g = Render.g;
  var N = 6000;
  var out = [];

  function bench(label, fn) {
    fn(); fn();
    var t0 = performance.now();
    for (var k = 0; k < N; k++) fn(k);
    out.push(label + ': ' + ((performance.now() - t0) / N * 1000).toFixed(2) + ' µs/株');
  }

  // A. 只算数值（抖动、取色），不碰画布
  var sink = 0;
  bench('A 只算数（hash+取色）', function (k) {
    var hs = k * 5.77;
    var jx = (U.hash01(hs) - 0.5) * 5;
    var jy = (U.hash01(hs + 4) - 0.5) * 2;
    var w = (1 + U.hash01(hs + 1) * 1.5);
    var hl = 10 * (0.4 + U.hash01(hs + 2) * 0.7);
    var bend = (U.hash01(hs + 3) - 0.5) * 1.6;
    var c = env.col(90 + (U.hash01(hs + 5) - 0.5) * 16, 55, 40 + U.hash01(hs + 6) * 13, 0.75);
    sink += jx + jy + w + hl + bend + c.length;
  });

  // B. 只画：常量颜色、固定形状，不算任何数
  bench('B 只画（固定形状+常量色）', function (k) {
    var x = (k % 100) * 8, y = ((k / 100) | 0) * 6;
    g.fillStyle = '#8a9a4e';
    g.beginPath();
    g.moveTo(x - 2, y);
    g.quadraticCurveTo(x + 1, y - 8, x + 2, y);
    g.closePath(); g.fill();
  });

  // C. 画 + 取色（颜色字符串有变化，走缓存）
  bench('C 画 + 循环取色', function (k) {
    var x = (k % 100) * 8, y = ((k / 100) | 0) * 6;
    g.fillStyle = env.col(88 + (k % 14), 55, 40, 0.75);
    g.beginPath();
    g.moveTo(x - 2, y);
    g.quadraticCurveTo(x + 1, y - 8, x + 2, y);
    g.closePath(); g.fill();
  });

  // D. 只画线（stroke 版本，2 档草）
  bench('D 只画（2 笔 stroke）', function (k) {
    var x = (k % 100) * 8, y = ((k / 100) | 0) * 6;
    g.strokeStyle = '#8a9a4e'; g.lineWidth = 0.8; g.lineCap = 'round';
    for (var j = 0; j < 2; j++) {
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 1, y - 5, x + 2, y - 8); g.stroke();
    }
  });

  return JSON.stringify({ plants: W.plants.length, out: out, sink: sink | 0 }, null, 1);
})()
