"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { driverShift } from "@/lib/db/schema"
import { getSettingsLookup } from "@/lib/settings/actions"

/**
 * Hyde Park direct-delivery driver cost (spec §9).
 *
 *   Hourly allocation  = driver shift hourly cost ÷ completed deliveries during shift
 *   Base delivery pay  = completed delivery × editable base £/delivery
 *   Extra mileage      = miles above included mileage × editable £/mile
 *   Total driver cost  = hourly allocation + base delivery pay + extra mileage
 *   Net delivery cost  = total driver cost − customer delivery fee recovered
 *
 * Every rate is owner-editable in Settings. Driver HOURS have no upstream source, so
 * they come from the manual shift log — §9 explicitly allows this ("If none exists,
 * create a minimal Driver Shift Log").
 */

export type DriverCostResult = {
  deliveries: number
  shiftHours: number
  hourlyAllocation: number
  basePay: number
  extraMileage: number
  totalDriverCost: number
  deliveryFeeRecovered: number
  netDeliveryCost: number
  perDelivery: number
  /** Populated when an input is missing, so a zero is never mistaken for "free". */
  caveats: string[]
}

export async function getDriverCost(
  startDate: string,
  endDate: string,
  store = "Hyde Park",
): Promise<DriverCostResult> {
  const setting = await getSettingsLookup()
  const hourlyRate = setting("driver_hourly_rate")
  const basePerDelivery = setting("driver_base_per_delivery")
  const includedMiles = setting("driver_included_miles")
  const extraPerMile = setting("driver_extra_per_mile")

  const caveats: string[] = []

  // Completed deliveries, distance and the fee recovered from customers.
  // The included mileage applies to EACH delivery (Corrections item 27: "£1 per mile
  // only for mileage above 3 miles"), so extra miles are summed per delivery. Netting
  // total miles against deliveries × 3 let short trips cancel out long ones.
  const del = await db.execute<{ n: string; miles: string; extra: string; fees: string }>(sql`
    SELECT COUNT(*)::text                                             AS n,
           COALESCE(SUM(distance::numeric), 0)::text                  AS miles,
           COALESCE(SUM(GREATEST(distance::numeric - ${includedMiles}::numeric, 0)), 0)::text AS extra,
           COALESCE(SUM("deliveryFee"::numeric), 0)::text             AS fees
      FROM deliveries
     WHERE "deliveryTime" IS NOT NULL
       -- deliveryTime is a naive UTC timestamp: anchor it to UTC first, then read the
       -- UK wall clock. A single AT TIME ZONE would treat the UTC value as UK time.
       AND (("deliveryTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date >= ${startDate}::date
       AND (("deliveryTime" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date <= ${endDate}::date`)

  const deliveries = Number(del.rows?.[0]?.n ?? 0)
  const totalMiles = Number(del.rows?.[0]?.miles ?? 0)
  const chargeableMiles = Number(del.rows?.[0]?.extra ?? 0)
  const deliveryFeeRecovered = Number(del.rows?.[0]?.fees ?? 0)

  // Shift hours from the manual log.
  const shifts = await db.execute<{ hours: string; n: string }>(sql`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("finishTime" - "startTime")) / 3600.0), 0)::text AS hours,
           COUNT(*)::text AS n
      FROM driver_shift
     WHERE store = ${store}
       AND "shiftDate" >= ${startDate}::date
       AND "shiftDate" <= ${endDate}::date`)

  const shiftHours = Number(shifts.rows?.[0]?.hours ?? 0)
  const shiftCount = Number(shifts.rows?.[0]?.n ?? 0)

  if (deliveries === 0) caveats.push("No completed deliveries in this period — re-sync Shipday.")
  if (shiftCount === 0) caveats.push("No driver shifts logged — hourly allocation cannot be calculated.")
  if (deliveries > 0 && totalMiles === 0) caveats.push("Shipday returned no distance data, so extra mileage is 0.")

  // Hourly cost is spread across the deliveries completed during those shifts.
  const hourlyAllocation = shiftHours * hourlyRate
  const basePay = deliveries * basePerDelivery
  const extraMileage = chargeableMiles * extraPerMile

  const totalDriverCost = hourlyAllocation + basePay + extraMileage
  const netDeliveryCost = totalDriverCost - deliveryFeeRecovered

  return {
    deliveries,
    shiftHours,
    hourlyAllocation,
    basePay,
    extraMileage,
    totalDriverCost,
    deliveryFeeRecovered,
    netDeliveryCost,
    perDelivery: deliveries > 0 ? netDeliveryCost / deliveries : 0,
    caveats,
  }
}

/** Shifts for the log table, newest first. */
export async function getDriverShifts(limit = 50) {
  const r = await db.execute(sql`
    SELECT id, store, "driverName", "shiftDate"::text AS "shiftDate",
           "startTime", "finishTime", notes,
           ROUND(EXTRACT(EPOCH FROM ("finishTime" - "startTime")) / 3600.0, 2)::text AS hours
      FROM driver_shift
     ORDER BY "shiftDate" DESC, "startTime" DESC
     LIMIT ${limit}`)
  return r.rows
}

/** Record one shift. Times are UK-local wall clock as entered by the operator. */
export async function addDriverShift(input: {
  store: string
  driverName: string
  shiftDate: string
  startTime: string   // "HH:MM"
  finishTime: string  // "HH:MM"
  notes?: string
}) {
  try {
    if (!input.driverName?.trim()) return { success: false, error: "Driver name is required" }
    // Stored as the UK wall clock the operator typed. The explicit "Z" stops the
    // server's own timezone shifting it (a +05:00 dev machine stored 17:00 as 12:00).
    const start = new Date(`${input.shiftDate}T${input.startTime}:00Z`)
    let finish = new Date(`${input.shiftDate}T${input.finishTime}:00Z`)
    // Trade runs past midnight — a finish before the start belongs to the next day.
    if (finish <= start) finish = new Date(finish.getTime() + 86_400_000)

    await db.insert(driverShift).values({
      store: input.store,
      driverName: input.driverName.trim(),
      shiftDate: input.shiftDate,
      startTime: start,
      finishTime: finish,
      notes: input.notes?.trim() || null,
    })
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

export async function deleteDriverShift(id: number) {
  try {
    await db.execute(sql`DELETE FROM driver_shift WHERE id = ${id}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}
