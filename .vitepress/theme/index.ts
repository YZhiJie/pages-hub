// 文件: .vitepress/theme/index.ts
// 用途: 注册项目导航组件并加载自定义样式
import DefaultTheme from 'vitepress/theme'
import ProjectExplorer from './components/ProjectExplorer.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ProjectExplorer', ProjectExplorer)
  }
}
