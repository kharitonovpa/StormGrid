import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('itch build is relative-pathed and carries no wheee.io-only markup', async () => {
  const clientDir = resolve(import.meta.dir, '../../../..')
  const outDir = await mkdtemp(resolve(tmpdir(), 'wheee-itch-build-'))

  try {
    const build = Bun.spawnSync({
      cmd: [process.execPath, 'x', 'vite', 'build', '--outDir', outDir],
      cwd: clientDir,
      env: { ...process.env, VITE_PLATFORM: 'itch', VITE_API_URL: 'https://api.wheee.io' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (!build.success) {
      throw new Error(build.stderr.toString())
    }

    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    // itch serves the archive from html-classic.itch.zone/html/<id>/, so a
    // root-absolute script path would 404.
    expect(html).toMatch(/src="\.\/assets\/[^"]+\.js"/)
    expect(html).not.toMatch(/(src|href)="\/(assets|favicon)/)
    expect(html).not.toContain('telegram-web-app.js')
    expect(html).not.toContain('hreflang')
    expect(html).toContain('fonts.googleapis.com')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 120_000)
