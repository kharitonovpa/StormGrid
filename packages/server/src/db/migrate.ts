import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcPath = resolve(__dirname, '../../drizzle')
const bundlePath = join(__dirname, 'drizzle')
const migrationsFolder = existsSync(srcPath) ? srcPath : bundlePath

export function runMigrations() {
  migrate(db, { migrationsFolder })
}
