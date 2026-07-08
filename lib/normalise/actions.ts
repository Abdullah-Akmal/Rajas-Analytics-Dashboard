"use server"

import { db } from "@/lib/db"
import { dimCostingItem, itemAlias, orderItems, syncLogs } from "@/lib/db/schema"
import { sql, eq, isNull, or, lt } from "drizzle-orm"
// Safe wrapper — revalidatePath throws outside Next.js request context (CLI scripts)
function safeRevalidate(path: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("next/cache").revalidatePath(path)
  } catch {
    // no-op outside Next.js
  }
}
import {
  normalizeRaw,
  isModifierCategory,
  isDealCategory,
  isPizzaCategory,
  decodePizza,
  matchNonPizza,
  detectVariant,
} from "@/lib/normalise"

// ─── 1. Sync Item Costing tab → dim_costing_item ─────────────────────────────

/**
 * Pulls the "Item Costing" sheet tab, parses all three section types
 * (pizza / solo_meal / simple) and upserts into dim_costing_item.
 * Returns { success, count } or { success: false, error }.
 */
export async function syncCostingSheet() {
  try {
    const { google } = await import("googleapis")
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    })

    const sheets = google.sheets({ version: "v4", auth })
    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID || "1mWyvmYnTz7Ewe2vzAkS_st1Ti9aLxPO-WW8IV8LCUP8"

    // Find the costing tab
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId })
    const sheetNames =
      spreadsheet.data.sheets?.map((s) => s.properties?.title).filter(Boolean) || []

    const costingTab =
      sheetNames.find(
        (n) =>
          n?.toLowerCase().includes("costing") ||
          n?.toLowerCase().includes("item")
      ) || sheetNames[0]

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      // Wide row cap with headroom — the sheet grows as new sections (e.g. "Offers")
      // get appended below existing content. A tight cap silently truncates new sections.
      range: `${costingTab}!A1:AH1000`,
    })

    const rows: string[][] = (response.data.values || []) as string[][]
    if (rows.length < 2) {
      return { success: false, error: `No data in sheet tab: ${costingTab}` }
    }

    const parseNum = (v: string | undefined): string | null => {
      if (!v) return null
      const n = parseFloat(v.toString().replace(/[£$€,\s]/g, ""))
      return isNaN(n) || n < 0 ? null : n.toString()
    }

    type SectionType = "pizza" | "solo_meal" | "simple"
    type ColMap = { cost8?: number; cost12?: number; cost16?: number; costSolo?: number; costMeal?: number; primary?: number; hp?: number; ga?: number }
    type Section = { type: SectionType; cols: ColMap }

    // Header-driven: read the section's header row and record WHICH column holds each
    // cost. The sheet places cost columns at different positions per section (single-cost
    // sections like "Cost Price" / "Meal Cost" / "Cost" sit in col C, pizzas span C–D,
    // etc.) so fixed indices miss most of them. Detecting by header text is robust.
    const parseHeader = (row: string[]): Section | null => {
      const cells = row.map((c) => (c ?? "").toString().toLowerCase().trim())
      const isHeader = cells.some((c) => c === "name" || c === "name " || c.includes("product"))
      if (!isHeader) return null
      const cols: ColMap = {}
      cells.forEach((c, idx) => {
        if (!c) return
        if (c.includes('8"') || c.includes("8 pizza") || c.includes("8inch")) cols.cost8 ??= idx
        else if (c.includes('12"') || c.includes("12 pizza") || c.includes("12inch")) cols.cost12 ??= idx
        else if (c.includes('16"') || c.includes("16 pizza") || c.includes("16inch")) cols.cost16 ??= idx
        else if (c === "solo cost") cols.costSolo ??= idx
        else if (c === "meal cost") cols.costMeal ??= idx
        else if (c.includes("hyde")) cols.hp ??= idx
        else if (c.includes("grand") || c.includes("arcade")) cols.ga ??= idx
        else if (c.includes("cost")) cols.primary ??= idx // generic "Cost" / "Cost Price"
      })
      let type: SectionType
      if (cols.cost8 !== undefined || cols.cost12 !== undefined) type = "pizza"
      else if (cols.costSolo !== undefined || cols.costMeal !== undefined) type = "solo_meal"
      else type = "simple"
      return { type, cols }
    }

    type ItemRow = {
      canonicalName: string
      category: string | null
      itemType: SectionType
      cost8inch: string | null
      cost12inch: string | null
      cost16inch: string | null
      costSolo: string | null
      costMeal: string | null
      primaryCost: string | null
      sellingPriceHydePark: string | null
      sellingPriceGrandArcade: string | null
    }

    const items: ItemRow[] = []
    let currentCategory: string | null = null
    let currentSection: Section | null = null

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.length === 0) continue

      const colA = row[0]?.toString().trim()
      const colB = row[1]?.toString().trim()

      // Category header: col A has text, col B is empty
      if ((!colB || colB === "") && colA && colA.length > 0) {
        if (
          colA !== "Product No." &&
          isNaN(Number(colA)) &&
          !colA.startsWith("£")
        ) {
          currentCategory = colA
          currentSection = null
        }
        continue
      }

      // Section header row
      if (
        colA?.toLowerCase().includes("product") ||
        colA?.toLowerCase() === "product no."
      ) {
        const s = parseHeader(row)
        if (s) currentSection = s
        continue
      }

      // Data row: col A must be numeric
      if (isNaN(parseFloat(colA)) && !colA?.startsWith("£")) continue
      if (!colB || colB.length === 0 || colB === "-") continue
      if (!isNaN(Number(colB)) || colB.startsWith("£")) continue

      const name = colB.trim()
      let cost8: string | null = null
      let cost12: string | null = null
      let cost16: string | null = null
      let costSolo: string | null = null
      let costMeal: string | null = null
      let primary: string | null = null
      let priceHP: string | null = null
      let priceGA: string | null = null

      const cols = currentSection?.cols ?? {}
      const at = (idx?: number) => (idx === undefined ? null : parseNum(row[idx]))
      cost8 = at(cols.cost8)
      cost12 = at(cols.cost12)
      cost16 = at(cols.cost16)
      costSolo = at(cols.costSolo)
      costMeal = at(cols.costMeal)
      priceHP = at(cols.hp)
      priceGA = at(cols.ga)
      if (currentSection?.type === "pizza") primary = cost12 ?? cost8
      else if (currentSection?.type === "solo_meal") primary = costSolo ?? costMeal
      else primary = at(cols.primary)

      items.push({
        canonicalName: name,
        category: currentCategory,
        itemType: currentSection?.type || "simple",
        cost8inch: cost8,
        cost12inch: cost12,
        cost16inch: cost16,
        costSolo,
        costMeal,
        primaryCost: primary,
        sellingPriceHydePark: priceHP,
        sellingPriceGrandArcade: priceGA,
      })
    }

    if (items.length === 0) {
      return { success: false, error: "Parsed 0 items from sheet" }
    }

    // Upsert in batches of 50
    const now = new Date()
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50).map((it) => ({
        ...it,
        lastSyncedAt: now,
        updatedAt: now,
      }))
      await db
        .insert(dimCostingItem)
        .values(batch)
        .onConflictDoUpdate({
          target: dimCostingItem.canonicalName,
          set: {
            category: sql`EXCLUDED.category`,
            itemType: sql`EXCLUDED."itemType"`,
            cost8inch: sql`EXCLUDED.cost8inch`,
            cost12inch: sql`EXCLUDED.cost12inch`,
            cost16inch: sql`EXCLUDED.cost16inch`,
            costSolo: sql`EXCLUDED."costSolo"`,
            costMeal: sql`EXCLUDED."costMeal"`,
            primaryCost: sql`EXCLUDED."primaryCost"`,
            sellingPriceHydePark: sql`EXCLUDED."sellingPriceHydePark"`,
            sellingPriceGrandArcade: sql`EXCLUDED."sellingPriceGrandArcade"`,
            lastSyncedAt: sql`EXCLUDED."lastSyncedAt"`,
            updatedAt: sql`EXCLUDED."updatedAt"`,
          },
        })
    }

    await db.insert(syncLogs).values({
      source: "costing_sheet",
      status: "success",
      recordsProcessed: items.length,
    })

    safeRevalidate("/dashboard/costing")
    return { success: true, count: items.length }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    await db.insert(syncLogs).values({
      source: "costing_sheet",
      status: "error",
      errorMessage: msg,
    })
    return { success: false, error: msg }
  }
}

