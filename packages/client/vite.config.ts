import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const platform = process.env.VITE_PLATFORM ?? ''
const GP_PROJECT_ID = process.env.VITE_GP_PROJECT_ID ?? ''
const GP_PUBLIC_TOKEN = process.env.VITE_GP_PUBLIC_TOKEN ?? ''

function stripExternalMeta(html: string): string {
  html = html.replace(/\s*<link rel="preconnect"[^>]*fonts[^>]*\/?>(\s*\n?)?/g, '')
  html = html.replace(/\s*<link[^>]*fonts\.googleapis\.com[^>]*\/?>(\s*\n?)?/g, '')
  html = html.replace(/\s*<link rel="alternate"[^>]*hreflang[^>]*\/?>(\s*\n?)?/g, '')
  html = html.replace(/\s*<!-- i18n alternate -->\s*\n?/g, '')
  return html
}

function stripTelegramSdk(html: string): string {
  html = html.replace(/\s*<!-- Telegram Mini App SDK[^]*?<\/script>\s*\n?/g, '')
  return html
}

if (platform === 'gamepush') {
  if (!GP_PROJECT_ID || !GP_PUBLIC_TOKEN) {
    throw new Error('VITE_GP_PROJECT_ID and VITE_GP_PUBLIC_TOKEN must be set for gamepush builds')
  }
}

function platformHtmlPlugin(): Plugin {
  return {
    name: 'platform-html',
    transformIndexHtml(html) {
      if (platform === 'yandex' || platform === 'gamepush') {
        html = stripExternalMeta(html)
        html = stripTelegramSdk(html)
      }

      if (platform === 'yandex') {
        html = html.replace(
          '</head>',
          '    <script src="/sdk.js"></script>\n  </head>',
        )
      }

      if (platform === 'gamepush') {
        const gpScript = `<script async src="https://gamepush.com/sdk/game-score.js?projectId=${GP_PROJECT_ID}&publicToken=${GP_PUBLIC_TOKEN}&callback=onGPInit"></script>`
        html = html.replace(
          '</head>',
          `    ${gpScript}\n  </head>`,
        )
      }

      return html
    },
  }
}

const useRelativeBase = platform === 'yandex' || platform === 'gamepush'

export default defineConfig({
  base: useRelativeBase ? './' : '/',
  plugins: [vue(), platformHtmlPlugin()],
})
