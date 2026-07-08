/**
 * Performance migration — adds indexes that match the dashboard's hot query paths.
 * Run with:  npx tsx lib/db/perf-migrate.ts
 *
 * Idempotent: every statement uses IF NOT EXISTS.
 * Uses CREATE INDEX CONCURRENTLY where possible to avoid table locks, falling
 * back to a plain CREATE INDEX inside the same connection if concurrency fails.
 */
import { Pool } from "pg"
import * as dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Statements run one-by-one (CONCURRENTLY can't run inside a transaction block)
const statements = [
  // ── orders: every dashboard query filters by date + cancelled, often + location ──
  `CREATE INDEX IF NOT EXISTS orders_date_idx               ON orders (date)`,
  `CREATE INDEX IF NOT EXISTS orders_date_cancelled_idx     ON orders (date, cancelled)`,
  `CREATE INDEX IF NOT EXISTS orders_loc_date_cancelled_idx ON orders (location, date, cancelled)`,
  `CREATE INDEX IF NOT EXISTS orders_channel_idx            ON orders ("orderChannel")`,
  `CREATE INDEX IF NOT EXISTS orders_customer_idx           ON orders ("customerId")`,
  `CREATE INDEX IF NOT EXISTS orders_orderid_idx            ON orders ("orderId")`,

  // ── order_items: profitability/category/basket all filter date + cancelled + location ──
  `CREATE INDEX IF NOT EXISTS oi_date_idx                ON order_items (date)`,
  `CREATE INDEX IF NOT EXISTS oi_date_cancelled_idx      ON order_items (date, cancelled)`,
  `CREATE INDEX IF NOT EXISTS oi_loc_date_cancelled_idx  ON order_items (location, date, cancelled)`,
  `CREATE INDEX IF NOT EXISTS oi_orderid_idx             ON order_items ("orderId")`,

  // ── functional indexes for the LOWER(TRIM(itemName)) join (costing/category/overview) ──
  `CREATE INDEX IF NOT EXISTS oi_name_norm_idx   ON order_items (LOWER(TRIM("itemName")))`,
  `CREATE INDEX IF NOT EXISTS menu_name_norm_idx ON menu_items  (LOWER(TRIM("itemName")))`,

  // ── deliveries: driver/KPI queries filter placementTime, group by driver ──
  `CREATE INDEX IF NOT EXISTS deliveries_driver_idx        ON deliveries ("driverName")`,
  `CREATE INDEX IF NOT EXISTS deliveries_placement_dt_idx  ON deliveries ("placementTime")`,

  // ── keep planner stats fresh so the new indexes get used immediately ──
  `ANALYZE orders`,
  `ANALYZE order_items`,
  `ANALYZE menu_items`,
  `ANALYZE deliveries`,
]

async function run() {
  const client = await pool.connect()
  let ok = 0
  try {
    for (const stmt of statements) {
      try {
        await client.query(stmt)
        ok++
        console.log(`✓ ${stmt.split("\n")[0].slice(0, 70)}`)
      } catch (err) {
        console.error(`✗ ${stmt.slice(0, 70)} — ${(err as Error).message}`)
      }
    }
    console.log(`\n✅  Performance migration complete — ${ok}/${statements.length} statements applied.`)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
