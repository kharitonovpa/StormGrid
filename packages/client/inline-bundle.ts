import { readFileSync, writeFileSync, unlinkSync, readdirSync, rmdirSync } from 'fs'
import { resolve, join } from 'path'

const dist = resolve(import.meta.dir, 'dist')
const htmlPath = join(dist, 'index.html')
let html = readFileSync(htmlPath, 'utf-8')

const assetsDir = join(dist, 'assets')
let files: string[]
try { files = readdirSync(assetsDir) } catch { process.exit(0) }

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
  if (readdirSync(assetsDir).length === 0) rmdirSync(assetsDir)
} catch {}

console.log(`Inlined → ${htmlPath} (${(html.length / 1024).toFixed(0)} kB)`)
