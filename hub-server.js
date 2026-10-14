/**
 * 游戏中枢 · 本地服务器
 * --------------------------------------------------------------
 * 1) 托管整个 demoHtml 目录（含各游戏子文件夹）。
 * 2) 提供 /api/games 接口：自动扫描根目录下所有含 index.html 的子文件夹，
 *    作为游戏入口（支持每个文件夹下的可选 game.json 与缩略图）。
 * 3) 每个游戏以独立 iframe 加载，JS / Canvas 上下文相互隔离，互不干扰。
 *
 * 启动： node hub-server.js   然后访问 http://localhost:8900
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { scanGames } = require('./hub-scan');

const ROOT = __dirname;
const PORT = process.env.PORT || 8900;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.map': 'application/json'
};

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // 游戏清单接口（自动扫描）
  if (urlPath === '/api/games') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(scanGames(ROOT)));
    return;
  }

  let filePath;
  if (urlPath === '/' || urlPath === '') {
    filePath = path.join(ROOT, 'index.html'); // hub 首页
  } else {
    filePath = path.normalize(path.join(ROOT, urlPath));
  }

  // 防止目录穿越
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.stat(filePath, (e2) => {
      if (e2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      serveFile(filePath, res);
    });
  });
});

server.listen(PORT, () => {
  const addr = `http://localhost:${PORT}`;
  console.log('\n  游戏中枢已启动 ▸ ' + addr);
  console.log('  按 Ctrl+C 停止。\n');
  // 尝试自动打开浏览器
  const cmd =
    process.platform === 'win32' ? `start "" "${addr}"`
    : process.platform === 'darwin' ? `open "${addr}"`
    : `xdg-open "${addr}"`;
  exec(cmd, (err) => { if (err) {/* 忽略：用户可手动打开 */} });
});
