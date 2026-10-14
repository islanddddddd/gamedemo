(function(){
  var W = Game.world;
  ['lichen','grass','moss','shrub','tree','flower','rock'].forEach(function(id){ Game.unlocked.add(id); });
  UI.refresh(Game.unlocked, null);
  var placed = 0;
  for (var k = 0; k < 500; k++) {
    var gx = 18 + ((Math.random() * 64) | 0);
    var gy = 14 + ((Math.random() * 46) | 0);
    if (W.canSow(gx, gy, 'grass')) { W.plant(gx, gy, 'grass', 0.9); placed++; }
  }
  for (var t = 0; t < 3000; t++) Game.tick();
  return JSON.stringify({
    placed: placed,
    total: W.plants.length,
    grass: W.count('grass'),
    shrub: W.count('shrub'),
    tree: W.count('tree'),
    fern: W.count('fern'),
    forestness: +W.forestness.toFixed(3),
    hasWater: W.hasWater,
    maxNut: +W.maxNut.toFixed(3),
    seen: Array.from(W.seenSpecies)
  });
})()