// ─── 2. Normalise order_items → item_alias ───────────────────────────────────

/**
 * Reads every distinct (trimmed) itemName from order_items that is NOT already
 * in item_alias, then runs the full match pipeline and upserts results.
 *
 * Safe to re-run: existing rows with reviewed=true are never overwritten.
 */
export async function normaliseOrderItems() {
  // Load all canonical costing names
  const costings = await db.select().from(dimCostingItem)
  if (costings.length === 0) {
    return { success: false, error: "dim_costing_item is empty — sync the costing sheet first" }
  }

  const allCanonical = costings.map((c) => c.canonicalName)
  const pizzaCanonical = costings
    .filter((c) => c.itemType === "pizza")
    .map((c) => c.canonicalName)
  const nonPizzaCanonical = costings
    .filter((c) => c.itemType !== "pizza")
    .map((c) => c.canonicalName)

  // Get all distinct (raw itemName, categoryName) combos not yet in item_alias
  // (or where the alias is unresolved and not manually reviewed)
  const rawRows = await db.execute<{ itemName: string; categoryName: string | null }>(
    sql`
      SELECT DISTINCT
        "itemName",
        "categoryName"
      FROM order_items
      WHERE TRIM("itemName") NOT IN (
        SELECT "normalizedRaw" FROM item_alias WHERE reviewed = TRUE
      )
    `
  )

  let matched = 0
  let modifier = 0
  let deal = 0
  let inReview = 0
  let total = 0

  for (const row of rawRows.rows) {
    total++
    const raw = row.itemName ?? ""
    const cat = row.categoryName ?? null
    const normalized = normalizeRaw(raw)

    // ── Classify ──────────────────────────────────────────────────────────
    if (isModifierCategory(cat)) {
      await upsertAlias({
        normalizedRaw: normalized,
        canonicalId: null,
        size: null,
        variant: null,
        matchMethod: "modifier",
        confidence: "1.000",
        reviewed: true,        // modifiers don't need human review
        posCategoryName: cat,
        isModifier: true,
      })
      modifier++
      continue
    }

    // ── Manual override ───────────────────────────────────────────────────
    // (checked before algorithm so confirmed fixes always win)
    const MANUAL_OVERRIDES: Record<string, string> = {
      "12inch M": "12inch Mushroom Pizza",
    }
    const override = MANUAL_OVERRIDES[normalized.trim()]
    if (override) {
      const canonical = costings.find((c) => c.canonicalName === override)
      await upsertAlias({
        normalizedRaw: normalized,
        canonicalId: canonical?.id ?? null,
        size: extractPizzaSize(normalized),
        variant: detectVariant(normalized, cat),
        matchMethod: "manual",
        confidence: "1.000",
        reviewed: true,
        posCategoryName: cat,
        isModifier: false,
      })
      matched++
      continue
    }

    // ── Pizza decode ──────────────────────────────────────────────────────
    if (isPizzaCategory(cat)) {
      const result = decodePizza(normalized, pizzaCanonical)
      if (result.matched) {
        const canonical = costings.find((c) => c.canonicalName === result.canonicalName)
        await upsertAlias({
          normalizedRaw: normalized,
          canonicalId: canonical?.id ?? null,
          size: result.size,
          variant: null,
          matchMethod: result.method,
          confidence: "1.000",
          reviewed: false,
          posCategoryName: cat,
          isModifier: false,
        })
        matched++
        continue
      }

      // no_size: POS has the full canonical name without a size prefix (e.g. "Queen Margherita Pizza").
      // Fall through to non-pizza matching — the sheet stores these without size.
      if (!result.matched && result.reason === "no_size") {
        const fallback = matchNonPizza(normalized, allCanonical)
        if (fallback.matched) {
          const canonical = costings.find((c) => c.canonicalName === fallback.canonicalName)
          await upsertAlias({
            normalizedRaw: normalized,
            canonicalId: canonical?.id ?? null,
            size: null,
            variant: null,
            matchMethod: fallback.method,
            confidence: fallback.confidence.toFixed(3),
            reviewed: fallback.confidence < 1,
            posCategoryName: cat,
            isModifier: false,
          })
          fallback.confidence >= 1 ? matched++ : inReview++
          continue
        }
      }

      // Ambiguous or truly no match
      await upsertAlias({
        normalizedRaw: normalized,
        canonicalId: null,
        size: extractPizzaSize(normalized),
        variant: null,
        matchMethod: "unmatched",
        confidence: null,
        reviewed: false,
        posCategoryName: cat,
        isModifier: false,
      })
      inReview++
      continue
    }

    // ── Deal / wrapper lines ──────────────────────────────────────────────
    if (isDealCategory(cat)) {
      // Match against non-pizza canonicals; flag uncosted deals
      const result = matchNonPizza(normalized, nonPizzaCanonical)
      if (result.matched) {
        const canonical = costings.find((c) => c.canonicalName === result.canonicalName)
        await upsertAlias({
          normalizedRaw: normalized,
          canonicalId: canonical?.id ?? null,
          size: null,
          variant: detectVariant(normalized, cat),
          matchMethod: result.method,
          confidence: result.confidence.toFixed(3),
          reviewed: result.confidence < 1,   // fuzzy matches need review
          posCategoryName: cat,
          isModifier: false,
        })
        result.confidence >= 1 ? matched++ : inReview++
      } else {
        await upsertAlias({
          normalizedRaw: normalized,
          canonicalId: null,
          size: null,
          variant: detectVariant(normalized, cat),
          matchMethod: "unmatched",
          confidence: null,
          reviewed: false,
          posCategoryName: cat,
          isModifier: false,
        })
        inReview++
      }
      continue
    }

    // ── General non-pizza items ───────────────────────────────────────────
    const result = matchNonPizza(normalized, allCanonical)
    if (result.matched) {
      const canonical = costings.find((c) => c.canonicalName === result.canonicalName)
      await upsertAlias({
        normalizedRaw: normalized,
        canonicalId: canonical?.id ?? null,
        size: null,
        variant: detectVariant(normalized, cat),
        matchMethod: result.method,
        confidence: result.confidence.toFixed(3),
        reviewed: result.confidence < 1,
        posCategoryName: cat,
        isModifier: false,
      })
      result.confidence >= 1 ? matched++ : inReview++
    } else {
      await upsertAlias({
        normalizedRaw: normalized,
        canonicalId: null,
        size: null,
        variant: detectVariant(normalized, cat),
        matchMethod: "unmatched",
        confidence: null,
        reviewed: false,
        posCategoryName: cat,
        isModifier: false,
      })
      inReview++
    }
  }

  safeRevalidate("/dashboard/costing")
  safeRevalidate("/dashboard")

  return {
    success: true,
    total,
    matched,
    modifier,
    deal,
    inReview,
    unmatched: inReview,
  }
}

