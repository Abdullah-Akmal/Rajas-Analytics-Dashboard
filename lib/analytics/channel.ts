"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { getSettingsLookup } from "@/lib/settings/actions"
import { comparablePeriod, pctChange } from "@/lib/analytics/periods"
import { getDriverCost } from "@/lib/analytics/driver-cost"

/**
 * Channel Performance (spec §9) — "which channels are growing and which actually
 * leave Raja's the most money".
 *
 * Contribution, per the spec:
 *
 *   Product Contribution = Actual Revenue − Raja's-funded Discount − Food/Packaging Cost
 *   Channel Contribution = Product Contribution − Platform Commission − Net Direct Delivery Cost
 *
 * Commission comes from the owner-editable Store × Channel settings, never a
 * hard-coded rate.
 */

/** POS orderChannel values grouped the way the business thinks about them. */
const CHANNEL_MAP: Record<string, { label: string; direct: boolean; settingKey?: string }> = {
  wix:       { label: "In-store",   direct: true },
  eatpresto: { label: "Wix / Direct", direct: true },
  ubereats:  { label: "Uber Eats",  direct: false, settingKey: "ubereats" },
  deliveroo: { label: "Deliveroo",  direct: false, settingKey: "deliveroo" },
  justeat:   { label: "Just Eat",   direct: false, settingKey: "justeat" },
}

export type ChannelRow = {
  channel: string
  label: string
  isDirect: boolean
  revenue: number
  orders: number
  aov: number
  mixPct: number
  changePct: number | null
  foodCost: number
  discount: number
  commissionPct: number
  commission: number
  deliveryCost: number
  productContribution: number
  channelContribution: number
  contributionMarginPct: number
}

export type ChannelPerformanceResult = {
  rows: ChannelRow[]
  totals: {
    revenue: number
    orders: number
    aov: number
    directPct: number
    thirdPartyPct: number
    channelContribution: number
    revenueChangePct: number | null
    ordersChangePct: number | null
    aovChangePct: number | null
    directPctChangePts: number | null
  }
  comparable: { from: string; to: string; days: number; isPartial: boolean }
  /** Set when a figure is a documented approximation rather than a measured value. */
  caveats: string[]
}

