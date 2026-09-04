import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('injects the GamePush SDK from the Yandex-whitelisted host', async () => {
  const clientDir = resolve(import.meta.dir, '../../../..')
  const outDir = await mkdtemp(resolve(tmpdir(), 'wheee-gamepush-build-'))

  try {
    const build = Bun.spawnSync({
      cmd: [process.execPath, 'x', 'vite', 'build', '--outDir', outDir],
      cwd: clientDir,
      env: {
        ...process.env,
        VITE_PLATFORM: 'gamepush',
        VITE_GP_PROJECT_ID: 'test-project',
        VITE_GP_PUBLIC_TOKEN: 'test-token',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (!build.success) {
      throw new Error(build.stderr.toString())
    }

    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain(
      'https://gs.eponesh.com/sdk/game-score.js?projectId=test-project&publicToken=test-token&callback=onGPInit',
    )
    expect(html).not.toContain('https://gamepush.com/sdk/game-score.js')
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
})
