(function(){
  var W = Game.world;
  ['tree','shrub','flower','grass','moss','lichen','rock'].forEach(function(id){ Game.unlocked.add(id); });
  UI.refresh(Game.unlocked, null);

  function sow(id) {
    var si = SP_INDEX[id];
    var best = -1, bestSuit = 0.05;
    for (var t = 0; t < 80; t++) {
      var gx = 8 + ((Math.random() * 84) | 0);
      var gy = 6 + ((Math.random() * 60) | 0);
      if (!W.canSow(gx, gy, id)) continue;
      var s = W.suitAt(si, W.idx(gx, gy), 0);
      if (s > bestSuit) { bestSuit = s; best = W.idx(gx, gy); }
    }
    if (best >= 0) W.plant(best % W.cols, (best / W.cols) | 0, id);
  }

  for (var t = 1; t <= 11000; t++) {
    var every = t < 500 ? 8 : (t < 2000 ? 30 : 110);
    if (t % every === 0) {
      if (t < 900) sow('grass');
      else if (t < 2600) sow('shrub');
      else sow('tree');
      if (t % (every * 3) === 0) sow('flower');
    }
    Game.tick();
  }
  Game.centerCam();
  return JSON.stringify({
    total: W.plants.length, grass: W.count('grass'), shrub: W.count('shrub'), tree: W.count('tree'),
    flower: W.count('flower'), fern: W.count('fern'), moss: W.count('moss'),
    reed: W.count('reed'), mushroom: W.count('mushroom'),
    forestness: +W.forestness.toFixed(2), water: W.hasWater, zoom: +Cam.zoom.toFixed(3)
  });
})()
