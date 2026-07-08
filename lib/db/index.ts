import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Lazy singletons — created on first access so dotenv.config() in CLI scripts
// runs before DATABASE_URL is read (ESM hoists imports before any code runs).
let _pool: Pool | null = null
let _db: NodePgDatabase<typeof schema> | null = null

// Errors that mean "the socket died underneath us", not "the query is bad" —
// safe to retry once on a fresh connection.
function isTransientConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  return (
    msg.includes("Connection terminated") ||
    msg.includes("connection timeout") ||
    code === "ECONNRESET" ||
    code === "57P01" // Postgres: admin shutdown / terminated by Neon's pooler
  )
}

export function getPool(): Pool {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set. Load .env.local before importing lib/db.'
      )
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Tuned for Neon: keep a small warm pool so we avoid slow cold reconnects,
      // but stay well under Neon's connection cap. keepAlive prevents idle drops.
      // idleTimeoutMillis kept short so OUR pool retires idle clients before
      // Neon's proxy silently kills them server-side — a client pg still thinks
      // is alive but Neon has already dropped is what causes "Connection
      // terminated unexpectedly" on the next checkout.
      max: 10,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
    })
    // Neon terminates idle connections server-side. Without a listener, a dropped
    // idle client surfaces as a generic "Failed query" on the next checkout.
    // Handling the event lets pg evict the dead client and reconnect cleanly.
    _pool.on("error", (err) => {
      console.error("[db pool] idle client error (evicted):", err.message)
    })

    // Drizzle (node-postgres driver) calls pool.query() directly for non-transaction
    // queries. If Neon already dropped the underlying socket, that call throws a
    // generic "Connection terminated" error. Retrying once on a freshly-checked-out
    // client fixes the vast majority of these without surfacing a crash to the page.
    const rawQuery = _pool.query.bind(_pool)
    ;(_pool as unknown as { query: typeof rawQuery }).query = (async (...args: Parameters<typeof rawQuery>) => {
      try {
        return await rawQuery(...args)
      } catch (err) {
        if (!isTransientConnectionError(err)) throw err
        console.warn("[db pool] transient connection error — retrying once:", err instanceof Error ? err.message : err)
        return await rawQuery(...args)
      }
    }) as typeof rawQuery
  }
  return _pool
}

function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getPool(), { schema })
  }
  return _db
}

// Proxy so existing `import { pool }` / `import { db }` callers work unchanged.
export const pool: Pool = new Proxy({} as Pool, {
  get(_t, prop) { return (getPool() as any)[prop] },
})

export const db: NodePgDatabase<typeof schema> = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, prop) { return (getDb() as any)[prop] },
})
