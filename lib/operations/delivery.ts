"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { normKey, MARKETPLACE_CHANNELS } from "@/lib/db/slicers"
import { getSettingsLookup } from "@/lib/settings/actions"
import { getRevenueBasis } from "@/lib/analytics/revenue-basis"

/**
 * Delivery & Driver Analytics (Operations corrections §5) — Hyde Park only.
 *
 * Hyde Park runs in-house drivers dispatched through Shipday; Grand Arcade uses
 * platform riders, so in-house driver cost KPIs are meaningless there (item 11).
 * Every Shipday delivery comes from the Hyde Park kitchen (LS3 1DT).
 *
 * Driver cost (items 15-16, rates from Settings → Hyde Park Drivers):
 *   hourly pay         = logged shift hours × hourly rate, allocated across the
 *                        deliveries that driver completed inside that shift (item 25)
 *   completed delivery = base £ per delivery
 *   extra mileage      = miles above the included mileage, PER delivery, × £/mile
 * Shipday `distance` is in miles (verified: road distance averages ~1.5× the straight
 * line in miles; read as km it would be shorter than the straight line).
 *
 * Delivery contribution (item 21) uses the same live economics as Analytics. Each
 * Shipday delivery links to its POS order through Presto's order number (Shipday's
 * orderNumber ends with it), so:
 *   revenue − platform commission − live food cost − Raja's-funded discount − driver cost
 * Food cost is the Product Master cost fed by the costing chain; there is no separate
 * cost table here.
 */

export type DeliveryException = { tone: "good" | "warning" | "problem" | "neutral"; text: string }

export type DeliveryOpsResult =
  | { applicable: false; reason: string }
  | {
      applicable: true
      settings: { targetMinutes: number; hourlyRate: number; basePerDelivery: number; includedMiles: number; extraPerMile: number }
      kpis: {
        deliveries: number
        avgMinutes: number
        withinTargetPct: number
        driverCost: number
        costPerDelivery: number
        contribution: number
        contributionPerDelivery: number
        contributionComplete: boolean
      }
      costBreakdown: { hourlyPay: number; basePay: number; extraMileagePay: number; shiftHours: number; extraMiles: number }
      timeBands: Array<{ band: string; deliveries: number; pct: number }>
      stages: { dispatch: number; kitchen: number; road: number }
      contribution: Array<{
        segment: string; deliveries: number; revenue: number; commission: number; foodCost: number
        discount: number; driverCost: number; contribution: number; perDelivery: number
      }>
      drivers: Array<{
        driver: string; hours: number | null; deliveries: number; avgMinutes: number; withinPct: number
        miles: number; cost: number; costPerDelivery: number | null
      }>
      hourly: Array<{ hour: number; deliveries: number; driversActive: number; perDriver: number; costPerDelivery: number | null }>
      distanceBands: Array<{ band: string; deliveries: number; avgMinutes: number; costPerDelivery: number | null }>
      linkedPct: number
      revenueLabel: string
      incompleteReasons: string[]
      exceptions: DeliveryException[]
    }

type DelRow = {
  id: number; driver: string; mins: string | null; dispatch_m: string | null; kitchen_m: string | null; road_m: string | null
  miles: string | null; uk_ts: string; uk_date: string; uk_hour: number
  order_id: string | null; channel: string | null; revenue: string | null; gross: string | null
  discount: string | null; food_cost: string | null; all_costed: boolean | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)

