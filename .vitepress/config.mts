// 文件: .vitepress/config.mts
// 用途: Pages Hub 站点配置（GitHub Pages 项目站点子路径 /pages-hub/）
import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "zh-CN",
  title: "Pages Hub",
  description:
    "全部 GitHub Pages 在线站点与源码仓库的一站式导航，定时同步、实时校准",
  base: "/pages-hub/",
  cleanUrls: true,
  srcExclude: ["README.md"],
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "/pages-hub/favicon.svg" }]],

  themeConfig: {
    siteTitle: "Pages Hub",
    nav: [
      { text: "全部项目", link: "/projects" },
      { text: "网站作用", link: "/guide/purpose" },
      { text: "同步机制", link: "/guide/sync" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "关于本站",
          items: [
            { text: "网站作用", link: "/guide/purpose" },
            { text: "同步机制", link: "/guide/sync" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/YZhiJie/pages-hub" },
    ],
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "搜索项目", buttonAriaLabel: "搜索项目" },
          modal: {
            noResultsText: "未找到相关项目",
            resetButtonTitle: "清空关键词",
            footer: {
              selectText: "选择",
              navigateText: "切换",
              closeText: "关闭",
            },
          },
        },
      },
    },
    footer: {
      message: "数据由 GitHub API 自动同步，每 30 分钟刷新一次",
      copyright: "Pages Hub",
    },
  },
});
