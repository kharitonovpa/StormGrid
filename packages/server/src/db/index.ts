import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema.js'

const DB_PATH = process.env.DB_PATH || 'wheee.db'

const sqlite = new Database(DB_PATH)
sqlite.run('PRAGMA journal_mode = WAL')
sqlite.run('PRAGMA busy_timeout = 5000')
sqlite.run('PRAGMA foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export { schema }
export { sqlite }
