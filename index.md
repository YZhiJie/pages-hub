---
layout: home

hero:
  name: Pages Hub
  text: GitHub Pages 项目一站式导航
  tagline: 汇总全部在线文档站与演示站的访问地址、源码仓库与部署状态，推送即同步、打开即校准
  actions:
    - theme: brand
      text: 浏览全部项目
      link: /#projects
    - theme: alt
      text: 了解网站作用
      link: /guide/purpose

features:
  - title: 一处入口
    details: 把分散在不同仓库的 Pages 站点收拢到同一页面，按分类、状态和关键词快速定位。
  - title: 源码可追溯
    details: 每个在线站点同时给出源码仓库与部署仓库地址，私有源码会明确标注访问范围。
  - title: 推送即同步 + 实时校准
    details: push 到 main 后 GitHub Actions 自动全量同步并部署，页面打开期间每 5 分钟校准可达性。
---

## 这个网站的作用

Pages Hub 解决的是「站点越建越多、入口越来越散」的问题。它不复制任何教程内容，只维护一份**站点与源码的对应关系**：你在一个页面里就能找到某个在线站点的访问地址、它由哪个仓库构建、最近一次部署是什么时候，以及当前是否可访问。

它同时是一份可检索的作品地图：按分类浏览可以快速了解现有知识库覆盖了哪些主题，按状态筛选可以第一时间发现掉线或部署失败的站点。详细定位见[网站作用](/guide/purpose)，同步原理与数据字段见[同步机制](/guide/sync)。

## 全部项目

<ProjectExplorer />
