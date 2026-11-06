<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import snapshot from "../../../data/projects.json";
import catalog from "../../../data/catalog.json";

const OWNER = snapshot.owner;
const API = "https://api.github.com";
const CACHE_KEY = "pages-hub:calibration";
const CACHE_VERSION = 1;
const CACHE_TTL_HOURS = 24;
const CACHE_TTL = CACHE_TTL_HOURS * 60 * 60 * 1000;

function removeCache() {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* 隐私模式或存储受限时忽略 */
  }
}

function normalizeCachedProject(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.pagesRepo !== "string" || !raw.pagesRepo) return null;
  if (typeof raw.title !== "string" || !raw.siteUrl) return null;
  return {
    pagesRepo: raw.pagesRepo,
    pagesRepoUrl:
      typeof raw.pagesRepoUrl === "string"
        ? raw.pagesRepoUrl
        : `https://github.com/${OWNER}/${raw.pagesRepo}`,
    siteUrl: String(raw.siteUrl),
    sourceRepo: typeof raw.sourceRepo === "string" ? raw.sourceRepo : "",
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : "",
    sourcePrivate: Boolean(raw.sourcePrivate),
    title: raw.title,
    summary: typeof raw.summary === "string" ? raw.summary : "暂无简介",
    category:
      typeof raw.category === "string" && raw.category
        ? raw.category
        : "未分类",
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag) => typeof tag === "string")
      : [],
    status: ["online", "offline", "unknown"].includes(raw.status)
      ? raw.status
      : "unknown",
    httpStatus: Number.isFinite(raw.httpStatus) ? raw.httpStatus : null,
    lastDeployAt:
      typeof raw.lastDeployAt === "string" ? raw.lastDeployAt : "",
    sourceUpdatedAt:
      typeof raw.sourceUpdatedAt === "string" ? raw.sourceUpdatedAt : "",
    checkedAt: typeof raw.checkedAt === "string" ? raw.checkedAt : "",
  };
}

function readCache() {
  if (typeof window === "undefined") return null;
  let raw;
  try {
    raw = window.localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeCache();
    return null;
  }

  if (
    !parsed ||
    parsed.version !== CACHE_VERSION ||
    parsed.owner !== OWNER ||
    !Array.isArray(parsed.projects)
  ) {
    removeCache();
    return null;
  }

  const checkedTime = Date.parse(parsed.checkedAt);
  if (!Number.isFinite(checkedTime)) {
    removeCache();
    return null;
  }

  const snapshotTime = Date.parse(snapshot.syncedAt);
  if (Number.isFinite(snapshotTime) && checkedTime <= snapshotTime) {
    // 构建期快照比本地校准更新，优先展示快照
    return null;
  }

  const entries = parsed.projects.map(normalizeCachedProject).filter(Boolean);
  if (!entries.length) {
    removeCache();
    return null;
  }

  return { checkedAt: parsed.checkedAt, projects: entries.sort(sortProjects) };
}

function writeCache(entries, checkedAt) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        owner: OWNER,
        savedAt: new Date().toISOString(),
        checkedAt,
        projects: entries,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

const catalogByPagesRepo = new Map(
  catalog.projects.map((item) => [item.pagesRepo, item]),
);
const categoryOrder = catalog.categories;
const snapshotByPagesRepo = new Map(
  snapshot.projects.map((item) => [item.pagesRepo, item]),
);

const projects = ref(snapshot.projects.map((project) => ({ ...project })));
const query = ref("");
const category = ref("全部");
const statusFilter = ref("全部");
const refreshing = ref(false);
const lastChecked = ref(snapshot.syncedAt);
const errorMessage = ref("");
const noticeMessage = ref("");
const dataSource = ref("snapshot");
const cachePersisted = ref(true);
const now = ref(Date.now());
let clockId = null;
let rateRemaining = null;
let rateReset = null;

