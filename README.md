# Pages Hub

全部 GitHub Pages 在线站点与源码仓库的一站式导航。手动同步站点地址、源码仓库、部署状态与最近更新时间，并在页面打开期间实时校准可达性。

- 在线站点：<https://yzhijie.github.io/pages-hub/>
- 部署仓库：<https://github.com/YZhiJie/pages-hub>
- 数据来源：GitHub REST API + `data/catalog.json`

## 这个网站的作用

站点越建越多之后，访问地址、源码仓库和部署仓库很容易散落在 README、书签和聊天记录里。Pages Hub 只做索引，不复制内容，解决三件事：

1. **统一入口**：所有 Pages 站点按分类集中展示，支持关键词、分类、状态筛选。
2. **链路可追溯**：每个站点同时给出「在线地址 / 源码仓库 / 部署仓库」，私有源码明确标注。
3. **状态可感知**：构建期探测 HTTP 状态，页面内每 5 分钟重新校准；Actions 手动触发全量同步。

详细说明见站点内「网站作用」与「同步机制」两页。

## 目录结构

```text
pages-hub/
├── data/
│   ├── catalog.json          # 人工维护：标题、简介、分类、标签、源码映射
│   └── projects.json         # 自动生成：合并 GitHub API 后的站点数据
├── scripts/sync-pages.mjs    # 同步脚本（仓库发现 → 数据合并 → 可达性探测 → 生成产物）
├── .vitepress/               # VitePress 配置、主题与项目卡片组件
├── guide/                    # 网站作用、同步机制
├── projects.md               # 自动生成的静态项目清单
└── .github/workflows/deploy.yml
```

## 本地开发

```bash
pnpm install
pnpm dev      # 先执行 sync，再启动 http://localhost:5173
pnpm build    # 先执行 sync，再构建到 .vitepress/dist
pnpm preview  # 预览构建产物
```

本地运行 `pnpm sync` 时会自动读取 `gh auth token`；也可以显式传入：

```bash
GITHUB_TOKEN=xxx pnpm sync
```

## 同步逻辑

- **仓库发现**：读取当前账号所有仓库，筛选 `has_pages = true`，再逐个读取 Pages 配置。
- **源码映射**：优先使用 `data/catalog.json`；未登记项目按提交信息、命名后缀与描述推断。
- **状态探测**：对每个在线地址发起 HEAD 请求，记录状态码；超时或非 2xx/3xx 记为异常。
- **产物**：写入 `data/projects.json` 与 `projects.md`，构建时被打包进站点。
- **CI**：仅 `workflow_dispatch` 手动触发，执行同步、构建并发布到 GitHub Pages。

### 私有源码仓库

默认 `GITHUB_TOKEN` 无法读取私有仓库。若需要同步私有源码仓库的更新时间，在仓库 **Settings → Secrets and variables → Actions** 中添加 `PAGES_SYNC_TOKEN`（具备私有仓库读取权限的 PAT）。工作流会优先使用该 Secret，未配置时自动回退。

## 新增项目

1. 目标仓库启用 GitHub Pages 并确认线上可访问。
2. 在 `data/catalog.json` 增加记录（字段见站点「同步机制」页）。
3. 执行 `pnpm sync`，确认 `data/projects.json` 和 `projects.md` 已更新。
4. 本地 `pnpm dev` 检查卡片，提交并推送。

未登记项目也会被自动发现，但标题、简介和分类会退化为默认值，因此推荐补全目录信息。
