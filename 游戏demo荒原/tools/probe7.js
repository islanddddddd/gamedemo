// 探针 7：用「固定种子」搭一片荒地并快进到成林，供 A/B 对比（保证两次跑的是同一片世界）
// 用法：agent-browser eval "$(cat tools/probe7.js)"
(function () {
  var SEED = 4242;
  // 连 Math.random 也换成可复现的 —— 野生物种是随机抽的，
  // 不锁住它，两次跑出来的世界就不一样，A/B 对比就没意义了。
  Math.random = U.mulberry32(SEED ^ 0x5bf03635);
  var rnd = U.mulberry32(SEED ^ 0x9e3779b9);
  var W = new World(SEED);
  Game.world = W;
  Game.seed = SEED;
  Game.unlocked = new Set(['lichen', 'grass', 'shrub', 'tree', 'fern', 'moss', 'reed', 'mushroom', 'flower', 'rock']);
  Game.time.tick = 0;
  Game.time.dayInSeason = 1;
  Game.time.season = 1;
  Game.time.dayFrac = 0.40;

  function sow(id) {
    var si = SP_INDEX[id], best = -1, bestSuit = 0.05;
    for (var t = 0; t < 80; t++) {
      var gx = 8 + ((rnd() * 84) | 0), gy = 6 + ((rnd() * 60) | 0);
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
  // 快进会把时间推到很远，截图前把钟拨回夏天上午（不然拍到的是冬天枯黄的样子）
  // 注意 dayInSeason 是「这一季的第几天」，一季只有 CFG.TIME.daysPerSeason 天，
  // 超出范围会让季节色的插值溢出。
  Game.time.season = 1;                 // 夏
  Game.time.dayInSeason = 1.5;          // 正好在夏天中间
  Game.time.dayFrac = 0.42;
  Game.centerCam();

  var counts = {};
  for (var i = 0; i < W.plants.length; i++) {
    var id = W.plants[i].sp.id;
    counts[id] = (counts[id] || 0) + 1;
  }
  return JSON.stringify({ plants: W.plants.length, counts: counts, tick: Game.time.tick, zoom: +Cam.zoom.toFixed(3) });
})()
