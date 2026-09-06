"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getSettingsLookup } from "@/lib/settings/actions"
import type { OfferStatus } from "@/lib/analytics/offer-status"

/**
 * Offers & Promotions (spec §10 — the merge of Offers & Discounts + Offer Performance).
 *
 * "Determine whether offers generate profitable additional business or simply give
 *  margin away."
 *
 * Two honest limits on this data, surfaced as caveats rather than hidden:
 *
 *  1. The POS records a discount but never who funded it. Until an offer setup record
 *     exists with Raja's/Platform funding %, every discount is treated as fully
 *     Raja's-funded — the pessimistic assumption, so contribution is never overstated.
 *  2. §10 is explicit that incremental figures are ESTIMATES against a comparable
 *     baseline unless a true control exists. They are labelled as such throughout.
 */

export type OfferRow = {
  offerKey: string
  name: string
  channel: string
  orders: number
  revenue: number
  discount: number
  rajasDiscount: number
  foodCost: number
  contribution: number
  contributionPerOrder: number
  discountExposurePct: number
  estIncremental: number | null
  status: OfferStatus
  hasSetupRecord: boolean
}

export type OfferAnalyticsResult = {
  rows: OfferRow[]
  totals: {
    offerRevenue: number
    offerOrders: number
    rajasDiscount: number
    contribution: number
    estIncremental: number | null
  }
  /** Discount as a share of each channel's revenue (§10 "Discount Exposure"). */
  exposure: Array<{ channel: string; discountPct: number; discount: number; revenue: number }>
  caveats: string[]
  offersConfigured: number
}

/** Rules from §5 Offers settings decide Scale / Keep / Modify / Stop. */
function decideStatus(
  o: { orders: number; contributionPerOrder: number; discountExposurePct: number; estIncremental: number | null },
  t: { minSample: number; minContribution: number; maxDiscountPct: number },
): OfferStatus {
  if (o.orders < t.minSample) return "INSUFFICIENT_DATA"
  const profitable = o.contributionPerOrder >= t.minContribution
  const affordable = o.discountExposurePct <= t.maxDiscountPct * 100
  const incrementalPositive = o.estIncremental === null ? null : o.estIncremental > 0

  if (profitable && affordable && incrementalPositive !== false) return "SCALE"
  if (profitable && !affordable) return "MODIFY"
  if (profitable) return "KEEP"
  return "STOP"
}