const categories = computed(() => {
  const used = [...new Set(projects.value.map((project) => project.category))];
  return used.sort((a, b) => {
    const ia = categoryOrder.indexOf(a);
    const ib = categoryOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
});

const visibleProjects = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return projects.value.filter((project) => {
    const haystack = [
      project.title,
      project.summary,
      project.category,
      project.sourceRepo,
      project.pagesRepo,
      ...(project.tags || []),
    ]
      .join(" ")
      .toLowerCase();
    const matchKeyword = !keyword || haystack.includes(keyword);
    const matchCategory =
      category.value === "全部" || project.category === category.value;
    const matchStatus =
      statusFilter.value === "全部" || project.status === statusFilter.value;
    return matchKeyword && matchCategory && matchStatus;
  });
});

const stats = computed(() => ({
  total: projects.value.length,
  online: projects.value.filter((project) => project.status === "online")
    .length,
  offline: projects.value.filter((project) => project.status === "offline")
    .length,
  privateSources: projects.value.filter((project) => project.sourcePrivate)
    .length,
}));

function statusText(project) {
  if (project.status === "online") {
    return project.httpStatus ? `在线 ${project.httpStatus}` : "在线";
  }
  if (project.status === "offline") {
    return project.httpStatus ? `异常 ${project.httpStatus}` : "不可达";
  }
  return "未知";
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

const sourceLabel = computed(() => {
  if (dataSource.value === "live") {
    return cachePersisted.value ? "实时同步" : "实时同步（未持久化）";
  }
  if (dataSource.value === "cache") return "上次同步（本地缓存）";
  return "构建期快照";
});

const dataAgeText = computed(() => {
  if (dataSource.value === "snapshot") return "";
  const time = Date.parse(lastChecked.value);
  if (!Number.isFinite(time)) return "";
  const diff = now.value - time;
  if (diff < 0) return "";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚同步";
  if (minutes < 60) return `${minutes} 分钟前同步`;
  const hours = Math.floor(minutes / 60);
  if (hours < CACHE_TTL_HOURS) return `${hours} 小时前同步`;
  return `${Math.floor(hours / 24)} 天前同步`;
});

const dataStale = computed(() => {
  if (dataSource.value === "snapshot") return false;
  const time = Date.parse(lastChecked.value);
  return Number.isFinite(time) && now.value - time > CACHE_TTL;
});

async function api(pathname) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${API}${pathname}`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining !== null) rateRemaining = Number(remaining);
    const reset = res.headers.get("x-ratelimit-reset");
    if (reset !== null) rateReset = Number(reset);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = body?.message ? `（${body.message}）` : "";
      const resetText = Number.isFinite(rateReset)
        ? formatTime(new Date(rateReset * 1000).toISOString())
        : "";
      const quota = res.status === 403 || res.status === 429;
      throw new Error(
        `GitHub API ${res.status}${detail}${
          quota && resetText ? `，配额预计 ${resetText} 重置` : ""
        }`,
      );
    }
    return res.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("GitHub API 请求超时（12 秒）");
    }
    throw error;
  } finally {
    clearTimeout(timerId);
  }
}

async function fetchPublicRepos() {
  const repos = [];
  for (let page = 1; page <= 3; page += 1) {
    const batch = await api(
      `/users/${OWNER}/repos?per_page=100&page=${page}&sort=updated`,
    );
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

async function requestHead(url, mode) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, {
      method: "HEAD",
      mode,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timerId);
  }
}

async function probeSite(url) {
  try {
    const res = await requestHead(url, "cors");
    const ok = res.status >= 200 && res.status < 400;
    return { status: ok ? "online" : "offline", httpStatus: res.status };
  } catch {
    try {
      await requestHead(url, "no-cors");
      return { status: "online", httpStatus: null };
    } catch {
      return { status: "offline", httpStatus: null };
    }
  }
}

function normalizeSiteUrl(repoName) {
  return `https://${OWNER.toLowerCase()}.github.io/${repoName}/`;
}