// ─── 3. Review queue ─────────────────────────────────────────────────────────

export async function getReviewQueue() {
  return db
    .select({
      id: itemAlias.id,
      normalizedRaw: itemAlias.normalizedRaw,
      canonicalId: itemAlias.canonicalId,
      matchMethod: itemAlias.matchMethod,
      confidence: itemAlias.confidence,
      posCategoryName: itemAlias.posCategoryName,
      size: itemAlias.size,
      variant: itemAlias.variant,
    })
    .from(itemAlias)
    .where(
      sql`(${itemAlias.reviewed} = FALSE AND ${itemAlias.isModifier} = FALSE)`
    )
    .orderBy(
      sql`CASE WHEN ${itemAlias.matchMethod} = 'unmatched' THEN 0 ELSE 1 END`,
      itemAlias.normalizedRaw
    )
}

export async function getAllCanonicals() {
  return db
    .select({ id: dimCostingItem.id, canonicalName: dimCostingItem.canonicalName, category: dimCostingItem.category })
    .from(dimCostingItem)
    .orderBy(dimCostingItem.canonicalName)
}

export async function getCostingItemsWithAliasCounts() {
  return db
    .select({
      id: dimCostingItem.id,
      canonicalName: dimCostingItem.canonicalName,
      category: dimCostingItem.category,
      itemType: dimCostingItem.itemType,
      primaryCost: dimCostingItem.primaryCost,
      cost8inch: dimCostingItem.cost8inch,
      cost12inch: dimCostingItem.cost12inch,
      cost16inch: dimCostingItem.cost16inch,
      costSolo: dimCostingItem.costSolo,
      costMeal: dimCostingItem.costMeal,
      aliasCount: sql<number>`COUNT(${itemAlias.id})`,
      matchedAliasCount: sql<number>`COUNT(CASE WHEN ${itemAlias.reviewed} = TRUE THEN 1 END)`,
    })
    .from(dimCostingItem)
    .leftJoin(itemAlias, eq(itemAlias.canonicalId, dimCostingItem.id))
    .groupBy(
      dimCostingItem.id,
      dimCostingItem.canonicalName,
      dimCostingItem.category,
      dimCostingItem.itemType,
      dimCostingItem.primaryCost,
      dimCostingItem.cost8inch,
      dimCostingItem.cost12inch,
      dimCostingItem.cost16inch,
      dimCostingItem.costSolo,
      dimCostingItem.costMeal,
    )
    .orderBy(dimCostingItem.category, dimCostingItem.canonicalName)
}

