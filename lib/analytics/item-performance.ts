"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getSettingsLookup } from "@/lib/settings/actions"
import {
  classify, percentileCutoff, theoreticalGpGap, priorityScore,
  type PerformanceStatus,
} from "@/lib/analytics/classification"

export type ItemPerformanceRow = {
  productMasterId: number | null
  productName: string
  brand: string
  category: string | null
  productType: string
  ordersWith: number
  units: number
  revenue: number
  cost: number
  grossProfit: number
  foodCostPct: number | null
  penetrationPct: number
  status: PerformanceStatus
  /** Only meaningful for FIX — extra GP at target economics, same volume. */
  theoreticalGpGap: number
  priority: number
}

export type ItemPerformanceResult = {
  rows: ItemPerformanceRow[]
  counts: Record<PerformanceStatus, number>
  eligibleOrders: number
  thresholds: {
    popularityPercentile: number
    popularityCutoff: number
    minQualifyingOrders: number
    targetFoodCostPct: number
    amberTolerancePct: number
  }
}

/**
 * Item Performance with §8 classification.
 *
 * Eligible core products (§8): Solo, Meal and genuine Deal/Bundle products only.
 * Modifiers, add-ons, meal upgrades, unmapped items and anything without a reliable
 * cost are excluded from the classified set — the spec is explicit that they must not
 * be able to surface as recommendations.
 *
 * Popularity is Order Penetration % (orders containing the product ÷ eligible orders),
 * judged against the configured percentile of the comparable set. Profitability is
 * judged against the commercial target from Settings, never the menu median.
 */
export async function getItemPerformance(
  startDate: string,
  endDate: string,
  location?: string,
  brand?: string,
): Promise<ItemPerformanceResult> {
  const setting = await getSettingsLookup()
  const store = location && location !== "all" ? location : null

  const popularityPercentile = setting("popularity_percentile")
  const minQualifyingOrders = setting("min_qualifying_orders")
  // Store-scoped where a store is selected; otherwise the catalog default applies.
  const targetFoodCostPct = setting("target_food_cost_pct", store ?? "Hyde Park")
  const amberTolerancePct = setting("amber_tolerance_pct", store ?? "Hyde Park")

  const locSql = store ? sql` AND oi.location = ${store}` : sql``
  const brandSql = brand && brand !== "all" ? sql` AND pm.brand = ${brand}` : sql``

  // Total eligible orders in the window — the denominator for penetration.
  const eligible = await db.execute<{ n: string }>(sql`
    SELECT COUNT(DISTINCT o."orderId")::text AS n
      FROM orders o
     WHERE o.cancelled = false
       AND o.date::date >= ${startDate}::date
       AND o.date::date <= ${endDate}::date
       ${store ? sql` AND o.location = ${store}` : sql``}`)
  const eligibleOrders = Number(eligible.rows?.[0]?.n ?? 0)

  // Per-product measures, resolved through the Product Master so Solo and Meal are
  // counted as the distinct products the spec requires.
  const rows = await db.execute<{
    productMasterId: number | null
    productName: string
    brand: string
    category: string | null
    productType: string
    ordersWith: string
    units: string
    revenue: string
    cost: string
  }>(sql`
    SELECT pm.id                                   AS "productMasterId",
           pm."displayName"                        AS "productName",
           pm.brand                                AS brand,
           pm.category                             AS category,
           pm."productType"                        AS "productType",
           COUNT(DISTINCT oi."orderId")::text      AS "ordersWith",
           SUM(oi.qty::numeric)::text              AS units,
           SUM(oi.amount::numeric)::text           AS revenue,
           SUM(oi.qty::numeric * COALESCE(pm."currentCost", 0))::text AS cost
      FROM order_items oi
      JOIN item_alias ia
        ON lower(ia."normalizedRaw") = regexp_replace(regexp_replace(regexp_replace(
             lower(btrim(oi."itemName")), '[[:space:]]+', ' ', 'g'),
             '\\msundays?\\M', 'sundae', 'g'), '\\mperi peri\\M', 'piri piri', 'g')
      JOIN product_master pm ON pm.id = ia."productMasterId"
     WHERE oi.cancelled = false
       AND oi.amount::numeric > 0
       AND oi.date::date >= ${startDate}::date
       AND oi.date::date <= ${endDate}::date
       -- §8 eligible core products only
       AND pm."productType" IN ('solo', 'meal', 'deal')
       ${locSql}${brandSql}
     GROUP BY pm.id, pm."displayName", pm.brand, pm.category, pm."productType"`)

  const measured = rows.rows.map((r) => {
    const revenue = Number(r.revenue ?? 0)
    const cost = Number(r.cost ?? 0)
    const ordersWith = Number(r.ordersWith ?? 0)
    return {
      productMasterId: r.productMasterId,
      productName: r.productName,
      brand: r.brand,
      category: r.category,
      productType: r.productType,
      ordersWith,
      units: Number(r.units ?? 0),
      revenue,
      cost,
      grossProfit: revenue - cost,
      // §4: no cost ⇒ no food-cost percentage, which forces INSUFFICIENT DATA.
      foodCostPct: cost > 0 && revenue > 0 ? cost / revenue : null,
      penetrationPct: eligibleOrders > 0 ? (ordersWith / eligibleOrders) * 100 : 0,
    }
  })

  // The percentile is taken across products with enough evidence to count, so a long
  // tail of one-off items cannot drag the popularity bar down.
  const qualifying = measured.filter((m) => m.ordersWith >= minQualifyingOrders)
  const popularityCutoff = percentileCutoff(
    qualifying.map((m) => m.penetrationPct),
    popularityPercentile,
  )

  const thresholds = {
    popularityCutoff,
    minQualifyingOrders,
    targetFoodCostPct,
    amberTolerancePct,
  }

  const out: ItemPerformanceRow[] = measured.map((m) => {
    const status = classify(m, thresholds)
    const gap = status === "FIX" ? theoreticalGpGap(m.revenue, m.cost, targetFoodCostPct) : 0
    return {
      ...m,
      status,
      theoreticalGpGap: gap,
      priority: priorityScore(status, gap, m.revenue),
    }
  })
  out.sort((a, b) => b.priority - a.priority)

  const counts: Record<PerformanceStatus, number> = {
    STAR: 0, FIX: 0, PROMOTE: 0, REVIEW: 0, INSUFFICIENT_DATA: 0,
  }
  for (const r of out) counts[r.status]++

  return {
    rows: out,
    counts,
    eligibleOrders,
    thresholds: { ...thresholds, popularityPercentile },
  }
}
