(function(){
  var W = Game.world;
  var ORDER = ['tree','shrub','flower','grass','moss','lichen','rock'];
  ORDER.forEach(function(id){ Game.unlocked.add(id); });
  UI.refresh(Game.unlocked, null);

  function sow(id) {
    var si = SP_INDEX[id];
    var best = -1, bestSuit = 0.05;
    for (var t = 0; t < 80; t++) {
      var gx = 12 + ((Math.random() * 76) | 0);
      var gy = 10 + ((Math.random() * 54) | 0);
      if (!W.canSow(gx, gy, id)) continue;
      var s = W.suitAt(si, W.idx(gx, gy), 0);
      if (s > bestSuit) { bestSuit = s; best = W.idx(gx, gy); }
    }
    if (best >= 0) W.plant(best % W.cols, (best / W.cols) | 0, id);
  }

  // 模拟一个玩家的节奏：早期猛种先锋，中期换灌木，后期种树
  for (var t = 1; t <= 9000; t++) {
    var every = t < 500 ? 8 : (t < 2000 ? 30 : 110);
    if (t % every === 0) {
      if (t < 900) sow('grass');
      else if (t < 2600) sow('shrub');
      else sow('tree');
      if (t % (every * 3) === 0) sow('flower');
    }
    Game.tick();
  }
  var out = {
    total: W.plants.length,
    grass: W.count('grass'), shrub: W.count('shrub'), tree: W.count('tree'),
    flower: W.count('flower'), fern: W.count('fern'), moss: W.count('moss'),
    reed: W.count('reed'), mushroom: W.count('mushroom'),
    forestness: +W.forestness.toFixed(3), hasWater: W.hasWater, maxNut: +W.maxNut.toFixed(3),
    seen: Array.from(W.seenSpecies)
  };
  // 把镜头对准植被最密的地方，好让截图有东西看
  var bestI = 0, bestV = -1;
  for (var i = 0; i < W.n; i++) { var v = W.carpet[i] + W.shade[i]; if (v > bestV) { bestV = v; bestI = i; } }
  if (typeof Cam !== 'undefined') {
    Cam.x = ((bestI % W.cols) + 0.5) * CFG.WORLD.cell;
    Cam.y = (((bestI / W.cols) | 0) + 0.5) * CFG.WORLD.cell * CFG.RENDER.ySquash;
    Cam.zoom = 1.35;
  }
  return JSON.stringify(out);
})()
