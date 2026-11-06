import { defineConfig, presetWind3 } from 'unocss'

// UnoCSS 配置：布局一律使用原子类，禁止长串自定义 CSS
export default defineConfig({
  presets: [presetWind3()],
})
