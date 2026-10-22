// 文件: scripts/sync-pages.mjs
// 用途: 从 GitHub API 同步所有启用了 Pages 的仓库，合并人工目录信息后生成
//       data/projects.json（站点数据）与 projects.md（可爬取的静态清单）。
// 运行: pnpm sync（本地会自动读取 gh auth token；CI 使用 GITHUB_TOKEN）

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = path.join(ROOT, "data", "catalog.json");
const DATA_PATH = path.join(ROOT, "data", "projects.json");
const MARKDOWN_PATH = path.join(ROOT, "projects.md");
const API = "https://api.github.com";
const USER_AGENT = "pages-hub-sync";

const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, "utf8"));
const owner = process.env.PAGES_OWNER || catalog.owner;
const categories = catalog.categories;
const catalogByPagesRepo = new Map(
  catalog.projects.map((item) => [item.pagesRepo, item]),
);
const catalogOrder = new Map(
  catalog.projects.map((item, index) => [item.pagesRepo, index]),
);

const token = resolveToken();
const useUserEndpoint =
  Boolean(process.env.PAGES_SYNC_TOKEN) ||
  (Boolean(token) && !process.env.GITHUB_ACTIONS);

function resolveToken() {
  if (process.env.PAGES_SYNC_TOKEN) return process.env.PAGES_SYNC_TOKEN.trim();
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function api(pathname, { allow404 = false } = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${pathname}`, { headers });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API ${res.status} ${pathname}: ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

async function listRepos() {
  const repos = [];
  const endpoint = useUserEndpoint
    ? "/user/repos?affiliation=owner&sort=updated"
    : `/users/${owner}/repos?type=owner&sort=updated`;
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api(`${endpoint}&per_page=100&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function probeSite(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status === 405) {
      res = await fetch(url, { redirect: "follow", signal: controller.signal });
    }
    const ok = res.status >= 200 && res.status < 400;
    return { status: ok ? "online" : "offline", httpStatus: res.status };
  } catch (error) {
    return { status: "offline", httpStatus: null, error: error.name };
  } finally {
    clearTimeout(timer);
  }
}

function inferSourceRepo(pagesRepo, repoNames, pagesDescription) {
  const candidates = [];
  const striped = pagesRepo.replace(/-(pages|site|comics|docs|web)$/, "");
  if (striped !== pagesRepo) candidates.push(striped);
  candidates.push(pagesRepo);

  for (const name of candidates) {
    if (repoNames.has(name)) return name;
  }

  const commitSource = latestDeploySource.get(pagesRepo);
  if (commitSource && repoNames.has(commitSource)) return commitSource;

  const match = /(?:源码|source)[^\w]*([\w.-]+)/i.exec(pagesDescription || "");
  if (match && repoNames.has(match[1])) return match[1];

  return "";
}

const latestDeploySource = new Map();

async function fetchLatestDeploySource(pagesRepo) {
  const commits = await api(`/repos/${owner}/${pagesRepo}/commits?per_page=3`, {
    allow404: true,
  });
  if (!commits) return;
  for (const commit of commits) {
    const message = commit.commit?.message || "";
    const match =
      /([\w.-]+)\/([\w.-]+)@[0-9a-f]{7,40}/i.exec(message) ||
      /sync(?:\s+\w+)?\s+from\s+([\w.-]+)/i.exec(message);
    if (match) {
      const repoName = match[2] || match[1];
      if (repoName && repoName !== owner)
        latestDeploySource.set(pagesRepo, repoName);
      return;
    }
  }
}

