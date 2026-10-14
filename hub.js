/**
 * 游戏中枢 · 前端逻辑
 * - 从 /api/games 拉取自动扫描出的游戏清单并渲染网格
 * - 点击卡片：用独立 iframe 加载该游戏（上下文隔离，互不干扰）
 * - 返回主菜单：清空 iframe，回主菜单网格
 */
(function () {
  'use strict';

  const grid = document.getElementById('grid');
  const home = document.getElementById('home');
  const stage = document.getElementById('stage');
  const frame = document.getElementById('frame');
  const homeBtn = document.getElementById('homeBtn');
  const loader = document.getElementById('loader');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function loadGames() {
    let games = null;
    let lastErr = null;
    // 优先用本地服务器接口；失败（如 Vercel 静态托管）则回退到构建生成的 games.json
    try {
      const res = await fetch('/api/games');
      if (!res.ok) throw new Error('status ' + res.status);
      games = await res.json();
    } catch (err) {
      lastErr = err;
      try {
        const res2 = await fetch('/games.json');
        if (!res2.ok) throw new Error('status ' + res2.status);
        games = await res2.json();
      } catch (err2) {
        lastErr = err2;
      }
    }

    if (!Array.isArray(games)) {
      grid.innerHTML =
        '<p class="err">无法获取游戏列表。本地请运行 <code>node hub-server.js</code> 后访问 ' +
        'http://localhost:8900；线上请确保已执行构建（vercel-build）生成 games.json。</p>';
      console.error('[hub] 加载游戏清单失败：', lastErr);
      return;
    }

    if (!Array.isArray(games) || games.length === 0) {
      grid.innerHTML =
        '<p class="err">未找到任何包含 index.html 的子文件夹。请确认游戏 demo 放在本站点根目录下。</p>';
      return;
    }

    grid.innerHTML = '';
    games.forEach((g) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';

      const thumbStyle = g.thumb ? `background-image:url('${g.thumb}')` : '';
      const placeholder = g.thumb ? '' : `<span class="ph">${escapeHtml((g.name || '?').slice(0, 1))}</span>`;

      card.innerHTML =
        `<div class="thumb" style="${thumbStyle}">${placeholder}</div>` +
        `<div class="meta">` +
          `<div class="name">${escapeHtml(g.name)}</div>` +
          (g.description ? `<div class="desc">${escapeHtml(g.description)}</div>` : '') +
          (g.review ? `<div class="review"><span class="review-tag">作者评价</span>${escapeHtml(g.review)}</div>` : '') +
        `</div>`;

      card.addEventListener('click', () => openGame(g));
      grid.appendChild(card);
    });
  }

  function openGame(g) {
    home.classList.add('hidden');
    stage.classList.remove('hidden');
    loader.classList.remove('hidden');
    frame.src = g.path; // 切换仅改变 iframe 源，旧游戏上下文被丢弃，互不干扰
  }

  frame.addEventListener('load', () => loader.classList.add('hidden'));

  homeBtn.addEventListener('click', () => {
    stage.classList.add('hidden');
    home.classList.remove('hidden');
    frame.src = 'about:blank'; // 卸载当前游戏，释放其资源
  });

  loadGames();
})();
