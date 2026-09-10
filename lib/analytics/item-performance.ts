"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getSettingsLookup } from "@/lib/settings/actions"
import { getRevenueBasis } from "@/lib/analytics/revenue-basis"
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
  /** The revenue-weighted target actually applied to THIS product. */
  targetFoodCostPct: number
  amberTolerancePct: number
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
    /** Revenue-weighted blend of the per-line targets actually applied. */
    targetFoodCostPct: number
    amberTolerancePct: number
  }
  /** Which VAT basis produced these figures, for the on-page label. */
  revenueBasis: { basis: "gross" | "net"; label: string }
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
  productType?: string,
  category?: string,
): Promise<ItemPerformanceResult> {
  const setting = await getSettingsLookup()
  const rb = await getRevenueBasis()
  const store = location && location !== "all" ? location : null

  const popularityPercentile = setting("popularity_percentile")
  const minQualifyingOrders = setting("min_qualifying_orders")

  // Corrections Priority 2 (items 7-11): the food-cost target depends on WHERE the
  // sale happened — in-store/direct uses the store's in-store target, the delivery
  // platforms use its platform target. Item 9 forbids comparing everything to 33%
  // when the filter is "All", so the target is resolved per ORDER LINE and then
  // revenue-weighted per product. A product selling half in-store and half on Uber
  // is judged against a blend, not against whichever target happened to be picked.
  const targets = {
    hpInstore: setting("target_food_cost_pct", "Hyde Park"),
    hpPlatform: setting("platform_target_food_cost_pct", "Hyde Park"),
    gaInstore: setting("target_food_cost_pct", "Grand Arcade"),
    gaPlatform: setting("platform_target_food_cost_pct", "Grand Arcade"),
    hpAmber: setting("amber_tolerance_pct", "Hyde Park"),
    gaAmber: setting("amber_tolerance_pct", "Grand Arcade"),
  }
  const PLATFORM_CHANNELS = sql`('ubereats', 'deliveroo', 'justeat')`
  // Every bound value is cast explicitly: an untyped parameter has no `numeric * $n`
  // operator, which fails with 42883.
  const lineTargetSql = sql`CASE
    WHEN lower(COALESCE(oi."orderChannel", '')) IN ${PLATFORM_CHANNELS}
      THEN CASE WHEN oi.location = 'Hyde Park' THEN ${targets.hpPlatform}::numeric ELSE ${targets.gaPlatform}::numeric END
      ELSE CASE WHEN oi.location = 'Hyde Park' THEN ${targets.hpInstore}::numeric ELSE ${targets.gaInstore}::numeric END
  END`
  const lineAmberSql = sql`CASE WHEN oi.location = 'Hyde Park' THEN ${targets.hpAmber}::numeric ELSE ${targets.gaAmber}::numeric END`

  // VAT basis — one shared helper, never per-page logic (Priority 1, item 2).
  const revenueSql = rb.basis === "gross"
    ? sql`oi.amount::numeric`
    : sql`GREATEST(oi.amount::numeric - COALESCE(oi."vatAmount"::numeric, 0), 0)`

  const locSql = store ? sql` AND oi.location = ${store}` : sql``
  const brandSql = brand && brand !== "all" ? sql` AND pm.brand = ${brand}` : sql``
  // Category narrows within the §8 eligible set; product type replaces the default
  // solo/meal/deal restriction when the user picks one explicitly.
  const categorySql = category && category !== "all" ? sql` AND pm.category = ${category}` : sql``
  const typeSql = productType && productType !== "all"
    ? sql` AND pm."productType" = ${productType}`
    : sql` AND pm."productType" IN ('solo', 'meal', 'deal')`

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
    weightedTarget: string | null
    weightedAmber: string | null
  }>(sql`
    SELECT pm.id                                   AS "productMasterId",
           pm."displayName"                        AS "productName",
           pm.brand                                AS brand,
           pm.category                             AS category,
           pm."productType"                        AS "productType",
           COUNT(DISTINCT oi."orderId")::text      AS "ordersWith",
           SUM(oi.qty::numeric)::text              AS units,
           SUM(${revenueSql})::text                AS revenue,
           SUM(oi.qty::numeric * COALESCE(pm."currentCost", 0))::text AS cost,
           (SUM(${revenueSql} * ${lineTargetSql}) / NULLIF(SUM(${revenueSql}), 0))::text AS "weightedTarget",
           (SUM(${revenueSql} * ${lineAmberSql})  / NULLIF(SUM(${revenueSql}), 0))::text AS "weightedAmber"
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
       ${typeSql}
       ${locSql}${brandSql}${categorySql}
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
      // This product's own revenue-weighted target and tolerance (items 7-11).
      targetFoodCostPct: Number(r.weightedTarget ?? targets.hpInstore),
      amberTolerancePct: Number(r.weightedAmber ?? targets.hpAmber),
    }
  })

  // The percentile is taken across products with enough evidence to count, so a long
  // tail of one-off items cannot drag the popularity bar down.
  const qualifying = measured.filter((m) => m.ordersWith >= minQualifyingOrders)
  const popularityCutoff = percentileCutoff(
    qualifying.map((m) => m.penetrationPct),
    popularityPercentile,
  )

  // Headline threshold shown in the UI: the revenue-weighted average of the targets
  // actually applied, so the stated figure moves with the filters (item 10) instead of
  // always reading 33%.
  const totalRevenue = measured.reduce((a, m) => a + m.revenue, 0)
  const blendedTarget = totalRevenue > 0
    ? measured.reduce((a, m) => a + m.targetFoodCostPct * m.revenue, 0) / totalRevenue
    : targets.hpInstore
  const blendedAmber = totalRevenue > 0
    ? measured.reduce((a, m) => a + m.amberTolerancePct * m.revenue, 0) / totalRevenue
    : targets.hpAmber

  const thresholds = {
    popularityCutoff,
    minQualifyingOrders,
    targetFoodCostPct: blendedTarget,
    amberTolerancePct: blendedAmber,
  }

  const out: ItemPerformanceRow[] = measured.map((m) => {
    // Each product is judged against ITS OWN target, not the blended headline.
    const status = classify(m, {
      popularityCutoff,
      minQualifyingOrders,
      targetFoodCostPct: m.targetFoodCostPct,
      amberTolerancePct: m.amberTolerancePct,
    })
    const gap = status === "FIX" ? theoreticalGpGap(m.revenue, m.cost, m.targetFoodCostPct) : 0
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
    revenueBasis: { basis: rb.basis, label: rb.label },
  }
}
