# 游戏中枢 · Game Hub

一个把多个独立游戏 demo 串联起来的导航网站。所有游戏在同一个站点内，通过统一导航栏切换访问，互不干扰。

## 功能特点

- **自动扫描入口**：启动后自动扫描根目录下所有含 `index.html` 的子文件夹，作为游戏入口。
- **卡片信息**：每个入口显示游戏名称、可选缩略图、说明，以及「作者评价」。
- **同一站点内切换**：点击入口用独立的 `<iframe>` 加载对应游戏；各游戏拥有独立的 JS / Canvas 上下文，切换时旧游戏被卸载，互不干扰、切换流畅。
- **统一导航栏**：顶部常驻导航栏，任何时候都可一键「返回主菜单」。
- **响应式**：桌面多列网格、移动端单列，适配不同屏幕。

## 目录结构

```
demoHtml/
├── index.html          # 导航站首页（导航栏 + 主菜单 + 游戏舞台）
├── hub.css             # 导航站样式
├── hub.js              # 前端逻辑：拉取清单、渲染卡片、iframe 切换
├── hub-server.js       # 本地静态服务器（仅本地开发用）
├── hub-scan.js         # 扫描游戏清单的共享逻辑（本地/线上共用）
├── build-games.js      # 构建脚本：生成静态清单 games.json
├── hub.config.json     # 用户可编辑的配置（标题/说明/评价/缩略图）
├── games.json          # 构建产物（自动生成，已提交作为兜底）
├── vercel.json         # Vercel 静态部署配置
├── package.json        # 脚本与依赖声明
├── start.bat           # 一键启动（Windows）
├── 微缩水境/           # 游戏 demo 子文件夹（含 index.html）
├── 游戏demo荒原/
└── 游戏demo之枯山水/
```

每个游戏子文件夹内可放一个可选的 `game.json`（标题/说明/评价/缩略图的默认值），但推荐统一在根目录的 `hub.config.json` 中维护。

## 本地运行

方式一（推荐，Windows 双击）：

```
start.bat
```

方式二（命令行）：

```
node hub-server.js
```

然后浏览器打开 `http://localhost:8900`。

> 必须通过本地服务器访问，因为 `微缩水境` 使用了 ES Module（浏览器禁止 `file://` 加载），直接双击 `index.html` 无法运行。

## 配置游戏信息

编辑根目录的 `hub.config.json`，以**文件夹名**为键：

```json
{
  "微缩水境": {
    "title": "微缩水境",
    "description": "一句话说明，显示在导航卡片上",
    "review": "作者评价，显示在卡片底部",
    "thumbnail": "preview.png"
  }
}
```

字段说明：

| 字段         | 说明                                                         |
| ------------ | ------------------------------------------------------------ |
| `title`      | 列表显示的游戏名（不填则用文件夹名）                         |
| `description`| 卡片上的简介                                                 |
| `review`     | 作者评价，以「作者评价」标签展示                             |
| `thumbnail`  | 缩略图文件名（放在对应游戏文件夹内）。不填则自动探测 `preview.png` / `thumbnail.png` 等；都没有则显示首字母占位块 |

保存后**重启服务器**即可在导航列表看到更新。

新增游戏：把含 `index.html` 的子文件夹放进根目录，重启/重新部署即自动出现在主菜单，无需改任何代码。

## 部署到 Vercel

本项目是**纯静态站点**，由 Vercel 静态托管，构建时生成游戏清单。

1. 把本目录推送到 GitHub 仓库。
2. Vercel 控制台 → New Project → 导入仓库。
3. 关键设置：
   - **Root Directory**：设为包含本目录的文件夹（若仓库根就是本目录则留空）。
   - **Framework Preset**：`Other`（无框架）。
   - **Build Command**：留空（会自动执行 `vercel-build` 生成 `games.json`）。
4. Deploy 即可，访问分配的域名。

前端优先请求 `/api/games`（本地服务器提供），失败时回退到静态文件 `/games.json`（线上），因此线上无需任何 Serverless 函数。

> 若需在 Vercel 上热更新游戏列表（增删游戏 / 改配置），重新部署一次即可。

## 注意事项

- 游戏以同域 `<iframe>` 加载，Vercel 默认不拦截，可正常显示。
- 各游戏的相对资源（如 `lib/`、`vendor/`、`css/`、`js/`）由静态托管正确解析。
- `games.json` 是构建产物，已提交作为兜底；日常改动以 `hub.config.json` 为准。
- 工具生成目录（`.gstack/`、`.workbuddy/` 等）已在 `.gitignore` 中忽略。

## Git 远程

当前远程仓库（SSH）：

```
git@github.com:islanddddddd/gamedemo.git
```

常用命令：

```bash
git push -u gamedemo main     # 首次推送并设置上游
git push                       # 后续推送
```
