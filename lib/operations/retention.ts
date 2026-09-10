"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { MARKETPLACE_CHANNELS } from "@/lib/db/slicers"
import { getSettingsLookup } from "@/lib/settings/actions"

/**
 * Direct Customer & Retention (Operations corrections §7).
 *
 * Covers IDENTIFIED DIRECT customers only: orders taken on Raja's own channels that
 * carry a customer id. Marketplace orders (Uber Eats, Deliveroo, Just Eat) carry a
 * per-order reference — every id is unique — so those customers cannot be tracked.
 *
 * Item 50: "direct" is defined as NOT a marketplace, never as a hard-coded "wix". A new
 * own website/app source is included automatically; the source breakdown shows how
 * reusable each source's ids actually are.
 *
 * Denominator (item 49/Test 12): Identified Direct Order % =
 *   orders on own channels with a customer id  ÷  ALL non-cancelled orders in scope
 * (every channel). It is the share of trade Raja's can recognise and remarket to.
 */

export type Segment = "New" | "Returning" | "Regular" | "At Risk" | "Lapsed"
export type RetentionAction = { kind: "fact" | "suggestion"; tone: "good" | "warning" | "problem" | "neutral"; text: string }

export type RetentionResult = {
  kpis: {
    identifiedCustomers: number
    newCustomers: number
    repeatRatePct: number
    returningRevenue: number
    identifiedDirectOrderPct: number
    identifiedOrders: number
    totalOrders: number
    avgOrdersPerCustomer: number
    avgSpendPerCustomer: number
  }
  segments: Array<{ segment: Segment; customers: number; periodRevenue: number }>
  cohorts: Array<{ week: string; newCustomers: number; matured: number; repeated: number; repeatPct: number | null }>
  trend: Array<{ period: string; identifiedPct: number; identified: number; total: number }>
  sources: Array<{ channel: string; customers: number; orders: number; repeatOrders: number }>
  customers: Array<{
    customerId: string; segment: Segment; periodOrders: number; lifetimeOrders: number
    periodSpend: number; firstOrder: string; lastOrder: string; daysSinceLast: number
  }>
  settings: { atRiskDays: number; lapsedDays: number; cohortWindowDays: number }
  historyStart: string | null
  actions: RetentionAction[]
  caveats: string[]
}

const DAY_MS = 86_400_000
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS)

