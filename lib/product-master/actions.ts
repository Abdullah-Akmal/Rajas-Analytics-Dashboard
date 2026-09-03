"use server"

import { db } from "@/lib/db"
import { productMaster, syncLogs } from "@/lib/db/schema"
import { sql } from "drizzle-orm"
import { classifyProductType } from "@/lib/product-master/classify"

function safeRevalidate(path: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("next/cache").revalidatePath(path)
  } catch {
    // no-op outside a Next.js request context
  }
}

/**
 * Rebuild product_master from dim_costing_item (spec §3).
 *
 * dim_costing_item is wide — one row with cost8inch/cost12inch/cost16inch/costSolo/
 * costMeal columns. This unpivots it so every sellable variant becomes its own row
 * with a permanent Product_Master_ID, satisfying the spec's requirement that Solo and
 * Meal be independently identifiable.
 *
 * productKey is a stable business key (canonical name + variant discriminator) so a
 * rebuild updates rows in place rather than renumbering ids that other tables
 * reference.
 */
export async function buildProductMaster() {
  try {
    type CostingRow = {
      id: number
      canonicalName: string
      brand: string
      category: string | null
      itemType: string | null
      cost8inch: string | null
      cost12inch: string | null
      cost16inch: string | null
      costSolo: string | null
      costMeal: string | null
      primaryCost: string | null
    }
    const costings = await db.execute<CostingRow>(sql`
      SELECT id, "canonicalName", brand, category, "itemType",
             cost8inch, cost12inch, cost16inch, "costSolo", "costMeal", "primaryCost"
        FROM dim_costing_item`)

    type Row = {
      productKey: string
      canonicalName: string
      displayName: string
      brand: string
      storeApplicability: string
      category: string | null
      productType: string
      size: string | null
      variant: string | null
      costingItemId: number
      currentCost: string | null
      costingStatus: string
    }
    const rows: Row[] = []

    const push = (
      c: CostingRow, size: string | null, variant: string | null, cost: string | null,
    ) => {
      const suffix = size ? `${size}"` : variant ? variant : ""
      const key = `${c.canonicalName.trim().toLowerCase()}::${size ?? ""}::${variant ?? ""}`
      const display = suffix
        ? `${c.canonicalName.trim()} - ${size ? `${size}"` : variant === "meal" ? "Meal" : "Solo"}`
        : c.canonicalName.trim()
      const n = cost === null ? null : Number(cost)
      rows.push({
        productKey: key,
        canonicalName: c.canonicalName.trim(),
        displayName: display,
        brand: c.brand || "Rajas",
        // House of Peri Peri trades from Hyde Park only; everything else is at both.
        storeApplicability: c.brand && c.brand !== "Rajas" ? "Hyde Park" : "both",
        category: c.category,
        productType: classifyProductType(c.category, variant, size),
        size,
        variant,
        costingItemId: c.id,
        currentCost: cost,
        // §4 missing-cost rule: no cost ⇒ COST MISSING, never a silent zero.
        costingStatus: n !== null && n > 0 ? "costed" : "cost_missing",
      })
    }

    for (const c of costings.rows) {
      const has = (v: string | null) => v !== null && v !== undefined && Number(v) > 0
      let emitted = false

      // Pizzas — one product per size that actually carries a cost.
      for (const [size, cost] of [["8", c.cost8inch], ["12", c.cost12inch], ["16", c.cost16inch]] as const) {
        if (has(cost)) { push(c, size, null, cost); emitted = true }
      }
      // Solo / Meal — the split the spec explicitly calls out.
      if (has(c.costSolo)) { push(c, null, "solo", c.costSolo); emitted = true }
      if (has(c.costMeal)) { push(c, null, "meal", c.costMeal); emitted = true }

      // Single-cost products, and anything with no cost at all — the latter still
      // gets a Product Master row so it appears as a COST MISSING exception rather
      // than vanishing from the catalogue.
      if (!emitted) push(c, null, null, has(c.primaryCost) ? c.primaryCost : null)
    }

    if (rows.length === 0) return { success: false, error: "No costing items to build from" }

    const now = new Date()
    for (let i = 0; i < rows.length; i += 100) {
      await db
        .insert(productMaster)
        .values(rows.slice(i, i + 100).map((r) => ({ ...r, updatedAt: now })) as never)
        .onConflictDoUpdate({
          target: productMaster.productKey,
          set: {
            canonicalName: sql`EXCLUDED."canonicalName"`,
            displayName: sql`EXCLUDED."displayName"`,
            brand: sql`EXCLUDED.brand`,
            storeApplicability: sql`EXCLUDED."storeApplicability"`,
            category: sql`EXCLUDED.category`,
            productType: sql`EXCLUDED."productType"`,
            size: sql`EXCLUDED.size`,
            variant: sql`EXCLUDED.variant`,
            costingItemId: sql`EXCLUDED."costingItemId"`,
            currentCost: sql`EXCLUDED."currentCost"`,
            costingStatus: sql`EXCLUDED."costingStatus"`,
            updatedAt: sql`EXCLUDED."updatedAt"`,
          },
        })
    }

    // ── Link POS aliases to their Product_Master_ID ──────────────────────────
    // The alias already carries decoded size/variant, so the match is exact.
    await db.execute(sql`
      UPDATE item_alias ia
         SET "productMasterId" = pm.id
        FROM product_master pm
       WHERE pm."costingItemId" = ia."canonicalId"
         AND COALESCE(pm.size, '')    = COALESCE(ia.size, '')
         AND COALESCE(pm.variant, '') = COALESCE(ia.variant, '')`)
    // Aliases whose decoded size/variant matches no product fall back to that costing
    // item's PRIMARY product. Restricting the fallback to single-product items left
    // most POS lines unlinked — anything split across solo/meal or three pizza sizes
    // matched nothing, and only ~13% of revenue reached the Product Master.
    //
    // The precedence below mirrors how the costing parser already picks primaryCost
    // (solo before meal; 12" before 8" before 16"), so an unqualified POS name resolves
    // to the same product the cost lookup would have used.
    await db.execute(sql`
      UPDATE item_alias ia
         SET "productMasterId" = s.id
        FROM (
          SELECT DISTINCT ON ("costingItemId") "costingItemId", id
            FROM product_master
           ORDER BY "costingItemId",
                    CASE WHEN variant = 'solo' THEN 0
                         WHEN variant = 'meal' THEN 1
                         WHEN size    = '12'   THEN 2
                         WHEN size    = '8'    THEN 3
                         WHEN size    = '16'   THEN 4
                         ELSE 5 END,
                    id
        ) s
       WHERE ia."productMasterId" IS NULL
         AND s."costingItemId" = ia."canonicalId"`)

    // ── Current selling price from the pricing engine ────────────────────────
    // Instore price is what customers are charged at the counter; solo vs meal
    // picks the matching column. Platform prices are handled per-channel later.
    await db.execute(sql`
      UPDATE product_master pm
         SET "currentPrice" = p.price
        FROM (
          SELECT lower(btrim("normalizedName")) AS nk,
                 AVG("currentSoloPrice")::numeric AS solo,
                 AVG("currentMealPrice")::numeric AS meal,
                 COALESCE(AVG("currentSoloPrice"), AVG("currentMealPrice"))::numeric AS price
            FROM pricing_item
           WHERE "priceMode" = 'instore'
           GROUP BY 1
        ) p
       WHERE lower(btrim(pm."canonicalName")) = p.nk`)
    await db.execute(sql`
      UPDATE product_master pm
         SET "currentPrice" = p.meal
        FROM (
          SELECT lower(btrim("normalizedName")) AS nk, AVG("currentMealPrice")::numeric AS meal
            FROM pricing_item WHERE "priceMode" = 'instore' GROUP BY 1
        ) p
       WHERE pm.variant = 'meal'
         AND p.meal IS NOT NULL
         AND lower(btrim(pm."canonicalName")) = p.nk`)

    const stats = await db.execute<{
      total: string; costed: string; missing: string; brands: string; linked: string
    }>(sql`
      SELECT (SELECT COUNT(*)::text FROM product_master) AS total,
             (SELECT COUNT(*)::text FROM product_master WHERE "costingStatus" = 'costed') AS costed,
             (SELECT COUNT(*)::text FROM product_master WHERE "costingStatus" <> 'costed') AS missing,
             (SELECT COUNT(DISTINCT brand)::text FROM product_master) AS brands,
             (SELECT COUNT(*)::text FROM item_alias WHERE "productMasterId" IS NOT NULL) AS linked`)
    const s = stats.rows[0]

    await db.insert(syncLogs).values({
      source: "product_master",
      status: "success",
      recordsProcessed: rows.length,
      errorMessage: `${s?.costed} costed, ${s?.missing} cost-missing, ${s?.linked} aliases linked`,
    })

    safeRevalidate("/dashboard")
    safeRevalidate("/dashboard/settings")

    return {
      success: true,
      products: Number(s?.total ?? 0),
      costed: Number(s?.costed ?? 0),
      costMissing: Number(s?.missing ?? 0),
      brands: Number(s?.brands ?? 0),
      aliasesLinked: Number(s?.linked ?? 0),
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    await db.insert(syncLogs).values({ source: "product_master", status: "error", errorMessage: msg })
    return { success: false, error: msg }
  }
}

/** Distinct brands present in the Product Master — drives the Brand filter (§11). */
export async function getBrands(): Promise<string[]> {
  const r = await db.execute<{ brand: string }>(
    sql`SELECT DISTINCT brand FROM product_master ORDER BY brand`)
  return r.rows.map((x) => x.brand)
}

/** Distinct product types present — drives the Product Type filter (§11). */
export async function getProductTypes(): Promise<string[]> {
  const r = await db.execute<{ t: string }>(
    sql`SELECT DISTINCT "productType" AS t FROM product_master ORDER BY 1`)
  return r.rows.map((x) => x.t)
}

/** Distinct categories — drives the Category filter (§11). */
export async function getProductCategories(): Promise<string[]> {
  const r = await db.execute<{ c: string }>(sql`
    SELECT DISTINCT category AS c FROM product_master
     WHERE category IS NOT NULL AND btrim(category) <> '' ORDER BY 1`)
  return r.rows.map((x) => x.c)
}