export async function getDeliveryOps(startDate: string, endDate: string, location?: string): Promise<DeliveryOpsResult> {
  if (location === "Grand Arcade") {
    return {
      applicable: false,
      reason:
        "Grand Arcade deliveries are made by Uber Eats, Deliveroo and Just Eat riders, so there is no " +
        "in-house driver cost to analyse. Delivery & driver analytics apply to Hyde Park only.",
    }
  }

  const setting = await getSettingsLookup()
  const rb = await getRevenueBasis()
  const s = {
    targetMinutes: setting("delivery_target_minutes"),
    hourlyRate: setting("driver_hourly_rate"),
    basePerDelivery: setting("driver_base_per_delivery"),
    includedMiles: setting("driver_included_miles"),
    extraPerMile: setting("driver_extra_per_mile"),
  }
  const revenueExpr = rb.basis === "gross"
    ? sql`o."totalAmount"::numeric`
    : sql`GREATEST(o."totalAmount"::numeric - COALESCE(o."vatAmount"::numeric, 0), 0)`
  // deliveryTime is a naive UTC timestamp: anchor to UTC, then read the UK wall clock.
  const ukTime = sql`((d."deliveryTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')`

  const [delRes, shiftRes] = await Promise.all([
    db.execute<DelRow>(sql`
      WITH alias1 AS (
        SELECT DISTINCT ON (lower(ia."normalizedRaw")) lower(ia."normalizedRaw") AS nk, ia."productMasterId" AS pmid
          FROM item_alias ia WHERE ia."productMasterId" IS NOT NULL
         ORDER BY lower(ia."normalizedRaw"), ia.reviewed DESC, ia.id
      ),
      del AS (
        SELECT d.id,
               COALESCE(NULLIF(btrim(d."driverName"), ''), 'Unassigned') AS driver,
               EXTRACT(EPOCH FROM (d."deliveryTime" - d."placementTime")) / 60 AS mins,
               EXTRACT(EPOCH FROM (d."assignedTime" - d."placementTime")) / 60 AS dispatch_m,
               EXTRACT(EPOCH FROM (d."pickedupTime" - d."assignedTime")) / 60 AS kitchen_m,
               EXTRACT(EPOCH FROM (d."deliveryTime" - d."pickedupTime")) / 60 AS road_m,
               d.distance::numeric AS miles,
               to_char(${ukTime}, 'YYYY-MM-DD HH24:MI') AS uk_ts,
               to_char(${ukTime}, 'YYYY-MM-DD') AS uk_date,
               EXTRACT(HOUR FROM ${ukTime})::int AS uk_hour,
               po."orderId" AS order_id,
               lower(po."orderChannel") AS channel,
               po.revenue, po.gross, po.discount
          FROM deliveries d
          -- Link to the POS order by Presto order number; nearest date wins should a
          -- device counter ever repeat.
          LEFT JOIN LATERAL (
            SELECT o."orderId", o."orderChannel",
                   ${revenueExpr} AS revenue,
                   o."totalAmount"::numeric AS gross,
                   COALESCE(o."discountValue"::numeric, 0) AS discount
              FROM orders o
             WHERE o.location = 'Hyde Park'
               AND o.cancelled = false
               AND o."orderNo" = split_part(d."orderNumber", '_', 3)
             ORDER BY abs(o.date::date - ${ukTime}::date)
             LIMIT 1
          ) po ON true
         WHERE d."deliveryTime" IS NOT NULL
           AND ${ukTime}::date >= ${startDate}::date
           AND ${ukTime}::date <= ${endDate}::date
      ),
      oc AS (
        SELECT oi."orderId",
               SUM(oi.qty::numeric * pm."currentCost") AS food_cost,
               bool_and(pm."currentCost" IS NOT NULL) AS all_costed
          FROM order_items oi
          LEFT JOIN alias1 a ON a.nk = ${normKey(sql`oi."itemName"`)}
          LEFT JOIN product_master pm ON pm.id = a.pmid
         WHERE oi."orderId" IN (SELECT order_id FROM del WHERE order_id IS NOT NULL)
           AND oi.amount::numeric > 0 AND oi.cancelled = false
         GROUP BY oi."orderId"
      )
      SELECT del.id, del.driver, del.mins::text, del.dispatch_m::text, del.kitchen_m::text, del.road_m::text,
             del.miles::text, del.uk_ts, del.uk_date, del.uk_hour, del.order_id, del.channel,
             del.revenue::text, del.gross::text, del.discount::text,
             oc.food_cost::text AS food_cost, oc.all_costed
        FROM del LEFT JOIN oc ON oc."orderId" = del.order_id`),
    db.execute<{ driver: string; s: string; f: string; hours: string }>(sql`
      SELECT btrim("driverName") AS driver,
             to_char("startTime", 'YYYY-MM-DD HH24:MI') AS s,
             to_char("finishTime", 'YYYY-MM-DD HH24:MI') AS f,
             (EXTRACT(EPOCH FROM ("finishTime" - "startTime")) / 3600)::text AS hours
        FROM driver_shift
       WHERE store = 'Hyde Park'
         AND "shiftDate" >= ${startDate}::date AND "shiftDate" <= ${endDate}::date`),
  ])

  const num = (v: string | null) => (v === null ? null : Number(v))
  const dels = delRes.rows.map((r) => {
    const miles = num(r.miles)
    return {
      ...r,
      driverKey: r.driver.toLowerCase(),
      mins: num(r.mins),
      miles,
      extraMiles: miles === null ? 0 : Math.max(0, miles - s.includedMiles),
      hourlyAlloc: 0,
    }
  })
  const shifts = shiftRes.rows.map((r) => ({ ...r, key: r.driver.toLowerCase(), hours: Number(r.hours) }))

  // ── Hourly pay allocated across the deliveries each driver completed in the shift ──
  let unallocatedPay = 0
  for (const sh of shifts) {
    const pay = sh.hours * s.hourlyRate
    const inShift = dels.filter((d) => d.driverKey === sh.key && d.uk_ts >= sh.s && d.uk_ts <= sh.f)
    if (inShift.length === 0) { unallocatedPay += pay; continue }
    for (const d of inShift) d.hourlyAlloc += pay / inShift.length
  }
  const outsideShift = shifts.length > 0 ? dels.filter((d) => d.hourlyAlloc === 0).length : dels.length
  const costOf = (d: (typeof dels)[number]) => d.hourlyAlloc + s.basePerDelivery + d.extraMiles * s.extraPerMile

  const n = dels.length
  const timed = dels.filter((d) => d.mins !== null && d.mins >= 0)
  const within = timed.filter((d) => d.mins! <= s.targetMinutes).length
  const shiftHours = shifts.reduce((a, x) => a + x.hours, 0)
  const hourlyPay = shiftHours * s.hourlyRate
  const basePay = n * s.basePerDelivery
  const extraMiles = dels.reduce((a, d) => a + d.extraMiles, 0)
  const extraMileagePay = extraMiles * s.extraPerMile
  const driverCost = hourlyPay + basePay + extraMileagePay

  // ── Time bands (item 14) ──
  const bandDefs: Array<[string, (m: number) => boolean]> = [
    ["≤35 min", (m) => m <= 35],
    ["36–45 min", (m) => m > 35 && m <= 45],
    ["46–60 min", (m) => m > 45 && m <= 60],
    [">60 min", (m) => m > 60],
  ]
  const timeBands = bandDefs.map(([band, test]) => {
    const c = timed.filter((d) => test(d.mins!)).length
    return { band, deliveries: c, pct: timed.length ? (c / timed.length) * 100 : 0 }
  })

  const stageAvg = (k: "dispatch_m" | "kitchen_m" | "road_m") =>
    avg(dels.map((d) => num(d[k])).filter((v): v is number => v !== null && v >= 0 && v < 240))
  const stages = { dispatch: stageAvg("dispatch_m"), kitchen: stageAvg("kitchen_m"), road: stageAvg("road_m") }

  // ── Contribution: direct vs platform orders delivered by our own drivers ──
  const commissionFor = (ch: string) => setting("commission_pct", "Hyde Park", ch)
  const segments = new Map<string, { deliveries: number; revenue: number; commission: number; foodCost: number; discount: number; driverCost: number }>()
  let linked = 0, uncosted = 0, platformDiscount = 0
  for (const d of dels) {
    const isPlatform = !!d.channel && MARKETPLACE_CHANNELS.includes(d.channel)
    const seg = !d.order_id ? "Not linked to a POS order" : isPlatform ? "Platform orders (our drivers)" : "Direct orders"
    const row = segments.get(seg) ?? { deliveries: 0, revenue: 0, commission: 0, foodCost: 0, discount: 0, driverCost: 0 }
    row.deliveries++
    row.driverCost += costOf(d)
    if (d.order_id) {
      linked++
      row.revenue += Number(d.revenue ?? 0)
      row.commission += isPlatform ? Number(d.gross ?? 0) * commissionFor(d.channel!) : 0
      row.foodCost += Number(d.food_cost ?? 0)
      row.discount += Number(d.discount ?? 0)
      if (isPlatform) platformDiscount += Number(d.discount ?? 0)
      if (d.all_costed === false || d.food_cost === null) uncosted++
    }
    segments.set(seg, row)
  }
  const contribution = [...segments.entries()].map(([segment, r]) => {
    const c = r.revenue - r.commission - r.foodCost - r.discount - r.driverCost
    return { segment, ...r, contribution: c, perDelivery: r.deliveries ? c / r.deliveries : 0 }
  }).sort((a, b) => b.deliveries - a.deliveries)
  // Shift pay with no delivery to land on still has to be paid.
  const totalContribution = contribution.reduce((a, r) => a + r.contribution, 0) - unallocatedPay

  // ── Driver table (item 18) ──
  const driverKeys = new Set([...dels.map((d) => d.driverKey), ...shifts.map((x) => x.key)])
  const drivers = [...driverKeys].map((key) => {
    const mine = dels.filter((d) => d.driverKey === key)
    const mineTimed = mine.filter((d) => d.mins !== null && d.mins >= 0)
    const myShifts = shifts.filter((x) => x.key === key)
    const hours = myShifts.length ? myShifts.reduce((a, x) => a + x.hours, 0) : null
    const cost = (hours ?? 0) * s.hourlyRate + mine.length * s.basePerDelivery +
      mine.reduce((a, d) => a + d.extraMiles, 0) * s.extraPerMile
    return {
      driver: mine[0]?.driver ?? myShifts[0]?.driver ?? key,
      hours,
      deliveries: mine.length,
      avgMinutes: avg(mineTimed.map((d) => d.mins!)),
      withinPct: mineTimed.length ? (mineTimed.filter((d) => d.mins! <= s.targetMinutes).length / mineTimed.length) * 100 : 0,
      miles: mine.reduce((a, d) => a + (d.miles ?? 0), 0),
      cost,
      costPerDelivery: mine.length ? cost / mine.length : null,
    }
  }).sort((a, b) => b.deliveries - a.deliveries)

  // ── Hourly utilisation (item 19) ──
  const hours = [...new Set(dels.map((d) => d.uk_hour))].sort((a, b) => a - b)
  const hourly = hours.map((hour) => {
    const inHour = dels.filter((d) => d.uk_hour === hour)
    const driverHours = new Set(inHour.map((d) => `${d.uk_date}|${d.driverKey}`)).size
    const days = new Set(inHour.map((d) => d.uk_date)).size
    return {
      hour,
      deliveries: inHour.length,
      driversActive: days ? driverHours / days : 0,
      perDriver: driverHours ? inHour.length / driverHours : 0,
      costPerDelivery: shifts.length ? inHour.reduce((a, d) => a + costOf(d), 0) / inHour.length : null,
    }
  })

  // ── Distance bands (item 20) ──
  const distDefs: Array<[string, (m: number) => boolean]> = [
    ["0–1 mi", (m) => m < 1], ["1–2 mi", (m) => m >= 1 && m < 2], ["2–3 mi", (m) => m >= 2 && m < 3],
    ["3–4 mi", (m) => m >= 3 && m < 4], ["4+ mi", (m) => m >= 4],
  ]
  const distanceBands = distDefs.map(([band, test]) => {
    const inBand = dels.filter((d) => d.miles !== null && test(d.miles))
    return {
      band,
      deliveries: inBand.length,
      avgMinutes: avg(inBand.filter((d) => d.mins !== null && d.mins >= 0).map((d) => d.mins!)),
      costPerDelivery: inBand.length && shifts.length ? inBand.reduce((a, d) => a + costOf(d), 0) / inBand.length : null,
    }
  })

  // ── Completeness (item 17): never present a partial cost as the real one ──
  const incompleteReasons: string[] = []
  if (n === 0) incompleteReasons.push("No completed Shipday deliveries in this period — sync Shipday (Settings → Data Sync).")
  if (shifts.length === 0 && n > 0) {
    incompleteReasons.push("No Hyde Park driver shifts logged for this period, so hourly driver pay is missing (Settings → Driver Shifts).")
  } else if (outsideShift > 0 && n > 0) {
    incompleteReasons.push(`${outsideShift} deliveries fall outside any logged shift for their driver, so they carry no hourly pay.`)
  }
  const noDistance = dels.filter((d) => d.miles === null).length
  if (noDistance > 0) incompleteReasons.push(`${noDistance} deliveries have no distance from Shipday, so their extra mileage is unknown.`)
  const linkedPct = n ? (linked / n) * 100 : 0
  if (n > 0 && linkedPct < 95) {
    incompleteReasons.push(`${n - linked} deliveries (${(100 - linkedPct).toFixed(0)}%) could not be matched to a POS order, so their revenue and food cost are missing.`)
  }
  if (uncosted > 0) incompleteReasons.push(`${uncosted} delivered orders contain items with no live cost in the Product Master.`)
  if (platformDiscount > 0) {
    incompleteReasons.push("Platform order discounts are treated as fully Raja's-funded until offer funding splits are set up — contribution is provisional.")
  }

  // ── Exceptions & actions (item 22) ──
  const exceptions: DeliveryException[] = []
  const withinPct = timed.length ? (within / timed.length) * 100 : 0
  if (n > 0) {
    exceptions.push({
      tone: withinPct >= 85 ? "good" : withinPct >= 70 ? "warning" : "problem",
      text: `${withinPct.toFixed(0)}% of deliveries arrived within ${s.targetMinutes} minutes (${within} of ${timed.length}).`,
    })
    const worstStage = (Object.entries(stages) as Array<[keyof typeof stages, number]>).sort((a, b) => b[1] - a[1])[0]
    const stageText = { dispatch: "waiting for a driver to be assigned", kitchen: "between assignment and pick-up (kitchen / driver arrival)", road: "on the road" }
    exceptions.push({
      tone: "neutral",
      text: `Most time is lost ${stageText[worstStage[0]]}: ${worstStage[1].toFixed(0)} min on average.`,
    })
    const slow = drivers.filter((d) => d.deliveries >= 5).sort((a, b) => a.withinPct - b.withinPct)[0]
    if (slow && slow.withinPct < withinPct - 10) {
      exceptions.push({
        tone: "warning",
        text: `${slow.driver}: ${slow.withinPct.toFixed(0)}% within target over ${slow.deliveries} deliveries, below the ${withinPct.toFixed(0)}% average.`,
      })
    }
    const far = distanceBands.find((b) => b.band === "4+ mi")
    if (far && far.deliveries > 0) {
      exceptions.push({
        tone: "warning",
        text: `${far.deliveries} deliveries were 4+ miles (avg ${far.avgMinutes.toFixed(0)} min) — each pays extra mileage beyond the included ${s.includedMiles} miles.`,
      })
    }
    for (const seg of contribution) {
      if (seg.segment !== "Not linked to a POS order" && seg.deliveries >= 5 && seg.contribution < 0) {
        exceptions.push({
          tone: "problem",
          text: `${seg.segment} lose £${Math.abs(seg.perDelivery).toFixed(2)} per delivery after commission, food and driver cost.`,
        })
      }
    }
  }
  if (incompleteReasons.length > 0) {
    exceptions.unshift({ tone: "warning", text: "Delivery contribution is incomplete — see the data warnings below." })
  }

  return {
    applicable: true,
    settings: s,
    kpis: {
      deliveries: n,
      avgMinutes: avg(timed.map((d) => d.mins!)),
      withinTargetPct: withinPct,
      driverCost,
      costPerDelivery: n ? driverCost / n : 0,
      contribution: totalContribution,
      contributionPerDelivery: n ? totalContribution / n : 0,
      contributionComplete: incompleteReasons.length === 0,
    },
    costBreakdown: { hourlyPay, basePay, extraMileagePay, shiftHours, extraMiles },
    timeBands,
    stages,
    contribution,
    drivers,
    hourly,
    distanceBands,
    linkedPct,
    revenueLabel: rb.label,
    incompleteReasons,
    exceptions,
  }
}