function normalizeSiteUrl(htmlUrl, repoName) {
  if (htmlUrl) return htmlUrl.endsWith("/") ? htmlUrl : `${htmlUrl}/`;
  return `https://${owner.toLowerCase()}.github.io/${repoName}/`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function sortProjects(a, b) {
  const da = a.lastDeployAt ? new Date(a.lastDeployAt).getTime() : 0;
  const db = b.lastDeployAt ? new Date(b.lastDeployAt).getTime() : 0;
  if (db !== da) return db - da;
  return a.title.localeCompare(b.title, "zh-CN");
}

function renderMarkdown(data) {
  const rows = data.projects.map((project) => {
    const source = !project.sourceRepo
      ? "待补充"
      : `[源码仓库](https://github.com/${owner}/${project.sourceRepo})`;
    return `| ${project.title} | ${project.category} | [在线网址](${project.siteUrl}) | ${source} | [部署仓库](https://github.com/${owner}/${project.pagesRepo}) | ${formatDate(project.lastDeployAt)} |`;
  });

  return `---
pageClass: ph-projects-page
---

# 全部项目

> 本页由 \`pnpm sync\` 自动生成，最近同步：${formatDate(data.syncedAt)}（Asia/Shanghai）。
> 请勿手动编辑；如需调整标题、简介或分类，请修改 \`data/catalog.json\`。

共 ${data.stats.total} 个站点：在线 ${data.stats.online} 个，异常 ${data.stats.offline} 个，覆盖 ${data.stats.categories} 个分类。

<div class="ph-table-wrap">

| 项目 | 分类 | 站点 | 源码 | 部署 | 最近更新 |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

</div>
`;
}

const repos = await listRepos();
const repoNames = new Set(repos.map((repo) => repo.name));
const pagesRepos = repos.filter((repo) => repo.has_pages === true);

if (pagesRepos.length === 0) {
  throw new Error(
    "未发现任何启用了 GitHub Pages 的仓库，请检查 token 权限或网络",
  );
}

// 先把可推断的源码仓库补齐，供后续复用
await mapLimit(pagesRepos, 6, async (repo) => {
  if (!catalogByPagesRepo.get(repo.name)?.sourceRepo) {
    await fetchLatestDeploySource(repo.name);
  }
});

const discovered = await mapLimit(pagesRepos, 6, async (repo, index) => {
  const entry = catalogByPagesRepo.get(repo.name) || {};
  const [pagesInfo, sourceInfo] = await Promise.all([
    api(`/repos/${owner}/${repo.name}/pages`, { allow404: true }),
    entry.sourceRepo
      ? api(`/repos/${owner}/${entry.sourceRepo}`, { allow404: true })
      : Promise.resolve(null),
  ]);

  const sourceRepo =
    entry.sourceRepo ||
    inferSourceRepo(repo.name, repoNames, repo.description) ||
    "";

  const siteUrl = normalizeSiteUrl(pagesInfo?.html_url, repo.name);
  const probe = await probeSite(siteUrl);

  return {
    pagesRepo: repo.name,
    pagesRepoUrl: `https://github.com/${owner}/${repo.name}`,
    siteUrl,
    sourceRepo,
    sourceUrl: sourceRepo ? `https://github.com/${owner}/${sourceRepo}` : "",
    sourcePrivate: Boolean(
      entry.sourcePrivate ?? (sourceInfo ? sourceInfo.private : false),
    ),
    title: entry.title || repo.name,
    summary: entry.summary || repo.description || "暂无简介",
    category: entry.category || "未分类",
    tags: entry.tags || [],
    branch: pagesInfo?.source?.branch || "",
    buildType: pagesInfo?.build_type || "",
    cname: pagesInfo?.cname || "",
    status: probe.status,
    httpStatus: probe.httpStatus,
    lastDeployAt: repo.pushed_at || "",
    sourceUpdatedAt: sourceInfo?.pushed_at || "",
    order: catalogOrder.get(repo.name) ?? 1000 + index,
  };
});

const projects = discovered
  .map((project) => {
    const { order, ...rest } = project;
    return { ...rest, order };
  })
  .sort(sortProjects);

const online = projects.filter((project) => project.status === "online").length;
const offline = projects.filter(
  (project) => project.status === "offline",
).length;
const usedCategories = [
  ...new Set(projects.map((project) => project.category)),
];

const data = {
  owner,
  syncedAt: new Date().toISOString(),
  stats: {
    total: projects.length,
    online,
    offline,
    unknown: projects.length - online - offline,
    privateSources: projects.filter((project) => project.sourcePrivate).length,
    categories: usedCategories.length,
  },
  categories: usedCategories.sort((a, b) => {
    const ia = categories.indexOf(a);
    const ib = categories.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  }),
  projects,
};

const siteUrls = new Set();
for (const project of projects) {
  if (!project.siteUrl) {
    throw new Error(`项目缺少在线地址: ${project.pagesRepo}`);
  }
  if (siteUrls.has(project.siteUrl)) {
    throw new Error(`在线地址重复: ${project.siteUrl}`);
  }
  siteUrls.add(project.siteUrl);
}

await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
await fs.writeFile(MARKDOWN_PATH, renderMarkdown(data), "utf8");

console.log(
  `[sync] ${data.stats.total} 个 Pages 站点已同步（在线 ${online}，异常 ${offline}）`,
);
if (offline > 0) {
  console.log(
    "[sync] 异常站点:",
    projects
      .filter((project) => project.status === "offline")
      .map(
        (project) => `${project.pagesRepo}(${project.httpStatus ?? "timeout"})`,
      )
      .join(", "),
  );
}
console.log(
  `[sync] 数据写入 ${path.relative(ROOT, DATA_PATH)} 与 ${path.relative(ROOT, MARKDOWN_PATH)}`,
);
