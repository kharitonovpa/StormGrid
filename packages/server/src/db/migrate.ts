import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(__dirname, '../../drizzle')

export function runMigrations() {
  migrate(db, { migrationsFolder })
}
