(function(){
  var W = Game.world;
  ['tree','shrub','flower','grass','moss','lichen','rock'].forEach(function(id){ Game.unlocked.add(id); });
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
  return 'ready';
})()
