/**
 * 构建脚本：扫描游戏并生成静态清单 games.json
 * - 本地： node build-games.js
 * - Vercel：作为 vercel-build 自动执行，部署前生成清单，前端以静态文件方式读取
 *   （这样无需 Serverless 函数读取文件系统，最稳定）
 */
const fs = require('fs');
const path = require('path');
const { scanGames } = require('./hub-scan');

const root = __dirname;
const games = scanGames(root);
const out = path.join(root, 'games.json');
fs.writeFileSync(out, JSON.stringify(games, null, 2), 'utf-8');
console.log(`[build] 已生成 games.json，共 ${games.length} 个游戏入口。`);
