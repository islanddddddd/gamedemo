// 探针 21：新局 → 手边有哪几样 → 放种 → 长一会儿 → 存档 → 把时间往回拨 40 分钟（假装离线）
(function () {
  var W = Game.world;
  var out = { fresh: {
    unlocked: Array.from(Game.unlocked),
    tick: Game.time.tick,
    plants: W.plants.length,
    season: Game.time.season,
    dayInSeason: +Game.time.dayInSeason.toFixed(3),
    saveExistsAfterReset: !!localStorage.getItem(CFG.SAVE.key)   // 期望 false：真的清干净了
  } };

  // 手边可选的（种子栏）
  out.bar = Array.from(document.querySelectorAll('#seedbar button.seed'))
    .map(function (el) { return el.getAttribute('data-id'); });

  // 放种：选草，然后在若干格上点
  Game.unlocked.add('grass');
  UI.refresh(Game.unlocked, null);
  UI.select('grass');
  out.selected = UI.selected ? UI.selected.id : '(没选上)';

  var placed = 0;
  for (var k = 0; k < 16; k++) {
    var gx = 28 + (k % 4) * 3, gy = 28 + ((k / 4) | 0) * 3;
    if (W.canPlaceAt(gx, gy)) { Game.place(gx, gy); placed++; }
  }
  out.placed = placed;
  out.plantsRightAfterPlace = W.plants.length;

  // 跑 800 步
  for (var t = 0; t < 800; t++) Game.tick();
  var carpet = 0, mois = 0;
  for (var i = 0; i < W.n; i++) { carpet += W.carpet[i]; mois += W.mois[i]; }
  out.afterGrow = {
    tick: Game.time.tick,
    plants: W.plants.length,
    carpetSum: +carpet.toFixed(1),
    moisAvg: +(mois / W.n).toFixed(3)
  };

  // 存档 + 把时间往回拨 40 分钟
  Game.save();
  var raw = localStorage.getItem(CFG.SAVE.key);
  out.saveBytes = raw ? raw.length : 0;
  var payload = JSON.parse(raw);
  payload.t = Date.now() - 40 * 60 * 1000;
  localStorage.setItem(CFG.SAVE.key, JSON.stringify(payload));
  out.rewoundMinutes = 40;
  out.tickAtSave = W.tickCount;

  // 立牌子：接下来要跳转页面，别让 beforeunload 的自动存档把我改的时间又覆盖回去
  Game.resetting = true;
  return JSON.stringify(out, null, 1);
})()
