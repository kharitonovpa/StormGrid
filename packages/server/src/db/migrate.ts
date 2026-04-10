import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from './index.js'

export function runMigrations() {
  migrate(db, { migrationsFolder: './drizzle' })
}
