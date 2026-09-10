"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { rawOrderSlicers, rawOrderPmSlicers, type PmFilters } from "@/lib/db/slicers"
import { comparablePeriod, pctChange } from "@/lib/analytics/periods"
import { getSettingsLookup } from "@/lib/settings/actions"

/**
 * Hourly Demand / Order Pattern (Operations corrections §4).
 *
 * Deliberately NO staffing logic: the brief parks staffing recommendations, labour
 * cost, SPLH and rota comparison until a real labour model exists. This page only
 * describes demand — when orders arrive, on which days, through which fulfilment
 * mode — and flags patterns worth attention.
 *
 * Every measure is split by store (item 9): Hyde Park and Grand Arcade trade on
 * different hours, so combining them would hide the pattern a manager needs.
 */

export type DemandStore = "Hyde Park" | "Grand Arcade"
const STORES: DemandStore[] = ["Hyde Park", "Grand Arcade"]

export type DemandException = { tone: "good" | "warning" | "problem" | "neutral"; text: string }

export type DemandResult = {
  stores: DemandStore[]
  hourly: Array<{ hour: number } & Record<string, number>>
  byDay: Array<{ dow: number } & Record<string, number>>
  modes: Array<{ mode: string; store: string; orders: number; revenue: number }>
  totals: {
    orders: number
    revenue: number
    prevOrders: number
    ordersChangePct: number | null
    days: number
    byStore: Array<{ store: string; orders: number; prevOrders: number; changePct: number | null; peakHour: number | null }>
  }
  peakHour: number | null
  busiestDow: number | null
  isPartial: boolean
  exceptions: DemandException[]
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
function fmtHour(h: number) {
  if (h === 0) return "12am"
  if (h < 12) return `${h}am`
  if (h === 12) return "12pm"
  return `${h - 12}pm`
}

export async function getDemandPatterns(
  startDate: string,
  endDate: string,
  location?: string,
  channel?: string,
  mode?: string,
  platform?: string,
  pm?: PmFilters,
  dayOfWeek?: number | null,
): Promise<DemandResult> {
  const setting = await getSettingsLookup()
  const trendThreshold = setting("trend_threshold_pct") * 100
  const store = location && location !== "all" ? location : null
  const stores = (store ? [store] : STORES) as DemandStore[]

  // Shared WHERE for the current window. rawOrderPmSlicers keeps only orders that
  // contain a line of the selected brand / type / category (§4 item 1: Brand filter).
  const scope = (from: string, to: string) => sql`
        o.cancelled = false
    AND o.date::date >= ${from}::date
    AND o.date::date <= ${to}::date
    ${store ? sql` AND o.location = ${store}` : sql``}
    ${rawOrderSlicers("o", channel, mode, platform)}
    ${rawOrderPmSlicers("o", pm)}`

  // UK wall-clock hour / day (Europe/London, honours BST).
  const ukHour = sql`EXTRACT(HOUR FROM o."orderTime" AT TIME ZONE 'Europe/London')::int`
  const ukDow = sql`EXTRACT(DOW FROM o."orderTime" AT TIME ZONE 'Europe/London')::int`
  const dowSql = dayOfWeek != null ? sql` AND ${ukDow} = ${dayOfWeek}` : sql``

  const cp = comparablePeriod(startDate, endDate)
  // A still-trading final day is compared at the same elapsed point in both windows.
  const clamp = (finalDay: string) => cp.cutoffSeconds === null ? sql`` : sql`
    AND (o."orderTime" IS NULL
         OR (o."orderTime" AT TIME ZONE 'Europe/London')::date < ${finalDay}::date
         OR EXTRACT(EPOCH FROM (o."orderTime" AT TIME ZONE 'Europe/London')::time) <= ${cp.cutoffSeconds})`

  const [hourlyRes, dowRes, modeRes, curRes, prevRes] = await Promise.all([
    db.execute<{ store: string; hour: number; orders: string; revenue: string }>(sql`
      SELECT o.location AS store, ${ukHour} AS hour,
             COUNT(*)::text AS orders, COALESCE(SUM(o."totalAmount"::numeric), 0)::text AS revenue
        FROM orders o
       WHERE ${scope(startDate, endDate)} AND o."orderTime" IS NOT NULL ${dowSql}
       GROUP BY 1, 2`),
    db.execute<{ store: string; dow: number; orders: string; revenue: string }>(sql`
      SELECT o.location AS store, EXTRACT(DOW FROM o.date::date)::int AS dow,
             COUNT(*)::text AS orders, COALESCE(SUM(o."totalAmount"::numeric), 0)::text AS revenue
        FROM orders o
       WHERE ${scope(startDate, endDate)}
       GROUP BY 1, 2`),
    db.execute<{ store: string; mode: string; orders: string; revenue: string }>(sql`
      SELECT o.location AS store, COALESCE(NULLIF(btrim(o.mode), ''), 'unknown') AS mode,
             COUNT(*)::text AS orders, COALESCE(SUM(o."totalAmount"::numeric), 0)::text AS revenue
        FROM orders o
       WHERE ${scope(startDate, endDate)}
       GROUP BY 1, 2`),
    db.execute<{ store: string; orders: string; revenue: string; days: string }>(sql`
      SELECT o.location AS store, COUNT(*)::text AS orders,
             COALESCE(SUM(o."totalAmount"::numeric), 0)::text AS revenue,
             COUNT(DISTINCT o.date)::text AS days
        FROM orders o
       WHERE ${scope(startDate, endDate)} ${clamp(endDate)}
       GROUP BY 1`),
    db.execute<{ store: string; orders: string }>(sql`
      SELECT o.location AS store, COUNT(*)::text AS orders
        FROM orders o
       WHERE ${scope(cp.prevStart, cp.prevEnd)} ${clamp(cp.prevEnd)}
       GROUP BY 1`),
  ])

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const row: { hour: number } & Record<string, number> = { hour } as never
    for (const s of stores) { row[`${s}|orders`] = 0; row[`${s}|revenue`] = 0 }
    return row
  })
  for (const r of hourlyRes.rows) {
    if (!stores.includes(r.store as DemandStore)) continue
    hourly[r.hour][`${r.store}|orders`] = Number(r.orders)
    hourly[r.hour][`${r.store}|revenue`] = Number(r.revenue)
  }

  const byDay = Array.from({ length: 7 }, (_, dow) => {
    const row: { dow: number } & Record<string, number> = { dow } as never
    for (const s of stores) { row[`${s}|orders`] = 0; row[`${s}|revenue`] = 0 }
    return row
  })
  for (const r of dowRes.rows) {
    if (!stores.includes(r.store as DemandStore)) continue
    byDay[r.dow][`${r.store}|orders`] = Number(r.orders)
    byDay[r.dow][`${r.store}|revenue`] = Number(r.revenue)
  }

  const modes = modeRes.rows.map((r) => ({
    mode: r.mode, store: r.store, orders: Number(r.orders), revenue: Number(r.revenue),
  }))

  const sumStores = (row: Record<string, number>, field: "orders" | "revenue") =>
    stores.reduce((s, st) => s + (row[`${st}|${field}`] ?? 0), 0)

  const peakOf = (key: (h: (typeof hourly)[number]) => number) => {
    let best: number | null = null, bestVal = 0
    for (const h of hourly) { const v = key(h); if (v > bestVal) { bestVal = v; best = h.hour } }
    return best
  }
  const peakHour = peakOf((h) => sumStores(h, "orders"))
  let busiestDow: number | null = null
  { let best = 0; for (const d of byDay) { const v = sumStores(d, "orders"); if (v > best) { best = v; busiestDow = d.dow } } }

  const curBy = new Map(curRes.rows.map((r) => [r.store, r]))
  const prevBy = new Map(prevRes.rows.map((r) => [r.store, Number(r.orders)]))
  const byStore = stores.map((s) => {
    const orders = Number(curBy.get(s)?.orders ?? 0)
    const prevOrders = prevBy.get(s) ?? 0
    return {
      store: s, orders, prevOrders,
      changePct: prevOrders > 0 ? pctChange(orders, prevOrders) : null,
      peakHour: peakOf((h) => h[`${s}|orders`] ?? 0),
    }
  })
  const orders = byStore.reduce((s, r) => s + r.orders, 0)
  const prevOrders = byStore.reduce((s, r) => s + r.prevOrders, 0)
  const revenue = stores.reduce((s, st) => s + Number(curBy.get(st)?.revenue ?? 0), 0)
  const days = Math.max(0, ...stores.map((s) => Number(curBy.get(s)?.days ?? 0)))

  // ── Key patterns / exceptions (item 8) ──────────────────────────────────────
  const exceptions: DemandException[] = []
  if (orders === 0) {
    exceptions.push({ tone: "warning", text: "No orders in this selection — check the filters or sync Presto." })
  } else {
    if (busiestDow !== null) {
      const d = byDay[busiestDow]
      exceptions.push({
        tone: "neutral",
        text: `Busiest day: ${DAY_NAMES[busiestDow]} (${sumStores(d, "orders").toLocaleString()} orders in the period).`,
      })
    }
    if (peakHour !== null) {
      const h = hourly[peakHour]
      exceptions.push({
        tone: "neutral",
        text: `Busiest hour: ${fmtHour(peakHour)}–${fmtHour((peakHour + 1) % 24)} (${sumStores(h, "orders").toLocaleString()} orders).`,
      })
    }
    // Stores peaking at different hours is exactly what a combined view would hide.
    if (stores.length > 1) {
      const [a, b] = byStore
      if (a.peakHour !== null && b.peakHour !== null && a.peakHour !== b.peakHour) {
        exceptions.push({
          tone: "neutral",
          text: `Stores peak at different times: ${a.store} ${fmtHour(a.peakHour)}, ${b.store} ${fmtHour(b.peakHour)}.`,
        })
      }
    }
    for (const s of byStore) {
      if (s.changePct === null) {
        if (s.orders > 0) exceptions.push({ tone: "neutral", text: `${s.store}: no comparable prior-period data to compare against.` })
        continue
      }
      if (Math.abs(s.changePct) >= trendThreshold) {
        const up = s.changePct > 0
        exceptions.push({
          tone: up ? "good" : "problem",
          text: `${s.store} orders ${up ? "up" : "down"} ${Math.abs(s.changePct).toFixed(0)}% vs the comparable period ` +
            `(${s.orders.toLocaleString()} vs ${s.prevOrders.toLocaleString()}).`,
        })
      }
    }
    if (stores.some((s) => (curBy.get(s) ? Number(curBy.get(s)!.orders) : 0) === 0)) {
      const missing = stores.filter((s) => !curBy.get(s) || Number(curBy.get(s)!.orders) === 0)
      exceptions.push({ tone: "warning", text: `No orders recorded for ${missing.join(" and ")} in this period — check the Presto sync.` })
    }
  }

  return {
    stores,
    hourly,
    byDay,
    modes,
    totals: {
      orders, revenue, prevOrders,
      ordersChangePct: prevOrders > 0 ? pctChange(orders, prevOrders) : null,
      days,
      byStore,
    },
    peakHour,
    busiestDow,
    isPartial: cp.isPartial,
    exceptions,
  }
}
