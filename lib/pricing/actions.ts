"use server"

import { db } from "@/lib/db"
import { pricingItem, pricingSettings, syncLogs } from "@/lib/db/schema"
import { normalizeRaw } from "@/lib/normalise/index"
import { sql } from "drizzle-orm"

// Safe wrapper — revalidatePath throws outside a Next.js request context (CLI scripts).
function safeRevalidate(path: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("next/cache").revalidatePath(path)
  } catch {
    // no-op outside Next.js
  }
}

// Sheet tab name → the store string used by orders.location / order_items.location.
// Tabs that are not per-store price lists (Saver Menu, Comparison, Offers+bundles,
// Rajas Drop) are skipped by not appearing here.
const STORE_TABS: Record<string, string> = {
  "hyde park": "Hyde Park",
  "grand arcade": "Grand Arcade",
}

/**
 * Reads the Pricing Engine workbook into pricing_settings + pricing_item.
 *
 * Sheet shape (one tab per store):
 *   r2-r4   COMMERCIAL SETTINGS  - target FC %, platform commission %, meal uplift
 *   r6      "INSTORE PRICING ..." - section banner; everything below is instore
 *   r7      "Product | Sales Volume | Solo Cost | ..." header
 *   r8      "PIZZA"              - category header (col A only)
 *   r9...   product rows
 *   r214    "PLATFORM PRICING ..." - same product list, marked-up prices
 *   r422    "SUMMARY"            - stop
 *
 * Values are requested UNFORMATTED so percentages arrive as 0.33 rather than the
 * display string "33.0%", and prices as 8.5 rather than "GBP 8.50".
 */