// ─── 4. Confirm an alias ─────────────────────────────────────────────────────

export async function confirmAlias(aliasId: number, canonicalId: number | null) {
  await db
    .update(itemAlias)
    .set({
      canonicalId,
      matchMethod: "manual",
      confidence: "1.000",
      reviewed: true,
      // A human confirming a real cost mapping means this is NOT a modifier — clear
      // the flag so the resolved cost flows through and it leaves the uncosted list.
      isModifier: false,
      updatedAt: new Date(),
    })
    .where(eq(itemAlias.id, aliasId))
  safeRevalidate("/dashboard/costing")
  safeRevalidate("/dashboard/review")
}

// ─── 5. Uncosted items — POS lines with revenue but no resolved cost ──────────
// Surfaces every sold item that currently resolves to £0 cost, regardless of how
// its alias was classified (unmatched / modifier / reviewed-but-uncosted). This is
// what the "Uncosted" tab on the review screen maps. Ordered by revenue so the
// highest-impact gaps come first.
export async function getUncostedItems() {
  const rows = await db.execute<{
    aliasId: number
    normalizedRaw: string
    canonicalId: number | null
    revenue: string
    qty: string
    posCategoryName: string | null
    isModifier: boolean
    reviewed: boolean
    matchMethod: string | null
  }>(sql`
    WITH oi AS (
      SELECT regexp_replace(regexp_replace(regexp_replace(lower(btrim("itemName")), '\\s+', ' ', 'g'), '\\msundays?\\M', 'sundae', 'g'), '\\mperi peri\\M', 'piri piri', 'g') AS k,
             SUM(amount::numeric) AS revenue,
             SUM(qty::numeric)    AS qty,
             (array_agg("categoryName" ORDER BY amount::numeric DESC))[1] AS pos_cat
      FROM order_items
      WHERE cancelled = false AND amount::numeric > 0
      GROUP BY 1
    )
    SELECT ia.id AS "aliasId", ia."normalizedRaw", ia."canonicalId",
           ROUND(oi.revenue, 2) AS revenue, oi.qty::int AS qty, oi.pos_cat AS "posCategoryName",
           ia."isModifier", ia.reviewed, ia."matchMethod"
    FROM oi
    JOIN item_alias ia ON lower(ia."normalizedRaw") = oi.k
    LEFT JOIN dim_costing_item dci ON dci.id = ia."canonicalId"
    WHERE COALESCE(
      CASE WHEN ia.size = '8' THEN dci.cost8inch WHEN ia.size = '12' THEN dci.cost12inch WHEN ia.size = '16' THEN dci.cost16inch
           WHEN ia.variant = 'solo' THEN dci."costSolo" WHEN ia.variant = 'meal' THEN dci."costMeal" ELSE dci."primaryCost" END,
      dci."primaryCost") IS NULL
      -- Drop items a human has already resolved here (mapped or deliberately skipped):
      -- confirmAlias stamps matchMethod='manual', so they shouldn't keep reappearing.
      AND NOT (ia.reviewed = TRUE AND ia."matchMethod" = 'manual')
    ORDER BY oi.revenue DESC
  `)
  return rows.rows.map((r) => ({
    id: Number(r.aliasId),
    normalizedRaw: r.normalizedRaw,
    canonicalId: r.canonicalId != null ? Number(r.canonicalId) : null,
    revenue: Number(r.revenue),
    qty: Number(r.qty),
    posCategoryName: r.posCategoryName,
    isModifier: r.isModifier,
    reviewed: r.reviewed,
    matchMethod: r.matchMethod,
  }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AliasInsert = {
  normalizedRaw: string
  canonicalId: number | null
  size: string | null
  variant: string | "solo" | "meal" | null
  matchMethod: string
  confidence: string | null
  reviewed: boolean
  posCategoryName: string | null
  isModifier: boolean
}

async function upsertAlias(a: AliasInsert) {
  await db
    .insert(itemAlias)
    .values({ ...a, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: itemAlias.normalizedRaw,
      // Never overwrite a manually reviewed row
      set: {
        canonicalId: sql`CASE WHEN item_alias.reviewed THEN item_alias."canonicalId" ELSE EXCLUDED."canonicalId" END`,
        matchMethod: sql`CASE WHEN item_alias.reviewed THEN item_alias."matchMethod" ELSE EXCLUDED."matchMethod" END`,
        confidence:  sql`CASE WHEN item_alias.reviewed THEN item_alias.confidence    ELSE EXCLUDED.confidence    END`,
        size:        sql`CASE WHEN item_alias.reviewed THEN item_alias.size          ELSE EXCLUDED.size          END`,
        variant:     sql`CASE WHEN item_alias.reviewed THEN item_alias.variant       ELSE EXCLUDED.variant       END`,
        posCategoryName: sql`EXCLUDED."posCategoryName"`,
        isModifier:      sql`EXCLUDED."isModifier"`,
        updatedAt:       sql`NOW()`,
      },
    })
}

function extractPizzaSize(raw: string): string | null {
  const m = raw.match(/^(\d+)\s*inch/i)
  return m ? m[1] : null
}