export async function getChannelPerformance(
  startDate: string,
  endDate: string,
  location?: string,
): Promise<ChannelPerformanceResult> {
  const setting = await getSettingsLookup()
  const cp = comparablePeriod(startDate, endDate)
  const store = location && location !== "all" ? location : null
  const caveats: string[] = []

  const measure = async (from: string, to: string) => {
    const locSql = store ? sql` AND o.location = ${store}` : sql``
    // Revenue, orders and Raja's discount per channel, plus the food cost of the
    // lines inside those orders — the two halves of Product Contribution.
    const r = await db.execute<{
      channel: string; revenue: string; orders: string; discount: string; foodcost: string
    }>(sql`
      WITH ord AS (
        SELECT lower(COALESCE(o."orderChannel", 'unknown')) AS channel,
               o."orderId",
               o."totalAmount"::numeric   AS revenue,
               o."discountValue"::numeric AS discount
          FROM orders o
         WHERE o.cancelled = false
           AND o.date::date >= ${from}::date
           AND o.date::date <= ${to}::date
           ${locSql}
      ),
      cost AS (
        SELECT lower(COALESCE(oi."orderChannel", 'unknown')) AS channel,
               SUM(oi.qty::numeric * COALESCE(pm."currentCost", 0)) AS foodcost
          FROM order_items oi
          LEFT JOIN item_alias ia
            ON lower(ia."normalizedRaw") = regexp_replace(regexp_replace(regexp_replace(
                 lower(btrim(oi."itemName")), '[[:space:]]+', ' ', 'g'),
                 '\\msundays?\\M', 'sundae', 'g'), '\\mperi peri\\M', 'piri piri', 'g')
          LEFT JOIN product_master pm ON pm.id = ia."productMasterId"
         WHERE oi.cancelled = false
           AND oi.amount::numeric > 0
           AND oi.date::date >= ${from}::date
           AND oi.date::date <= ${to}::date
           ${store ? sql` AND oi.location = ${store}` : sql``}
         GROUP BY 1
      )
      SELECT ord.channel                                   AS channel,
             COALESCE(SUM(ord.revenue), 0)::text           AS revenue,
             COUNT(DISTINCT ord."orderId")::text           AS orders,
             COALESCE(SUM(ord.discount), 0)::text          AS discount,
             COALESCE(MAX(cost.foodcost), 0)::text         AS foodcost
        FROM ord LEFT JOIN cost ON cost.channel = ord.channel
       GROUP BY ord.channel`)
    return r.rows
  }

  const [cur, prev] = await Promise.all([
    measure(startDate, endDate),
    measure(cp.prevStart, cp.prevEnd),
  ])

  const prevByChannel = new Map(prev.map((p) => [p.channel, Number(p.revenue ?? 0)]))
  const totalRevenue = cur.reduce((s, r) => s + Number(r.revenue ?? 0), 0)
  // Driver cost is a direct-channel cost, apportioned across direct revenue.
  const directRevenueTotal = cur
    .filter((r) => CHANNEL_MAP[r.channel]?.direct)
    .reduce((s, r) => s + Number(r.revenue ?? 0), 0)

  // Direct-delivery driver cost applies to Hyde Park's own deliveries only (§9).
  // Computed for real from Shipday volume/distance + the manual shift log; it lands in
  // contribution the moment those inputs exist, and its own caveats explain any zero.
  const driver = await getDriverCost(startDate, endDate, "Hyde Park")
  caveats.push(...driver.caveats.map((c) => `Driver cost: ${c}`))
  caveats.push("Raja's-funded discount uses the full order discount; the funded/platform split needs offer records (§10).")

  const rows: ChannelRow[] = cur.map((r) => {
    const channel = r.channel
    const meta = CHANNEL_MAP[channel] ?? { label: channel, direct: false }
    const revenue = Number(r.revenue ?? 0)
    const orders = Number(r.orders ?? 0)
    const discount = Number(r.discount ?? 0)
    const foodCost = Number(r.foodcost ?? 0)

    // Commission is per Store × Channel from Settings; direct channels pay none.
    const commissionPct = meta.direct
      ? 0
      : setting("commission_pct", store ?? "Hyde Park", meta.settingKey ?? channel)
    const commission = revenue * commissionPct
    // §9: net direct delivery cost applies to Raja's own deliveries, i.e. the direct
    // channels — never to platform orders, whose couriers the platform pays for.
    const deliveryCost =
      meta.direct && directRevenueTotal > 0
        ? driver.netDeliveryCost * (revenue / directRevenueTotal)
        : 0

    const productContribution = revenue - discount - foodCost
    const channelContribution = productContribution - commission - deliveryCost

    return {
      channel,
      label: meta.label,
      isDirect: meta.direct,
      revenue,
      orders,
      aov: orders > 0 ? revenue / orders : 0,
      mixPct: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      changePct: pctChange(revenue, prevByChannel.get(channel) ?? 0),
      foodCost,
      discount,
      commissionPct,
      commission,
      deliveryCost,
      productContribution,
      channelContribution,
      contributionMarginPct: revenue > 0 ? (channelContribution / revenue) * 100 : 0,
    }
  })
  rows.sort((a, b) => b.revenue - a.revenue)

  const totalOrders = rows.reduce((s, r) => s + r.orders, 0)
  const directRevenue = rows.filter((r) => r.isDirect).reduce((s, r) => s + r.revenue, 0)
  const prevTotalRevenue = prev.reduce((s, r) => s + Number(r.revenue ?? 0), 0)
  const prevTotalOrders = prev.reduce((s, r) => s + Number(r.orders ?? 0), 0)
  const prevDirect = prev
    .filter((p) => CHANNEL_MAP[p.channel]?.direct)
    .reduce((s, p) => s + Number(p.revenue ?? 0), 0)

  const directPct = totalRevenue > 0 ? (directRevenue / totalRevenue) * 100 : 0
  const prevDirectPct = prevTotalRevenue > 0 ? (prevDirect / prevTotalRevenue) * 100 : 0
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0
  const prevAov = prevTotalOrders > 0 ? prevTotalRevenue / prevTotalOrders : 0

  return {
    rows,
    totals: {
      revenue: totalRevenue,
      orders: totalOrders,
      aov,
      directPct,
      thirdPartyPct: 100 - directPct,
      channelContribution: rows.reduce((s, r) => s + r.channelContribution, 0),
      revenueChangePct: pctChange(totalRevenue, prevTotalRevenue),
      ordersChangePct: pctChange(totalOrders, prevTotalOrders),
      aovChangePct: pctChange(aov, prevAov),
      // No trade in the prior window means no baseline — reporting "directPct − 0"
      // would show a spurious +56pt swing on the first period of available data.
      directPctChangePts: prevTotalRevenue > 0 ? directPct - prevDirectPct : null,
    },
    comparable: { from: cp.prevStart, to: cp.prevEnd, days: cp.days, isPartial: cp.isPartial },
    caveats,
  }
}
