/**
 * 共享：扫描游戏清单
 * 同时被本地服务器 (hub-server.js) 与 Vercel Serverless 函数 (api/games.js) 复用，
 * 保证本地与线上行为一致。
 */
const fs = require('fs');
const path = require('path');

// 候选缩略图文件名（按优先级，仅当配置未指定时自动探测）
const THUMB_CANDIDATES = [
  'thumbnail.png', 'thumbnail.jpg',
  'preview.png', 'preview.jpg',
  'cover.png', 'cover.jpg',
  'screenshot.png', 'screenshot.jpg'
];

// 扫描时跳过的目录
const SKIP_DIRS = new Set(['api', 'node_modules', '.vercel', '.git']);

function loadConfig(root) {
  const file = path.join(root, 'hub.config.json');
  if (!fs.existsSync(file)) return {};
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return cfg && typeof cfg === 'object' ? cfg : {};
  } catch (err) {
    console.warn('[hub] 读取 hub.config.json 失败，已忽略：', err.message);
    return {};
  }
}

function autoThumb(dir, id) {
  for (const c of THUMB_CANDIDATES) {
    if (fs.existsSync(path.join(dir, c))) {
      return '/' + encodeURI(id) + '/' + encodeURI(c);
    }
  }
  return null;
}

/**
 * 扫描 root 下所有含 index.html 的子文件夹作为游戏入口。
 * 标题/说明/作者评价/缩略图优先级：hub.config.json 覆盖 > 文件夹内 game.json 默认。
 * @param {string} root 项目根目录（含各游戏子文件夹与 hub 文件）
 */
function scanGames(root) {
  const config = loadConfig(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const games = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;        // 隐藏目录
    if (SKIP_DIRS.has(e.name)) continue;          // api / node_modules 等
    const dir = path.join(root, e.name);
    // hub.config.json 中以文件夹名为 key 覆盖（可指定入口文件名 entry，默认 index.html）
    const override = config[e.name] || {};
    const entry = (override.entry && typeof override.entry === 'string') ? override.entry : 'index.html';
    if (!fs.existsSync(path.join(dir, entry))) continue; // 仅收录含入口文件的子文件夹

    // 文件夹内 game.json 作为内置默认
    let meta = {};
    const metaPath = path.join(dir, 'game.json');
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (_) {}
    }

    // 缩略图优先级：配置指定 > game.json 指定 > 自动探测
    let thumb = override.thumbnail
      ? '/' + encodeURI(e.name) + '/' + encodeURI(override.thumbnail)
      : (meta.thumbnail
          ? '/' + encodeURI(e.name) + '/' + encodeURI(meta.thumbnail)
          : autoThumb(dir, e.name));

    games.push({
      id: e.name,
      name: override.title || meta.title || e.name,
      description: override.description || meta.description || '',
      review: override.review || meta.review || '',
      path: '/' + encodeURI(e.name) + '/' + encodeURI(entry),
      thumb
    });
  }
  return games;
}

module.exports = { scanGames, THUMB_CANDIDATES };
