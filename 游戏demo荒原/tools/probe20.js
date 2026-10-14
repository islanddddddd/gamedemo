// 探针 20：功能回归 —— 新开一局 → 放种 → 存档 → 假装离线一段时间 → 续长
// 用法：agent-browser eval "$(cat tools/probe20.js)"
(function () {
  var R = {};

  // 1. 清档重开
  Storage.clear();
  location.reload();
  return 'reload';
})()
