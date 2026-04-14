import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function platformHtmlPlugin(): Plugin {
  const platform = process.env.VITE_PLATFORM ?? ''
  return {
    name: 'platform-html',
    transformIndexHtml(html) {
      if (platform === 'yandex') {
        html = html.replace(
          '<!-- Telegram Mini App SDK',
          '<script src="/sdk.js"></script>\n    <!-- Telegram Mini App SDK',
        )
        html = html.replace(/\s*<link rel="preconnect"[^>]*fonts[^>]*\/?>(\s*\n?)?/g, '')
        html = html.replace(/\s*<link[^>]*fonts\.googleapis\.com[^>]*\/?>(\s*\n?)?/g, '')
        html = html.replace(/\s*<link rel="alternate"[^>]*hreflang[^>]*\/?>(\s*\n?)?/g, '')
        html = html.replace(/\s*<!-- i18n alternate -->\s*\n?/g, '')
      }
      return html
    },
  }
}

export default defineConfig({
  plugins: [vue(), platformHtmlPlugin()],
})
