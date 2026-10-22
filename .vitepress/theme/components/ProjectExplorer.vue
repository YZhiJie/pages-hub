<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import snapshot from "../../../data/projects.json";

const OWNER = snapshot.owner;
const API = "https://api.github.com";
const AUTO_REFRESH_MS = 5 * 60 * 1000;

const projects = ref(snapshot.projects.map((project) => ({ ...project })));
const query = ref("");
const category = ref("全部");
const statusFilter = ref("全部");
const refreshing = ref(false);
const lastChecked = ref(snapshot.syncedAt);
const errorMessage = ref("");
let timer = null;

const categories = snapshot.categories;

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
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function fetchPublicRepos() {
  const repos = [];
  for (let page = 1; page <= 3; page += 1) {
    const res = await fetch(
      `${API}/users/${OWNER}/repos?per_page=100&page=${page}&sort=updated`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const batch = await res.json();
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
  const timerId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });
    const ok = res.status >= 200 && res.status < 400;
    return { status: ok ? "online" : "offline", httpStatus: res.status };
  } catch {
    try {
      await fetch(url, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      return { status: "online", httpStatus: null };
    } catch {
      return { status: "offline", httpStatus: null };
    }
  } finally {
    clearTimeout(timerId);
  }
}

async function refresh({ silent = false } = {}) {
  if (refreshing.value) return;
  if (silent && document.visibilityState === "hidden") return;
  refreshing.value = true;
  errorMessage.value = "";
  try {
    const repos = await fetchPublicRepos();
    const probes = await mapLimit(projects.value, 6, (project) =>
      probeSite(project.siteUrl),
    );
    const repoByName = new Map(repos.map((repo) => [repo.name, repo]));
    const checkedAt = new Date().toISOString();

    projects.value = projects.value.map((project, index) => {
      const repo = repoByName.get(project.pagesRepo);
      return {
        ...project,
        status: probes[index].status,
        httpStatus: probes[index].httpStatus,
        lastDeployAt: repo?.pushed_at || project.lastDeployAt,
        checkedAt,
      };
    });
    lastChecked.value = checkedAt;
  } catch (error) {
    errorMessage.value = `实时校准失败：${error.message}，当前展示构建期快照。`;
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => {
  window.setTimeout(() => refresh({ silent: true }), 800);
  timer = window.setInterval(() => refresh({ silent: true }), AUTO_REFRESH_MS);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
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
      构建期快照：{{ formatTime(lastChecked) }}（Asia/Shanghai）。打开页面后每 5
      分钟自动校准站点可达性与公开仓库更新时间；完整数据由 GitHub Actions
      在每次推送时同步。
      <span v-if="errorMessage" class="ph-error">{{ errorMessage }}</span>
    </p>
  </section>
</template>
