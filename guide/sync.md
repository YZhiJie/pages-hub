# 同步机制

本站的数据不是手工维护的清单，而是由脚本从 GitHub API 拉取、合并人工目录信息后生成的。

## 数据流

```text
GitHub API
  ├─ /users/{owner}/repos        仓库列表、has_pages、pushed_at
  ├─ /repos/{owner}/{repo}/pages Pages 地址、分支、构建方式、CNAME
  └─ /repos/{owner}/{repo}       源码仓库可见性与更新时间
        │
        ▼
scripts/sync-pages.mjs
  ├─ 合并 data/catalog.json（标题、简介、分类、标签、私有标记）
  ├─ 探测每个在线地址的 HTTP 状态
  ├─ 推断未登记项目的源码仓库
  ▼
data/projects.json  +  projects.md
        │
        ▼
VitePress 构建 → GitHub Pages
        │
        ▼
浏览器打开后每 5 分钟校准一次
```

## 三条同步链路

| 链路 | 触发方式 | 同步内容 | 频率 |
| --- | --- | --- | --- |
| CI 定时同步 | `schedule` | 全量仓库、Pages 配置、部署时间、可达性 | 每 30 分钟 |
| 推送同步 | `push` 到 `main` | 同上 | 每次提交 |
| 手动同步 | `workflow_dispatch` | 同上 | 按需 |
| 页面内校准 | 浏览器定时器 | 公开仓库更新时间 + 站点可达性 | 每 5 分钟 |

CI 与页面内校准的分工：

- **CI** 能访问更完整的数据（在配置 PAT 后可读取私有源码仓库），并生成静态的 `projects.md`，保证无脚本环境也能浏览。
- **浏览器端** 只请求公开接口，用于缩短「站点掉线」到「页面可见」的时间差，不写入任何数据。

## 源码仓库如何确定

优先级从高到低：

1. `data/catalog.json` 中显式声明的 `sourceRepo`；
2. 部署仓库最近提交信息中的 `owner/repo@sha` 或 `sync from repo`；
3. 去掉 `-pages`、`-site`、`-comics`、`-docs`、`-web` 后缀后能匹配到的仓库；
4. 部署仓库描述中出现的「源码仓库」名称。

无法确定时保留站点，并将源码仓库标记为「待补充」，不会隐藏该站点。

## 如何新增一个项目

1. 在目标仓库启用 GitHub Pages，并确认线上地址可访问。
2. 在 `data/catalog.json` 增加一条记录：

   ```json
   {
     "pagesRepo": "new-project-pages",
     "sourceRepo": "new-project",
     "title": "项目标题",
     "summary": "一句话简介",
     "category": "工程化与运维",
     "tags": ["标签一", "标签二"],
     "sourcePrivate": true
   }
   ```

3. 运行 `pnpm sync`，检查 `data/projects.json` 与 `projects.md` 是否包含新项目。
4. 运行 `pnpm dev` 本地确认卡片与链接，提交后推送即可触发部署。

未登记的项目也会被自动发现：只要仓库启用了 Pages，就会出现在列表中，标题回退为仓库名，分类回退为「未分类」。登记目录的作用是补上高质量的中文标题、简介和分类。

## 数据字段

| 字段 | 说明 |
| --- | --- |
| `siteUrl` | 在线访问地址，优先取 Pages API 的 `html_url` |
| `sourceRepo` / `sourceUrl` | 源码仓库名与地址 |
| `sourcePrivate` | 源码仓库是否私有 |
| `pagesRepo` / `pagesRepoUrl` | 部署仓库名与地址 |
| `branch` / `buildType` | Pages 发布分支与构建方式（legacy / workflow） |
| `status` / `httpStatus` | 构建期探测结果 |
| `lastDeployAt` | 部署仓库最近更新时间 |
| `sourceUpdatedAt` | 源码仓库最近更新时间（可读取时） |
| `syncedAt` | 本次同步时间 |

## 已知限制

- GitHub Actions 的定时任务可能延迟数分钟到数十分钟，GitHub 官方也不保证精确执行时间。
- GitHub Pages 默认带有约 10 分钟的 CDN 缓存，刚部署完的页面可能短暂显示旧内容。
- 浏览器端未认证调用 GitHub API 受每小时 60 次的限额约束；本站每 5 分钟只请求一次仓库列表，正常浏览不会触发限额。
- 默认的 `GITHUB_TOKEN` 无法读取私有源码仓库。若需要同步私有仓库的更新时间，请在仓库 Secrets 中配置 `PAGES_SYNC_TOKEN`（具备 `repo` 读取权限的 PAT），工作流会自动优先使用它。
