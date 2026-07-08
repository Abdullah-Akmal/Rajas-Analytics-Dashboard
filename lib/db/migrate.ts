/**
 * One-shot migration script — run with:
 *   npx tsx lib/db/migrate.ts
 *
 * Idempotent: uses IF NOT EXISTS / DO NOTHING throughout.
 */
import { Pool } from "pg"
import * as dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`
      CREATE TABLE IF NOT EXISTS dim_costing_item (
        id                       SERIAL PRIMARY KEY,
        "canonicalName"          TEXT NOT NULL UNIQUE,
        category                 TEXT,
        "itemType"               TEXT,
        cost8inch                NUMERIC(10,2),
        cost12inch               NUMERIC(10,2),
        cost16inch               NUMERIC(10,2),
        "costSolo"               NUMERIC(10,2),
        "costMeal"               NUMERIC(10,2),
        "primaryCost"            NUMERIC(10,2),
        "sellingPriceHydePark"   NUMERIC(10,2),
        "sellingPriceGrandArcade" NUMERIC(10,2),
        "lastSyncedAt"           TIMESTAMPTZ DEFAULT NOW(),
        "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS item_alias (
        id                SERIAL PRIMARY KEY,
        "normalizedRaw"   TEXT NOT NULL UNIQUE,
        "canonicalId"     INTEGER REFERENCES dim_costing_item(id) ON DELETE SET NULL,
        size              TEXT,
        variant           TEXT,
        "matchMethod"     TEXT,
        confidence        NUMERIC(4,3),
        reviewed          BOOLEAN NOT NULL DEFAULT FALSE,
        "posCategoryName" TEXT,
        "isModifier"      BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS item_alias_canonical_idx ON item_alias("canonicalId")
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS item_alias_reviewed_idx ON item_alias(reviewed)
    `)

    // Add orderTime column to orders (idempotent)
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS "orderTime" TIMESTAMPTZ`)
    await client.query(`CREATE INDEX IF NOT EXISTS orders_order_time_idx ON orders("orderTime")`)

    // Add new columns to deliveries for on-time KPIs, distance, location analysis
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "requestedPickupTime" TIMESTAMPTZ`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "requestedDeliveryTime" TIMESTAMPTZ`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT FALSE`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "pickupName" TEXT`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "pickupAddress" TEXT`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "pickupLat" NUMERIC(10,7)`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "pickupLng" NUMERIC(10,7)`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "deliveryName" TEXT`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "deliveryAddress" TEXT`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "deliveryLat" NUMERIC(10,7)`)
    await client.query(`ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS "deliveryLng" NUMERIC(10,7)`)
    await client.query(`CREATE INDEX IF NOT EXISTS deliveries_placement_idx ON deliveries("placementTime")`)

    // Execution tracker table
    await client.query(`
      CREATE TABLE IF NOT EXISTS action_items (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        detail      TEXT,
        category    TEXT,
        priority    TEXT NOT NULL DEFAULT 'medium',
        owner       TEXT,
        deadline    DATE,
        status      TEXT NOT NULL DEFAULT 'todo',
        impact      TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS action_items_status_idx ON action_items(status)`)

    await client.query("COMMIT")
    console.log("✅  Migration complete — all tables ready.")
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("❌  Migration failed:", err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