export async function syncPricingSheet() {
  try {
    const { google } = await import("googleapis")
    const auth = new google.auth.GoogleAuth({
      credentials: {
        // Falls back to the costing sheet's service account — the usual setup is one
        // account with both sheets shared to it.
        client_email:
          process.env.GOOGLE_PRICING_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: (
          process.env.GOOGLE_PRICING_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY
        )?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    })

    const spreadsheetId = process.env.GOOGLE_PRICING_SHEET_ID
    if (!spreadsheetId) {
      return { success: false, error: "GOOGLE_PRICING_SHEET_ID is not set" }
    }

    const sheets = google.sheets({ version: "v4", auth })
    const meta = await sheets.spreadsheets.get({ spreadsheetId })
    const tabs = (meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) ?? []) as string[]

    // ── cell helpers ────────────────────────────────────────────────────────
    // UNFORMATTED_VALUE gives numbers for numeric cells, but a cell can still be a
    // string ("-", "N/A") or an emoji-tagged label ("High", "On Target").
    const num = (v: unknown): string | null => {
      if (v === null || v === undefined || v === "") return null
      if (typeof v === "number") return Number.isFinite(v) ? v.toString() : null
      const n = parseFloat(v.toString().replace(/[,%\s]/g, "").replace(/[^0-9.eE+-]/g, ""))
      return Number.isNaN(n) ? null : n.toString()
    }
    const txt = (v: unknown) =>
      v === null || v === undefined ? "" : v.toString().replace(/\s+/g, " ").trim()
    // Strip emoji and other symbols, keeping letters/digits/basic punctuation.
    const label = (v: unknown): string | null => {
      const s = txt(v)
        .replace(/[^\p{L}\p{N}\s.,'&()/-]/gu, "")
        .replace(/\s+/g, " ")
        .trim()
      return s === "" || s === "-" ? null : s
    }

    const itemRows: Array<Record<string, unknown>> = []
    const settingsRows: Array<Record<string, unknown>> = []
    const warnings: string[] = []

    for (const tab of tabs) {
      const store = STORE_TABS[tab.toLowerCase().trim()]
      if (!store) continue

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tab}!A1:Z1000`,
        valueRenderOption: "UNFORMATTED_VALUE",
      })
      const rows = (res.data.values ?? []) as unknown[][]

      // ── COMMERCIAL SETTINGS: find each label, take the next numeric cell right ──
      const settingAfter = (needle: string): string | null => {
        for (const row of rows.slice(0, 12)) {
          for (let c = 0; c < row.length; c++) {
            if (txt(row[c]).toLowerCase() === needle) {
              for (let k = c + 1; k < Math.min(c + 4, row.length); k++) {
                const n = num(row[k])
                if (n !== null) return n
              }
            }
          }
        }
        return null
      }
      settingsRows.push({
        store,
        instoreTargetFcPct: settingAfter("instore target fc %"),
        platformTargetFcPct: settingAfter("platform target fc %"),
        platformCommissionPct: settingAfter("platform commission %"),
        mealUplift: settingAfter("meal uplift"),
        amberTolerancePct: settingAfter("amber tolerance %"),
      })

      // ── product rows ────────────────────────────────────────────────────────
      let priceMode: "instore" | "platform" | null = null
      let category: string | null = null
      let cols: Record<string, number> = {}

      for (const row of rows) {
        const a = txt(row[0])
        if (!a) continue

        const upper = a.toUpperCase()
        if (upper.startsWith("SUMMARY")) break
        if (upper.startsWith("INSTORE PRICING")) {
          priceMode = "instore"
          category = null
          cols = {}
          continue
        }
        if (upper.startsWith("PLATFORM PRICING")) {
          priceMode = "platform"
          category = null
          cols = {}
          continue
        }
        if (upper.startsWith("COMMERCIAL SETTINGS")) continue

        // Header row — map each column by its whitespace-collapsed caption.
        if (a.toLowerCase() === "product") {
          cols = {}
          let priceChangeSeen = 0
          row.forEach((cell, i) => {
            const h = txt(cell).toLowerCase().replace(/[^a-z0-9% ]/g, "").trim()
            if (!h) return
            const put = (k: string) => {
              if (cols[k] === undefined) cols[k] = i
            }
            if (h === "product") put("name")
            else if (h === "sales volume") put("salesVolume")
            else if (h === "solo cost") put("soloCost")
            else if (h === "meal cost") put("mealCost")
            else if (h === "current solo price") put("currentSoloPrice")
            else if (h === "current meal price") put("currentMealPrice")
            else if (h === "solo fc %") put("soloFcPct")
            else if (h === "meal fc %") put("mealFcPct")
            else if (h === "target fc status") put("targetFcStatus")
            else if (h.startsWith("competitor")) put("competitorPrice")
            else if (h === "commercial recommendation") put("recommendation")
            else if (h === "reason") put("reason")
            else if (h === "recommended solo price") put("recommendedSoloPrice")
            else if (h === "recommended meal price") put("recommendedMealPrice")
            else if (h === "final solo price") put("finalSoloPrice")
            else if (h === "final meal price") put("finalMealPrice")
            else if (h === "new solo fc %") put("newSoloFcPct")
            else if (h === "new meal fc %") put("newMealFcPct")
            // "Price Change" appears twice (solo then meal); neither is stored, but
            // counting them keeps the intent visible if that ever changes.
            else if (h === "price change") priceChangeSeen++
          })
          continue
        }

        if (!priceMode) continue

        // Category header: col A only, rest of the row empty.
        if (row.slice(1).every((c) => txt(c) === "")) {
          category = a
          continue
        }

        // Data row: needs a name plus at least one cost/price signal.
        const val = (k: string) => (cols[k] === undefined ? null : row[cols[k]])
        const currentSolo = num(val("currentSoloPrice"))
        const currentMeal = num(val("currentMealPrice"))
        const soloCost = num(val("soloCost"))
        if (currentSolo === null && currentMeal === null && soloCost === null) continue

        itemRows.push({
          store,
          priceMode,
          category,
          productName: a,
          normalizedName: normalizeRaw(a),
          salesVolume: label(val("salesVolume")),
          soloCost,
          mealCost: num(val("mealCost")),
          currentSoloPrice: currentSolo,
          currentMealPrice: currentMeal,
          soloFcPct: num(val("soloFcPct")),
          mealFcPct: num(val("mealFcPct")),
          targetFcStatus: label(val("targetFcStatus")),
          competitorPrice: num(val("competitorPrice")),
          recommendation: label(val("recommendation")),
          reason: label(val("reason")),
          recommendedSoloPrice: num(val("recommendedSoloPrice")),
          recommendedMealPrice: num(val("recommendedMealPrice")),
          finalSoloPrice: num(val("finalSoloPrice")),
          finalMealPrice: num(val("finalMealPrice")),
          newSoloFcPct: num(val("newSoloFcPct")),
          newMealFcPct: num(val("newMealFcPct")),
        })
      }
    }

    if (itemRows.length === 0) {
      return { success: false, error: `Parsed 0 pricing rows. Tabs seen: ${tabs.join(", ")}` }
    }

    const now = new Date()

    for (const s of settingsRows) {
      await db
        .insert(pricingSettings)
        .values({ ...s, lastSyncedAt: now, updatedAt: now } as never)
        .onConflictDoUpdate({
          target: pricingSettings.store,
          set: {
            instoreTargetFcPct: sql`EXCLUDED."instoreTargetFcPct"`,
            platformTargetFcPct: sql`EXCLUDED."platformTargetFcPct"`,
            platformCommissionPct: sql`EXCLUDED."platformCommissionPct"`,
            mealUplift: sql`EXCLUDED."mealUplift"`,
            amberTolerancePct: sql`EXCLUDED."amberTolerancePct"`,
            lastSyncedAt: sql`EXCLUDED."lastSyncedAt"`,
            updatedAt: sql`EXCLUDED."updatedAt"`,
          },
        })
    }

    for (let i = 0; i < itemRows.length; i += 50) {
      const batch = itemRows.slice(i, i + 50).map((r) => ({ ...r, lastSyncedAt: now, updatedAt: now }))
      await db
        .insert(pricingItem)
        .values(batch as never)
        .onConflictDoUpdate({
          target: [pricingItem.store, pricingItem.priceMode, pricingItem.productName],
          set: {
            category: sql`EXCLUDED.category`,
            normalizedName: sql`EXCLUDED."normalizedName"`,
            salesVolume: sql`EXCLUDED."salesVolume"`,
            soloCost: sql`EXCLUDED."soloCost"`,
            mealCost: sql`EXCLUDED."mealCost"`,
            currentSoloPrice: sql`EXCLUDED."currentSoloPrice"`,
            currentMealPrice: sql`EXCLUDED."currentMealPrice"`,
            soloFcPct: sql`EXCLUDED."soloFcPct"`,
            mealFcPct: sql`EXCLUDED."mealFcPct"`,
            targetFcStatus: sql`EXCLUDED."targetFcStatus"`,
            competitorPrice: sql`EXCLUDED."competitorPrice"`,
            recommendation: sql`EXCLUDED.recommendation`,
            reason: sql`EXCLUDED.reason`,
            recommendedSoloPrice: sql`EXCLUDED."recommendedSoloPrice"`,
            recommendedMealPrice: sql`EXCLUDED."recommendedMealPrice"`,
            finalSoloPrice: sql`EXCLUDED."finalSoloPrice"`,
            finalMealPrice: sql`EXCLUDED."finalMealPrice"`,
            newSoloFcPct: sql`EXCLUDED."newSoloFcPct"`,
            newMealFcPct: sql`EXCLUDED."newMealFcPct"`,
            lastSyncedAt: sql`EXCLUDED."lastSyncedAt"`,
            updatedAt: sql`EXCLUDED."updatedAt"`,
          },
        })
    }

    // ── resolve canonicalId against the costing sheet ────────────────────────
    // normalizeRaw() deliberately preserves case (item_alias stores the original
    // spelling for display), so BOTH sides must be lowercased here — the same thing
    // costLookup() does with lower(item_alias."normalizedRaw").
    // Unmatched rows keep canonicalId = null and are counted below, never dropped.
    await db.execute(sql`
      UPDATE pricing_item pi
         SET "canonicalId" = dci.id
        FROM dim_costing_item dci
       WHERE lower(btrim(dci."canonicalName")) = lower(btrim(pi."normalizedName"))
         AND pi."canonicalId" IS DISTINCT FROM dci.id`)

    const counts = await db.execute<{ total: string; unmatched: string }>(sql`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE "canonicalId" IS NULL)::text AS unmatched
        FROM pricing_item`)
    const total = Number(counts.rows?.[0]?.total ?? 0)
    const unmatchedCount = Number(counts.rows?.[0]?.unmatched ?? 0)
    if (unmatchedCount > 0) {
      warnings.push(`${unmatchedCount}/${total} pricing rows have no costing match`)
    }

    await db.insert(syncLogs).values({
      source: "pricing_sheet",
      status: "success",
      recordsProcessed: itemRows.length,
      errorMessage: warnings.length ? warnings.join("; ") : null,
    })

    safeRevalidate("/dashboard")
    safeRevalidate("/dashboard/costing")
    safeRevalidate("/dashboard/sync")

    return {
      success: true,
      items: itemRows.length,
      stores: settingsRows.length,
      matched: total - unmatchedCount,
      unmatched: unmatchedCount,
      warnings,
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    await db.insert(syncLogs).values({ source: "pricing_sheet", status: "error", errorMessage: msg })
    return { success: false, error: msg }
  }
}

/** Per-store commercial settings (target FC %, commission %, meal uplift). */
export async function getPricingSettings() {
  return db.select().from(pricingSettings).orderBy(pricingSettings.store)
}

/** Current prices for a store — `priceMode` defaults to the instore list. */
export async function getPricingItems(store?: string, priceMode: "instore" | "platform" = "instore") {
  const storeCond = store && store !== "all" ? sql` AND store = ${store}` : sql``
  const res = await db.execute(sql`
    SELECT store, category, "productName", "salesVolume", "currentSoloPrice", "currentMealPrice",
           "soloFcPct", "mealFcPct", "targetFcStatus", recommendation, reason,
           "recommendedSoloPrice", "finalSoloPrice", "canonicalId"
      FROM pricing_item
     WHERE "priceMode" = ${priceMode}${storeCond}
     ORDER BY category NULLS LAST, "productName"`)
  return res.rows
}
