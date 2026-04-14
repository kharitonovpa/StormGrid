import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync, unlinkSync, readdirSync, rmdirSync } from 'fs'
import { resolve, join } from 'path'

function inlineBundle(): Plugin {
  return {
    name: 'inline-bundle',
    enforce: 'post',
    closeBundle() {
      const dist = resolve(__dirname, 'dist')
      const htmlPath = join(dist, 'index.html')
      let html = readFileSync(htmlPath, 'utf-8')

      const assetsDir = join(dist, 'assets')
      let files: string[]
      try { files = readdirSync(assetsDir) } catch { return }

      for (const f of files) {
        if (!f.endsWith('.js')) continue
        const code = readFileSync(join(assetsDir, f), 'utf-8')
        const safe = code.replaceAll('</script', '<\\/script')
        const tag = new RegExp(`<script[^>]*\\ssrc="/?assets/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*</script>`)
        html = html.replace(tag, () => `<script>${safe}</script>`)
        unlinkSync(join(assetsDir, f))
      }

      for (const f of files) {
        if (!f.endsWith('.css')) continue
        const css = readFileSync(join(assetsDir, f), 'utf-8')
        const tag = new RegExp(`<link[^>]*\\shref="/?assets/${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`)
        html = html.replace(tag, () => `<style>${css}</style>`)
        unlinkSync(join(assetsDir, f))
      }

      writeFileSync(htmlPath, html)

      try {
        const remaining = readdirSync(assetsDir)
        if (remaining.length === 0) rmdirSync(assetsDir)
      } catch {}
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), inlineBundle()],
  build: { modulePreload: false },
})