export async function getOfferAnalytics(
  startDate: string,
  endDate: string,
  location?: string,
): Promise<OfferAnalyticsResult> {
  const setting = await getSettingsLookup()
  const store = location && location !== "all" ? location : null
  const caveats: string[] = []

  const t = {
    minSample: setting("offer_min_sample"),
    minContribution: setting("offer_min_contribution"),
    maxDiscountPct: setting("offer_max_discount_pct"),
  }

  // Owner-entered setup records (§10). Their funding split is what makes contribution real.
  const offers = await db.execute<{
    offerId: string; name: string; channel: string | null; posCategories: string | null
    rajasFundingPct: string | null
  }>(sql`SELECT "offerId", name, channel, "posCategories", "rajasFundingPct" FROM offer`)
  const setupByCategory = new Map<string, { offerId: string; name: string; funding: number }>()
  for (const o of offers.rows) {
    for (const cat of (o.posCategories ?? "").split(",").map((c) => c.trim()).filter(Boolean)) {
      setupByCategory.set(cat.toLowerCase(), {
        offerId: o.offerId, name: o.name,
        funding: Number(o.rajasFundingPct ?? 100) / 100,
      })
    }
  }
  if (offers.rows.length === 0) {
    caveats.push("No offer setup records exist yet, so every discount is attributed to Raja's in full and offers are grouped by their POS category rather than an Offer ID (§10).")
  }

  const locSql = store ? sql` AND oi.location = ${store}` : sql``

  // Offer-bearing lines, grouped by POS category — the only offer identity the data
  // carries until setup records exist.
  const rows = await db.execute<{
    cat: string; channel: string; orders: string; revenue: string; discount: string; foodcost: string
  }>(sql`
    SELECT COALESCE(oi."categoryName", 'Unknown')          AS cat,
           lower(COALESCE(oi."orderChannel", 'unknown'))   AS channel,
           COUNT(DISTINCT oi."orderId")::text              AS orders,
           SUM(oi.amount::numeric)::text                   AS revenue,
           SUM(oi.discount::numeric)::text                 AS discount,
           SUM(oi.qty::numeric * COALESCE(pm."currentCost", 0))::text AS foodcost
      FROM order_items oi
      LEFT JOIN item_alias ia
        ON lower(ia."normalizedRaw") = regexp_replace(regexp_replace(regexp_replace(
             lower(btrim(oi."itemName")), '[[:space:]]+', ' ', 'g'),
             '\\msundays?\\M', 'sundae', 'g'), '\\mperi peri\\M', 'piri piri', 'g')
      LEFT JOIN product_master pm ON pm.id = ia."productMasterId"
     WHERE oi.cancelled = false
       AND oi.date::date >= ${startDate}::date
       AND oi.date::date <= ${endDate}::date
       AND (
         upper(oi."categoryName") LIKE '%OFFER%'
         OR upper(oi."categoryName") LIKE '%BUY%'
         OR upper(oi."categoryName") LIKE '%FREE%'
         OR oi.discount::numeric > 0
       )
       ${locSql}
     GROUP BY 1, 2`)

  const out: OfferRow[] = rows.rows.map((r) => {
    const revenue = Number(r.revenue ?? 0)
    const discount = Number(r.discount ?? 0)
    const foodCost = Number(r.foodcost ?? 0)
    const orders = Number(r.orders ?? 0)
    const setup = setupByCategory.get((r.cat ?? "").toLowerCase())
    // Without a setup record assume Raja's funds 100% — never understate the cost.
    const funding = setup?.funding ?? 1
    const rajasDiscount = discount * funding
    const contribution = revenue - rajasDiscount - foodCost
    const exposure = revenue > 0 ? (discount / revenue) * 100 : 0
    const base = {
      orders,
      contributionPerOrder: orders > 0 ? contribution / orders : 0,
      discountExposurePct: exposure,
      // A true incremental figure needs a baseline comparison per offer, which needs
      // offer dates from a setup record. Null until then — never a guessed number.
      estIncremental: null as number | null,
    }
    return {
      offerKey: `${r.cat}::${r.channel}`,
      name: setup?.name ?? r.cat,
      channel: r.channel,
      orders,
      revenue,
      discount,
      rajasDiscount,
      foodCost,
      contribution,
      contributionPerOrder: base.contributionPerOrder,
      discountExposurePct: exposure,
      estIncremental: null,
      status: decideStatus(base, t),
      hasSetupRecord: Boolean(setup),
    }
  })
  out.sort((a, b) => b.revenue - a.revenue)

  caveats.push("Incremental contribution is not yet computed — §10 requires a comparable baseline per offer, which needs each offer's start/end dates from a setup record. Shown as N/A rather than estimated.")

  // Discount exposure as a share of each channel's total revenue.
  const exposureRows = await db.execute<{ channel: string; discount: string; revenue: string }>(sql`
    SELECT lower(COALESCE(o."orderChannel", 'unknown')) AS channel,
           SUM(o."discountValue"::numeric)::text        AS discount,
           SUM(o."totalAmount"::numeric)::text          AS revenue
      FROM orders o
     WHERE o.cancelled = false
       AND o.date::date >= ${startDate}::date
       AND o.date::date <= ${endDate}::date
       ${store ? sql` AND o.location = ${store}` : sql``}
     GROUP BY 1`)

  const exposure = exposureRows.rows.map((e) => {
    const revenue = Number(e.revenue ?? 0)
    const discount = Number(e.discount ?? 0)
    return { channel: e.channel, discount, revenue, discountPct: revenue > 0 ? (discount / revenue) * 100 : 0 }
  }).sort((a, b) => b.discountPct - a.discountPct)

  return {
    rows: out,
    totals: {
      offerRevenue: out.reduce((s, r) => s + r.revenue, 0),
      offerOrders: out.reduce((s, r) => s + r.orders, 0),
      rajasDiscount: out.reduce((s, r) => s + r.rajasDiscount, 0),
      contribution: out.reduce((s, r) => s + r.contribution, 0),
      estIncremental: null,
    },
    exposure,
    caveats,
    offersConfigured: offers.rows.length,
  }
}
