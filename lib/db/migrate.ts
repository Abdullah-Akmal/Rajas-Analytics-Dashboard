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
    // Presto's per-location order number (e.g. "2.20368"). Shipday's orderNumber ends
    // with it ("80643_4719_2.20368"), which is how a delivery links to its POS order
    // and so to live revenue, food cost and commission (Operations corrections item 21).
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS "orderNo" TEXT`)
    await client.query(`CREATE INDEX IF NOT EXISTS orders_location_orderno_idx ON orders (location, "orderNo")`)
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

    // Brand separation (Rajas vs House of Peri Peri), sourced from the costing sheet's
    // banner rows. Defaults to 'Rajas' so existing rows keep their previous meaning until
    // the next costing sync re-stamps them from the sheet.
    await client.query(`ALTER TABLE dim_costing_item ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'Rajas'`)
    await client.query(`ALTER TABLE menu_items      ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'Rajas'`)
    await client.query(`CREATE INDEX IF NOT EXISTS dim_costing_item_brand_idx ON dim_costing_item(brand)`)

    // ── Pricing Engine (separate Google workbook, read-only source of truth) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_settings (
        id                      SERIAL PRIMARY KEY,
        store                   TEXT NOT NULL UNIQUE,
        "instoreTargetFcPct"    NUMERIC(6,4),
        "platformTargetFcPct"   NUMERIC(6,4),
        "platformCommissionPct" NUMERIC(6,4),
        "mealUplift"            NUMERIC(10,2),
        "amberTolerancePct"     NUMERIC(6,4),
        "lastSyncedAt"          TIMESTAMP DEFAULT NOW(),
        "updatedAt"             TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS pricing_item (
        id                       SERIAL PRIMARY KEY,
        store                    TEXT NOT NULL,
        "priceMode"              TEXT NOT NULL,
        category                 TEXT,
        "productName"            TEXT NOT NULL,
        "normalizedName"         TEXT NOT NULL,
        "canonicalId"            INTEGER REFERENCES dim_costing_item(id) ON DELETE SET NULL,
        "salesVolume"            TEXT,
        "soloCost"               NUMERIC(10,4),
        "mealCost"               NUMERIC(10,4),
        "currentSoloPrice"       NUMERIC(10,2),
        "currentMealPrice"       NUMERIC(10,2),
        "soloFcPct"              NUMERIC(6,4),
        "mealFcPct"              NUMERIC(6,4),
        "targetFcStatus"         TEXT,
        "competitorPrice"        NUMERIC(10,2),
        recommendation           TEXT,
        reason                   TEXT,
        "recommendedSoloPrice"   NUMERIC(10,2),
        "recommendedMealPrice"   NUMERIC(10,2),
        "finalSoloPrice"         NUMERIC(10,2),
        "finalMealPrice"         NUMERIC(10,2),
        "newSoloFcPct"           NUMERIC(6,4),
        "newMealFcPct"           NUMERIC(6,4),
        "lastSyncedAt"           TIMESTAMP DEFAULT NOW(),
        "updatedAt"              TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
    // One row per product per store per pricing section — the upsert target.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS pricing_item_key_idx ON pricing_item(store, "priceMode", "productName")`)
    await client.query(`CREATE INDEX IF NOT EXISTS pricing_item_norm_idx ON pricing_item("normalizedName")`)
    await client.query(`CREATE INDEX IF NOT EXISTS pricing_item_store_mode_idx ON pricing_item(store, "priceMode")`)
    await client.query(`CREATE INDEX IF NOT EXISTS pricing_item_canonical_idx ON pricing_item("canonicalId")`)

    // ── Owner-editable analytics settings (spec §5) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_settings (
        id          SERIAL PRIMARY KEY,
        key         TEXT NOT NULL,
        store       TEXT,
        channel     TEXT,
        value       TEXT NOT NULL,
        "updatedBy" TEXT,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS analytics_settings_key_idx ON analytics_settings(key)`)
    // NULL store/channel mean "all stores"/"not channel-specific", and a plain UNIQUE
    // index treats NULLs as distinct — so uniqueness is enforced per null-pattern.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS analytics_settings_scope_idx
                          ON analytics_settings(key, COALESCE(store,''), COALESCE(channel,''))`)

    // ── Manual driver shift log (spec §9) ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_shift (
        id           SERIAL PRIMARY KEY,
        store        TEXT NOT NULL,
        "driverName" TEXT NOT NULL,
        "shiftDate"  DATE NOT NULL,
        "startTime"  TIMESTAMP NOT NULL,
        "finishTime" TIMESTAMP NOT NULL,
        notes        TEXT,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS driver_shift_date_idx ON driver_shift("shiftDate")`)
    await client.query(`CREATE INDEX IF NOT EXISTS driver_shift_driver_idx ON driver_shift("driverName")`)

    // ── Product Master (spec §3) — long form of dim_costing_item ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_master (
        id                   SERIAL PRIMARY KEY,
        "productKey"         TEXT NOT NULL UNIQUE,
        "canonicalName"      TEXT NOT NULL,
        "displayName"        TEXT NOT NULL,
        brand                TEXT NOT NULL DEFAULT 'Rajas',
        "storeApplicability" TEXT NOT NULL DEFAULT 'both',
        category             TEXT,
        "productType"        TEXT NOT NULL DEFAULT 'other',
        size                 TEXT,
        variant              TEXT,
        "costingItemId"      INTEGER REFERENCES dim_costing_item(id) ON DELETE SET NULL,
        "currentCost"        NUMERIC(10,4),
        "costingStatus"      TEXT NOT NULL DEFAULT 'cost_missing',
        "currentPrice"       NUMERIC(10,2),
        "createdAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS product_master_brand_idx   ON product_master(brand)`)
    await client.query(`CREATE INDEX IF NOT EXISTS product_master_type_idx    ON product_master("productType")`)
    await client.query(`CREATE INDEX IF NOT EXISTS product_master_costing_idx ON product_master("costingItemId")`)
    await client.query(`CREATE INDEX IF NOT EXISTS product_master_status_idx  ON product_master("costingStatus")`)
    await client.query(`ALTER TABLE item_alias ADD COLUMN IF NOT EXISTS "productMasterId" INTEGER`)
    await client.query(`CREATE INDEX IF NOT EXISTS item_alias_pm_idx ON item_alias("productMasterId")`)

    // ── Offer setup records (spec §10) ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS offer (
        id                   SERIAL PRIMARY KEY,
        "offerId"            TEXT NOT NULL UNIQUE,
        name                 TEXT NOT NULL,
        brand                TEXT,
        store                TEXT,
        channel              TEXT,
        "startDate"          DATE NOT NULL,
        "endDate"            DATE,
        "offerType"          TEXT,
        "discountPercent"    NUMERIC(5,2),
        "minSpend"           NUMERIC(10,2),
        "rajasFundingPct"    NUMERIC(5,2) DEFAULT 100,
        "platformFundingPct" NUMERIC(5,2) DEFAULT 0,
        "posCategories"      TEXT,
        notes                TEXT,
        "createdAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt"          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS offer_dates_idx ON offer("startDate","endDate")`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_product (
        id                SERIAL PRIMARY KEY,
        "offerRowId"      INTEGER NOT NULL REFERENCES offer(id) ON DELETE CASCADE,
        "productMasterId" INTEGER REFERENCES product_master(id) ON DELETE CASCADE
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS offer_product_offer_idx ON offer_product("offerRowId")`)

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
