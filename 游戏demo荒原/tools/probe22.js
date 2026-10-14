// 探针 22：重开之后 —— 世界还在吗？离线那段时间长了吗？
(function () {
  var W = Game.world;
  if (!W) return '没有世界';
  var toast = document.getElementById('toast');
  return JSON.stringify({
    seed: W.seed,
    tick: W.tickCount,
    plants: W.plants.length,
    unlocked: Array.from(Game.unlocked),
    season: Game.time.season,
    dayInSeason: +Game.time.dayInSeason.toFixed(3),
    camZoom: +Cam.zoom.toFixed(2),
    toast: toast ? (toast.textContent || '').slice(0, 40) : '(无)',
    savedAgainAt: (JSON.parse(localStorage.getItem(CFG.SAVE.key)) || {}).t
  }, null, 1);
})()