export async function getRetention(startDate: string, endDate: string, location?: string): Promise<RetentionResult> {
  const setting = await getSettingsLookup()
  const atRiskDays = Math.round(setting("retention_at_risk_days"))
  const lapsedDays = Math.round(setting("retention_lapsed_days"))
  const cohortWindowDays = Math.round(setting("retention_cohort_window_days"))
  const store = location && location !== "all" ? location : null
  const locSql = store ? sql` AND o.location = ${store}` : sql``
  const marketplaces = sql.join(MARKETPLACE_CHANNELS.map((c) => sql`${c}`), sql`, `)
  const direct = sql`lower(COALESCE(o."orderChannel", '')) NOT IN (${marketplaces}) AND o."customerId" IS NOT NULL`

  // Weekly trend buckets unless the window is short enough to read daily.
  const daily = daysBetween(startDate, endDate) <= 14
  const bucket = daily ? sql`o.date::date::text` : sql`to_char(date_trunc('week', o.date::date), 'YYYY-MM-DD')`

  const [custRes, covRes, trendRes, srcRes, histRes] = await Promise.all([
    // Lifetime history up to the end date, per identified direct customer.
    db.execute<{
      cid: string; first_order: string; last_order: string; lifetime: string
      second_order: string | null; period_orders: string; period_spend: string; period_returning_spend: string
    }>(sql`
      WITH d AS (
        SELECT o."customerId" AS cid, o.date::date AS d, o."totalAmount"::numeric AS amt,
               ROW_NUMBER() OVER (PARTITION BY o."customerId" ORDER BY o.date, o."orderTime", o."orderId") AS rn
          FROM orders o
         WHERE o.cancelled = false AND ${direct}
           AND o.date::date <= ${endDate}::date ${locSql}
      )
      SELECT cid,
             MIN(d)::text                                                        AS first_order,
             MAX(d)::text                                                        AS last_order,
             COUNT(*)::text                                                      AS lifetime,
             MIN(d) FILTER (WHERE rn = 2)::text                                  AS second_order,
             COUNT(*) FILTER (WHERE d >= ${startDate}::date)::text               AS period_orders,
             COALESCE(SUM(amt) FILTER (WHERE d >= ${startDate}::date), 0)::text  AS period_spend,
             COALESCE(SUM(amt) FILTER (WHERE d >= ${startDate}::date AND rn > 1), 0)::text AS period_returning_spend
        FROM d GROUP BY cid`),
    db.execute<{ total: string; identified: string }>(sql`
      SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE ${direct})::text AS identified
        FROM orders o
       WHERE o.cancelled = false AND o.date::date >= ${startDate}::date AND o.date::date <= ${endDate}::date ${locSql}`),
    db.execute<{ period: string; total: string; identified: string }>(sql`
      SELECT ${bucket} AS period, COUNT(*)::text AS total, COUNT(*) FILTER (WHERE ${direct})::text AS identified
        FROM orders o
       WHERE o.cancelled = false AND o.date::date >= ${startDate}::date AND o.date::date <= ${endDate}::date ${locSql}
       GROUP BY 1 ORDER BY 1`),
    db.execute<{ channel: string; customers: string; orders: string }>(sql`
      SELECT lower(COALESCE(o."orderChannel", 'unknown')) AS channel,
             COUNT(DISTINCT o."customerId")::text AS customers, COUNT(*)::text AS orders
        FROM orders o
       WHERE o.cancelled = false AND ${direct}
         AND o.date::date >= ${startDate}::date AND o.date::date <= ${endDate}::date ${locSql}
       GROUP BY 1 ORDER BY 3 DESC`),
    db.execute<{ first: string | null }>(sql`SELECT MIN(date)::text AS first FROM orders`),
  ])

  const historyStart = histRes.rows[0]?.first ?? null
  const all = custRes.rows.map((r) => ({
    cid: r.cid,
    first: r.first_order,
    last: r.last_order,
    lifetime: Number(r.lifetime),
    second: r.second_order,
    periodOrders: Number(r.period_orders),
    periodSpend: Number(r.period_spend),
    periodReturningSpend: Number(r.period_returning_spend),
  }))

  const segmentOf = (c: (typeof all)[number]): Segment => {
    const since = daysBetween(c.last, endDate)
    if (since > lapsedDays) return "Lapsed"
    if (since > atRiskDays) return "At Risk"
    if (c.lifetime >= 3) return "Regular"
    if (c.lifetime === 2) return "Returning"
    return "New"
  }

  const active = all.filter((c) => c.periodOrders > 0)
  const newCustomers = active.filter((c) => c.first >= startDate).length
  const repeaters = active.filter((c) => c.lifetime >= 2).length
  const periodSpend = active.reduce((s, c) => s + c.periodSpend, 0)
  const periodOrders = active.reduce((s, c) => s + c.periodOrders, 0)
  const returningRevenue = all.reduce((s, c) => s + c.periodReturningSpend, 0)

  const totalOrders = Number(covRes.rows[0]?.total ?? 0)
  const identifiedOrders = Number(covRes.rows[0]?.identified ?? 0)

  const SEGMENTS: Segment[] = ["New", "Returning", "Regular", "At Risk", "Lapsed"]
  const segments = SEGMENTS.map((segment) => {
    const members = all.filter((c) => segmentOf(c) === segment)
    return { segment, customers: members.length, periodRevenue: members.reduce((s, c) => s + c.periodSpend, 0) }
  })

  // Cohorts: customers whose FIRST order falls in the window, by week of first order.
  // A cohort member is "matured" once their repeat window has fully elapsed; the
  // repeat rate is only calculated over matured members so recent customers, who
  // have not had time to come back, do not drag it down.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())
  const horizon = endDate < today ? endDate : today
  const weekOf = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`)
    const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
    return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10)
  }
  const cohortMap = new Map<string, { newCustomers: number; matured: number; repeated: number }>()
  for (const c of all) {
    if (c.first < startDate || c.first > endDate) continue
    const w = weekOf(c.first)
    const row = cohortMap.get(w) ?? { newCustomers: 0, matured: 0, repeated: 0 }
    row.newCustomers++
    if (daysBetween(c.first, horizon) >= cohortWindowDays) {
      row.matured++
      if (c.second && daysBetween(c.first, c.second) <= cohortWindowDays) row.repeated++
    }
    cohortMap.set(w, row)
  }
  const cohorts = [...cohortMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, r]) => ({
    week, ...r, repeatPct: r.matured > 0 ? (r.repeated / r.matured) * 100 : null,
  }))

  const trend = trendRes.rows.map((r) => {
    const total = Number(r.total), identified = Number(r.identified)
    return { period: r.period, total, identified, identifiedPct: total > 0 ? (identified / total) * 100 : 0 }
  })

  const sources = srcRes.rows.map((r) => {
    const customers = Number(r.customers), orders = Number(r.orders)
    return { channel: r.channel, customers, orders, repeatOrders: orders - customers }
  })

  const customers = [...active]
    .sort((a, b) => b.periodSpend - a.periodSpend)
    .slice(0, 50)
    .map((c) => ({
      customerId: c.cid,
      segment: segmentOf(c),
      periodOrders: c.periodOrders,
      lifetimeOrders: c.lifetime,
      periodSpend: c.periodSpend,
      firstOrder: c.first,
      lastOrder: c.last,
      daysSinceLast: daysBetween(c.last, endDate),
    }))

  // ── Caveats ────────────────────────────────────────────────────────────────
  const caveats: string[] = []
  const historyDays = historyStart ? daysBetween(historyStart, endDate) : 0
  if (historyStart && historyDays < lapsedDays) {
    caveats.push(
      `Order history starts ${historyStart} (${historyDays} days before the end of this period). ` +
      `A customer can only become At Risk after ${atRiskDays} days or Lapsed after ${lapsedDays} days ` +
      `without ordering, so these counts stay low until more history accumulates. For the same reason ` +
      `"New" means first order since ${historyStart}: someone who last ordered before then still counts as new.`,
    )
  }
  if (cohorts.length > 0 && cohorts.every((c) => c.matured === 0)) {
    caveats.push(`No cohort has completed its ${cohortWindowDays}-day repeat window yet, so cohort repeat % is not available.`)
  }
  for (const s of sources) {
    if (s.orders >= 20 && s.repeatOrders / s.orders < 0.02) {
      caveats.push(
        `${s.channel}: ${s.customers} ids across ${s.orders} orders — almost none repeat, which suggests ` +
        `per-order guest references rather than real customer accounts. Treat its New counts with caution.`,
      )
    }
  }

  // ── Facts first, then suggestions (item 48: no unmeasured ROI claims) ──────
  const actions: RetentionAction[] = []
  const identifiedDirectOrderPct = totalOrders > 0 ? (identifiedOrders / totalOrders) * 100 : 0
  const atRisk = segments.find((s) => s.segment === "At Risk")!.customers
  const lapsed = segments.find((s) => s.segment === "Lapsed")!.customers
  const regular = segments.find((s) => s.segment === "Regular")!.customers

  actions.push({
    kind: "fact", tone: identifiedDirectOrderPct < 20 ? "warning" : "neutral",
    text: `${identifiedDirectOrderPct.toFixed(1)}% of orders (${identifiedOrders.toLocaleString()} of ${totalOrders.toLocaleString()}) come from customers Raja's can identify.`,
  })
  if (active.length > 0) {
    actions.push({
      kind: "fact", tone: "neutral",
      text: `${repeaters} of ${active.length} customers active this period have ordered more than once (${((repeaters / active.length) * 100).toFixed(1)}%).`,
    })
  }
  if (atRisk + lapsed > 0) {
    actions.push({
      kind: "suggestion", tone: "warning",
      text: `${atRisk} At Risk and ${lapsed} Lapsed customers. Suggested test: a win-back message to one group, with a held-out control, before rolling it out.`,
    })
  }
  if (newCustomers > 0) {
    actions.push({
      kind: "suggestion", tone: "neutral",
      text: `${newCustomers} first-time customers this period. Suggested test: a second-order incentive, measured through the cohort repeat % below.`,
    })
  }
  if (regular > 0) {
    actions.push({
      kind: "suggestion", tone: "good",
      text: `${regular} Regular customers (3+ orders). Suggested: recognise them before offering discounts — they already return without one.`,
    })
  }

  return {
    kpis: {
      identifiedCustomers: active.length,
      newCustomers,
      repeatRatePct: active.length > 0 ? (repeaters / active.length) * 100 : 0,
      returningRevenue,
      identifiedDirectOrderPct,
      identifiedOrders,
      totalOrders,
      avgOrdersPerCustomer: active.length > 0 ? periodOrders / active.length : 0,
      avgSpendPerCustomer: active.length > 0 ? periodSpend / active.length : 0,
    },
    segments,
    cohorts,
    trend,
    sources,
    customers,
    settings: { atRiskDays, lapsedDays, cohortWindowDays },
    historyStart,
    actions,
    caveats,
  }
}