function inferSourceRepo(pagesRepo, repoNames) {
  const striped = pagesRepo.replace(/-(pages|site|comics|docs|web)$/, "");
  if (striped !== pagesRepo && repoNames.has(striped)) return striped;
  return repoNames.has(pagesRepo) ? pagesRepo : "";
}

function sortProjects(a, b) {
  const da = a.lastDeployAt ? new Date(a.lastDeployAt).getTime() : 0;
  const db = b.lastDeployAt ? new Date(b.lastDeployAt).getTime() : 0;
  if (db !== da) return db - da;
  return (a.title || "").localeCompare(b.title || "", "zh-CN");
}

async function refresh({ auto = false } = {}) {
  if (refreshing.value) return;
  refreshing.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";
  try {
    const repos = await fetchPublicRepos();
    const repoNames = new Set(repos.map((repo) => repo.name));
    const pagesRepos = repos.filter((repo) => repo.has_pages === true);
    if (pagesRepos.length === 0) {
      throw new Error("未发现启用 GitHub Pages 的仓库");
    }

    const checkedAt = new Date().toISOString();
    const discovered = await mapLimit(pagesRepos, 6, async (repo) => {
      const entry = catalogByPagesRepo.get(repo.name) || {};
      const previous = snapshotByPagesRepo.get(repo.name) || {};
      const sourceRepo =
        entry.sourceRepo ||
        previous.sourceRepo ||
        inferSourceRepo(repo.name, repoNames);
      const siteUrl = previous.siteUrl || normalizeSiteUrl(repo.name);
      const probe = await probeSite(siteUrl);

      return {
        pagesRepo: repo.name,
        pagesRepoUrl: `https://github.com/${OWNER}/${repo.name}`,
        siteUrl,
        sourceRepo,
        sourceUrl: sourceRepo
          ? `https://github.com/${OWNER}/${sourceRepo}`
          : "",
        sourcePrivate: Boolean(entry.sourcePrivate ?? previous.sourcePrivate),
        title: entry.title || previous.title || repo.name,
        summary:
          entry.summary ||
          previous.summary ||
          repo.description ||
          "暂无简介",
        category: entry.category || previous.category || "未分类",
        tags: entry.tags || previous.tags || [],
        branch: previous.branch || "",
        buildType: previous.buildType || "",
        cname: previous.cname || "",
        status: probe.status,
        httpStatus: probe.httpStatus,
        lastDeployAt: repo.pushed_at || "",
        sourceUpdatedAt: previous.sourceUpdatedAt || "",
        checkedAt,
      };
    });

    projects.value = discovered.sort(sortProjects);
    if (!categories.value.includes(category.value)) category.value = "全部";
    lastChecked.value = checkedAt;
    dataSource.value = "live";
    cachePersisted.value = writeCache(discovered, checkedAt);
    const quota =
      rateRemaining !== null ? `，接口剩余配额 ${rateRemaining} 次` : "";
    const persistence = cachePersisted.value
      ? "，结果已保存到本浏览器作为后备。"
      : "；本地缓存不可用，刷新后将回到构建期快照。";
    noticeMessage.value = `${
      auto ? "已自动同步" : "已同步"
    } ${discovered.length} 个 Pages 站点${quota}${persistence}`;
  } catch (error) {
    const fallback =
      dataSource.value === "live"
        ? "当前实时同步的数据"
        : dataSource.value === "cache"
          ? "上次同步的数据"
          : "构建期快照";
    errorMessage.value = `${
      auto ? "自动同步失败" : "校准失败"
    }：${error.message}，当前仍展示${fallback}。`;
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => {
  const cached = readCache();
  if (cached) {
    projects.value = cached.projects;
    lastChecked.value = cached.checkedAt;
    dataSource.value = "cache";
    cachePersisted.value = true;
    if (!categories.value.includes(category.value)) category.value = "全部";
  }
  clockId = window.setInterval(() => {
    now.value = Date.now();
  }, 60000);
  refresh({ auto: true });
});

onUnmounted(() => {
  if (clockId !== null) window.clearInterval(clockId);
});
</script>

<template>
  <section id="projects" class="ph-explorer">
    <div class="ph-toolbar">
      <input
        v-model="query"
        type="search"
        placeholder="搜索项目、分类、标签或仓库名"
        aria-label="搜索项目"
      />
      <select v-model="category" aria-label="按分类筛选">
        <option value="全部">全部分类</option>
        <option v-for="item in categories" :key="item" :value="item">
          {{ item }}
        </option>
      </select>
      <select v-model="statusFilter" aria-label="按状态筛选">
        <option value="全部">全部状态</option>
        <option value="online">仅在线</option>
        <option value="offline">仅异常</option>
      </select>
      <button class="ph-refresh" :disabled="refreshing" @click="refresh()">
        {{ refreshing ? "校准中…" : "立即校准" }}
      </button>
    </div>

    <div class="ph-source" :class="{ stale: dataStale }">
      <span :class="['ph-source-tag', dataSource]">{{ sourceLabel }}</span>
      <span>数据时间：{{ formatTime(lastChecked) }}（Asia/Shanghai）</span>
      <span v-if="dataSource !== 'snapshot'" class="ph-source-age">
        {{ dataAgeText
        }}<template v-if="dataStale"
          >，已超过 {{ CACHE_TTL_HOURS }} 小时，建议重新校准</template
        >
      </span>
      <span v-if="refreshing" class="ph-source-loading">
        正在同步最新数据…
      </span>
    </div>

    <div class="ph-stats">
      <div class="ph-stat">
        <strong>{{ stats.total }}</strong>
        <span>收录站点</span>
      </div>
      <div class="ph-stat">
        <strong>{{ stats.online }}</strong>
        <span>当前可达</span>
      </div>
      <div class="ph-stat">
        <strong>{{ stats.offline }}</strong>
        <span>需要关注</span>
      </div>
      <div class="ph-stat">
        <strong>{{ stats.privateSources }}</strong>
        <span>私有源码仓库</span>
      </div>
    </div>

    <div v-if="visibleProjects.length" class="ph-grid">
      <article
        v-for="project in visibleProjects"
        :key="project.pagesRepo"
        class="ph-card"
      >
        <div class="ph-card-head">
          <span class="ph-category">{{ project.category }}</span>
          <span :class="['ph-status', project.status]">{{
            statusText(project)
          }}</span>
        </div>
        <h3>{{ project.title }}</h3>
        <p class="ph-summary">{{ project.summary }}</p>
        <div v-if="project.tags?.length" class="ph-tags">
          <span v-for="tag in project.tags" :key="tag" class="ph-tag">{{
            tag
          }}</span>
        </div>
        <div class="ph-meta">
          <span>部署仓更新 {{ formatDate(project.lastDeployAt) }}</span>
          <span v-if="project.sourcePrivate">源码私有</span>
        </div>
        <div class="ph-links">
          <a :href="project.siteUrl" target="_blank" rel="noreferrer"
            >在线站点</a
          >
          <a
            v-if="project.sourceUrl"
            :href="project.sourceUrl"
            target="_blank"
            rel="noreferrer"
          >
            {{ project.sourcePrivate ? "源码仓库（私有）" : "源码仓库" }}
          </a>
          <span v-else class="ph-muted">源码待补充</span>
          <a :href="project.pagesRepoUrl" target="_blank" rel="noreferrer"
            >部署仓库</a
          >
        </div>
      </article>
    </div>
    <div v-else class="ph-empty">
      没有匹配的项目，试试更换关键词或筛选条件。
    </div>

    <p class="ph-note">
      页面打开时会自动同步公开仓库信息与站点可达性；Pages
      构建配置、私有源码更新时间等字段仍来自构建期快照。同步结果会保存在本浏览器，作为下次加载时的后备数据。浏览器匿名调用
      GitHub API 受每小时 60 次限额约束，超限时会保留当前数据并提示重置时间。
      <span v-if="noticeMessage" class="ph-notice">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="ph-error">{{ errorMessage }}</span>
    </p>
  </section>
</template>
