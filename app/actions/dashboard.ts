"use server"

import { db } from "@/lib/db"
import { menuItems, orders, orderItems, deliveries, syncLogs, itemAlias, dimCostingItem, actionItems } from "@/lib/db/schema"
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm"

// Helper: cast date column and string to ::date for correct Postgres date comparison
const dateGte = (col: any, d: string) => sql`${col}::date >= ${d}::date`
const dateLte = (col: any, d: string) => sql`${col}::date <= ${d}::date`

// ─── Sales-channel bucket filter ─────────────────────────────────────────────
// Splits orders into three buckets by orderChannel (every order/line carries one):
//   • instore   → "wix"   (in-house EPOS: walk-in, dine-in, phone)
//   • website   → "eatpresto" (own online-ordering storefront)
//   • platforms → uber eats / deliveroo / just eat (third-party delivery apps)
// "all" (or undefined) applies no filter. Works for both query styles: pass a Drizzle
// column (orders.orderChannel) OR a raw sql expression (sql`oi."orderChannel"`).
const CHANNEL_MAP: Record<string, string[]> = {
  instore: ["wix"],
  website: ["eatpresto"],
  platforms: ["ubereats", "deliveroo", "justeat"],
}
function channelCondition(channelCol: any, channel?: string | null) {
  if (!channel || channel === "all") return undefined
  const vals = CHANNEL_MAP[channel]
  if (!vals || vals.length === 0) return undefined
  return sql`LOWER(${channelCol}) IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`
}

// ─── Reviewed-cost resolution (normalisation layer) ──────────────────────────
// Reports cost POS lines through the human-reviewed item_alias → dim_costing_item
// mapping, NOT the legacy menu_items.costPrice exact-name join (which misses the
// messy POS spellings/sizes/initials the Name Review screen maps by hand).
//
// normKey() replicates lib/normalise normalizeRaw() in SQL: lower + trim +
// whitespace-collapse + the (tiny) typo map. Because both sides are lowercased and
// the typo fixes are applied identically, LOWER(item_alias."normalizedRaw") equals
// normKey(order_items."itemName") for every mapped line — an exact join.
const normKey = (col: any) =>
  sql`regexp_replace(regexp_replace(regexp_replace(lower(btrim(${col})), '\\s+', ' ', 'g'), '\\msundays?\\M', 'sundae', 'g'), '\\mperi peri\\M', 'piri piri', 'g')`

// ── Deduped per-key cost lookup ──────────────────────────────────────────────
// item_alias stores the RAW POS spelling, so several near-duplicate rows (case /
// whitespace / typo variants like "2Pc Chicken MEAL" vs "2Pc Chicken Meal") collapse to
// the same normalized key. Joining order_items straight to item_alias matched one order
// line to MULTIPLE alias rows and multiplied every SUM(amount)/SUM(qty)/cost — inflating
// revenue, units and cost across Item Profitability, Category, Overview and Offer reports.
// Instead we join a derived table that resolves exactly ONE unit cost per normalized key
// (preferring reviewed + most-confident rows), making the cost join strictly 1:1.
//
// Per-row cost CASE, expressed with raw column refs (ia = item_alias, dci = dim_costing_item)
// so the identical logic can be reused inside both the Drizzle and raw-SQL lookups below.
const _unitCostCase = `COALESCE(CASE
    WHEN ia.size = '8'  THEN dci."cost8inch"
    WHEN ia.size = '12' THEN dci."cost12inch"
    WHEN ia.size = '16' THEN dci."cost16inch"
    WHEN ia.variant = 'solo' THEN dci."costSolo"
    WHEN ia.variant = 'meal' THEN dci."costMeal"
    ELSE dci."primaryCost"
  END, dci."primaryCost", 0)::numeric`

// Drizzle-joinable deduped lookup: one row per normalized key → (nk, unitCost).
// Built lazily per query so db access stays request-time (matches the lib/db lazy pattern).
function costLookup() {
  return db
    .select({
      nk: sql<string>`lower(${itemAlias.normalizedRaw})`.as("nk"),
      unitCost: sql<number>`(array_agg(
        COALESCE(CASE
          WHEN ${itemAlias.size} = '8'  THEN ${dimCostingItem.cost8inch}
          WHEN ${itemAlias.size} = '12' THEN ${dimCostingItem.cost12inch}
          WHEN ${itemAlias.size} = '16' THEN ${dimCostingItem.cost16inch}
          WHEN ${itemAlias.variant} = 'solo' THEN ${dimCostingItem.costSolo}
          WHEN ${itemAlias.variant} = 'meal' THEN ${dimCostingItem.costMeal}
          ELSE ${dimCostingItem.primaryCost}
        END, ${dimCostingItem.primaryCost}, 0)::numeric
        ORDER BY ${itemAlias.reviewed} DESC, ${itemAlias.confidence} DESC NULLS LAST, ${itemAlias.id}
      ))[1]`.as("unit_cost"),
    })
    .from(itemAlias)
    .innerJoin(dimCostingItem, eq(dimCostingItem.id, itemAlias.canonicalId))
    .groupBy(sql`lower(${itemAlias.normalizedRaw})`)
    .as("cost_lookup")
}

// Raw-SQL equivalent of the same deduped lookup, for the offer-analytics execute() queries.
const costLookupRaw = sql`(
  SELECT lower(ia."normalizedRaw") AS nk,
         (array_agg(${sql.raw(_unitCostCase)}
           ORDER BY ia.reviewed DESC, ia.confidence DESC NULLS LAST, ia.id))[1] AS unit_cost
  FROM item_alias ia
  JOIN dim_costing_item dci ON dci.id = ia."canonicalId"
  WHERE ia."canonicalId" IS NOT NULL
  GROUP BY lower(ia."normalizedRaw"))`

// Convert an instant to its UK-local calendar date (yyyy-MM-dd), honouring GMT/BST.
// en-CA formats as ISO-style yyyy-MM-dd.
const _ukDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
const ukDateStr = (d: Date) => _ukDateFmt.format(d)
import { revalidatePath } from "next/cache"

// ─── Google Sheets Sync ───────────────────────────────────────────────────
export async function syncGoogleSheets() {
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
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || "1mWyvmYnTz7Ewe2vzAkS_st1Ti9aLxPO-WW8IV8LCUP8"

    // Get all sheet tabs
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: spreadsheetId! })
    const sheetNames = spreadsheet.data.sheets?.map((s) => s.properties?.title).filter(Boolean) || []
    const menuSheet = sheetNames.find((n) =>
      n?.toLowerCase().includes("menu") || n?.toLowerCase().includes("price") || n?.toLowerCase().includes("costing")
    ) || sheetNames[0]

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${menuSheet}!A:AH`,
    })

    const rows: string[][] = (response.data.values || []) as string[][]
    if (rows.length < 2) return { success: false, error: `No data found in sheet: ${menuSheet}` }

    // Helper to parse a £ value from a cell, returns null if not a valid number
    const parsePrice = (val: string | undefined): string | null => {
      if (!val) return null
      const n = parseFloat(val.toString().replace(/[£$€,\s]/g, ""))
      return isNaN(n) || n <= 0 ? null : n.toString()
    }

    // Detect section type from a header row (the "Product No. / Name / Description / ..." row)
    // Header-driven column detection: read the section header row and record WHICH
    // column holds each cost. The sheet places cost columns at different positions per
    // section (single-cost sections sit in col C, pizzas span C–D, etc.) so fixed
    // indices miss most of them. Detecting by header text is robust.
    type ColMap = { cost8?: number; cost12?: number; costSolo?: number; costMeal?: number; primary?: number; hp?: number; ga?: number }
    type Section = { type: "pizza" | "solo_meal" | "simple"; cols: ColMap }
    const parseHeaderRow = (row: string[]): Section | null => {
      const cells = row.map((c) => (c ?? "").toString().toLowerCase().trim())
      const isHeader = cells.some((c) => c === "name" || c === "name " || c.includes("product"))
      if (!isHeader) return null
      const cols: ColMap = {}
      cells.forEach((c, idx) => {
        if (!c) return
        if (c.includes("8\"") || c.includes("8 pizza") || c.includes("8inch")) cols.cost8 ??= idx
        else if (c.includes("12\"") || c.includes("12 pizza") || c.includes("12inch")) cols.cost12 ??= idx
        else if (c === "solo cost") cols.costSolo ??= idx
        else if (c === "meal cost") cols.costMeal ??= idx
        else if (c.includes("hyde")) cols.hp ??= idx
        else if (c.includes("grand") || c.includes("arcade")) cols.ga ??= idx
        else if (c.includes("cost")) cols.primary ??= idx
      })
      let type: Section["type"]
      if (cols.cost8 !== undefined || cols.cost12 !== undefined) type = "pizza"
      else if (cols.costSolo !== undefined || cols.costMeal !== undefined) type = "solo_meal"
      else type = "simple"
      return { type, cols }
    }

    // Walk rows, detect sections, extract items
    const itemsToInsert: Array<{
      itemName: string
      costPrice: string | null
      sellingPriceHydePark: string | null
      sellingPriceGrandArcade: string | null
      category: string | null
      itemType: string | null
      lastSyncedAt: Date
    }> = []

    let currentCategory = "Uncategorised"
    let currentSection: Section | null = null

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.length === 0) continue

      const colA = row[0]?.toString().trim()
      const colB = row[1]?.toString().trim()

      // Detect category header row — col A is empty/category name, col B is empty or section title
      // These are rows like "Pizzas", "Wraps", "Garlic Breads" etc (single cell spanning header)
      if (colB === "" || colB === undefined) {
        if (colA && colA.length > 0 && colA !== "Product No." && isNaN(Number(colA)) && !colA.startsWith("£")) {
          currentCategory = colA
          currentSection = null
        }
        continue
      }

      // Detect the "Product No. / Name / ..." header row for this section
      if (colA?.toLowerCase().includes("product") || colA?.toLowerCase() === "product no.") {
        const s = parseHeaderRow(row)
        if (s) currentSection = s
        continue
      }

      // Skip rows where col A is not a number (sub-headers, blank separators, average rows)
      const rowNum = parseFloat(colA)
      if (isNaN(rowNum) && !colA?.startsWith("£")) continue

      // col B must be a real item name (not empty, not a number, not a £ value)
      if (!colB || colB.length === 0) continue
      const nameIsNumeric = !isNaN(Number(colB)) || colB.startsWith("£")
      if (nameIsNumeric) continue

      let costPrice: string | null = null
      let priceHP: string | null = null
      let priceGA: string | null = null

      const cols = currentSection?.cols ?? {}
      const at = (idx?: number) => (idx === undefined ? null : parsePrice(row[idx]))
      priceHP = at(cols.hp)
      priceGA = at(cols.ga)
      if (currentSection?.type === "pizza") {
        costPrice = at(cols.cost12) ?? at(cols.cost8) // prefer 12" cost
      } else if (currentSection?.type === "solo_meal") {
        costPrice = at(cols.costSolo) ?? at(cols.costMeal)
      } else {
        costPrice = at(cols.primary)
      }

      // Skip rows with no name
      if (!colB || colB === "-") continue

      itemsToInsert.push({
        itemName: colB,
        costPrice,
        sellingPriceHydePark: priceHP,
        sellingPriceGrandArcade: priceGA,
        category: currentCategory,
        itemType: currentSection?.type ?? null,
        lastSyncedAt: new Date(),
      })
    }

    // Clear existing items and re-insert
    await db.delete(menuItems)

    if (itemsToInsert.length > 0) {
      // Insert in batches of 100
      for (let i = 0; i < itemsToInsert.length; i += 100) {
        await db.insert(menuItems).values(itemsToInsert.slice(i, i + 100))
      }
    }

    await db.insert(syncLogs).values({
      source: "google_sheets",
      status: "success",
      recordsProcessed: itemsToInsert.length,
    })

    revalidatePath("/dashboard")
    revalidatePath("/dashboard/costing")
    return { success: true, count: itemsToInsert.length }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    await db.insert(syncLogs).values({ source: "google_sheets", status: "error", errorMessage: msg })
    return { success: false, error: msg }
  }
}

// ─── Presto Sync ──────────────────────────────────────────────────────────
async function prestoFetch(path: string) {
  const key = process.env.PRESTO_API_KEY || ""
  const secret = process.env.PRESTO_API_SECRET || ""
  const base = process.env.PRESTO_BASE_URL || "https://api.sales.prestoexpress.co.uk/v1"
  const token = Buffer.from(`${key}:${secret}`).toString("base64")
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Basic ${token}`, "Content-Type": "application/json" },
  })
  if (!res.ok) throw new Error(`Presto API error: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function syncPrestoData(dateStr: string, locationKey: "HYDE_PARK" | "GRAND_ARCADE") {
  const locationId = locationKey === "HYDE_PARK"
    ? process.env.PRESTO_LOCATION_ID_HYDE_PARK
    : process.env.PRESTO_LOCATION_ID_GRAND_ARCADE
  const locationName = locationKey === "HYDE_PARK" ? "Hyde Park" : "Grand Arcade"

  try {
    // Presto's `where=date:X` returns a trading SHIFT, not a calendar day. A shift for day X
    // runs from X's opening through close AFTER midnight — so its sales span UK-local dates X
    // *and* the early hours of X+1. Consequently, day D's own after-midnight orders (00:00–~05:00)
    // live in the *previous* day's (D-1) shift response, not in `date:D`. If we only ever query
    // `date:D`, those orders are dropped — which is exactly what happens to the first day of any
    // sync range (its D-1 shift was never fetched). To make a single-day sync self-complete we
    // pull BOTH the requested day's shift and the previous day's shift, then re-stamp every order
    // to its own UK-local calendar date. Upserts are keyed by orderId, so the overlap is idempotent.
    const prevDate = ukDateStr(new Date(new Date(`${dateStr}T12:00:00Z`).getTime() - 86_400_000))
    const [dataCur, dataPrev] = await Promise.all([
      prestoFetch(`/location/${locationId}/reports/shift/detailed?where=date:${dateStr}`),
      prestoFetch(`/location/${locationId}/reports/shift/detailed?where=date:${prevDate}`),
    ])
    // Presto response: { data: { shifts: [...], sales: [...], "pay-in-outs": [...] } }
    const extract = (d: any) => d?.data?.sales || d?.sales || (Array.isArray(d) ? d : [])
    // Merge both shifts, deduping by sale id (an order can surface in both responses).
    const salesById = new Map<string, any>()
    for (const s of [...extract(dataCur), ...extract(dataPrev)]) {
      const id = s?.id?.toString() || s?.orderId?.toString()
      if (id && !salesById.has(id)) salesById.set(id, s)
    }
    const sales = [...salesById.values()]

    // ── Build all rows in memory first, then batch-write (avoids N+1 round trips) ──
    type OrderRow = typeof orders.$inferInsert
    type ItemRow  = typeof orderItems.$inferInsert

    const orderRows: OrderRow[]  = []
    const itemRows:  ItemRow[]   = []

    for (const sale of Array.isArray(sales) ? sales : []) {
      const orderId = sale.id?.toString() || sale.orderId?.toString()
      if (!orderId) continue

      // sale.date is a full ISO datetime e.g. "2026-06-15T10:49:42.000+00:00"
      const orderTime = sale.date ? new Date(sale.date) : null
      const validTime = orderTime && !isNaN(orderTime.getTime()) ? orderTime : null
      // Stamp every row with the order's OWN calendar date in UK local time (Europe/London),
      // matching how Presto's report groups days. Presto's per-day query window overlaps
      // around midnight, so the same order can appear in two days' responses — using its own
      // UK-local date keeps orders & items aligned and dedupe consistent.
      const orderDate = validTime ? ukDateStr(validTime) : dateStr

      orderRows.push({
        orderId,
        location: locationName,
        date: orderDate,
        totalAmount: sale.totalAmount?.toString() || "0",
        platform: sale.platform || null,
        orderChannel: sale.orderChannel || null,
        mode: sale.mode || null,
        cancelled: sale.cancelled || false,
        discountValue: sale.discountValue?.toString() || "0",
        discountPercent: sale.discountPercent?.toString() || "0",
        paymentType: sale.payment?.[0]?.type || null,
        customerId: sale.customerId?.toString() || null,
        vatAmount: sale.vatAmount?.toString() || "0",
        orderTime: validTime,
      })

      const saleItems = sale.saleItems || sale.items || []
      for (const item of saleItems) {
        itemRows.push({
          orderId,
          location: locationName,
          date: orderDate,
          itemId: item.itemId?.toString() || null,
          itemName: item.itemName || "",
          itemType: item.itemType || null,
          categoryName: item.categoryName || null,
          groupName: item.groupName || null,
          qty: item.qty?.toString() || "0",
          unitPrice: item.unitPrice?.toString() || "0",
          amount: item.amount?.toString() || "0",
          discount: item.discount?.toString() || "0",
          vatAmount: item.vatAmount?.toString() || "0",
          vatPercent: item.vatPercent?.toString() || "0",
          modifierCost: item.modifierCost?.toString() || "0",
          mode: sale.mode || null,
          orderChannel: sale.orderChannel || null,
          cancelled: sale.cancelled || false,
        })
      }
    }

    // Batch upsert orders (one query regardless of row count).
    // Also correct `date` on conflict so a re-sync fixes any previously-wrong date.
    const CHUNK = 100
    for (let i = 0; i < orderRows.length; i += CHUNK) {
      await db
        .insert(orders)
        .values(orderRows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: orders.orderId,
          set: {
            date: sql`EXCLUDED.date`,
            totalAmount: sql`EXCLUDED."totalAmount"`,
            cancelled: sql`EXCLUDED.cancelled`,
            orderTime: sql`EXCLUDED."orderTime"`,
          },
        })
    }

    // Replace order items by ORDER ID (not requested date) so re-syncing an order
    // cleanly replaces its lines wherever they previously landed — avoids duplicates
    // when an order's stored date shifts to its true day.
    if (itemRows.length > 0) {
      const orderIdList = [...new Set(itemRows.map((r) => r.orderId))]
      for (let i = 0; i < orderIdList.length; i += 200) {
        await db
          .delete(orderItems)
          .where(and(inArray(orderItems.orderId, orderIdList.slice(i, i + 200)), eq(orderItems.location, locationName)))
      }
      for (let i = 0; i < itemRows.length; i += CHUNK) {
        await db.insert(orderItems).values(itemRows.slice(i, i + CHUNK))
      }
    }

    const orderCount = orderRows.length
    const itemCount  = itemRows.length

    await db.insert(syncLogs).values({
      source: "presto",
      location: locationName,
      status: "success",
      recordsProcessed: orderCount,
    })

    revalidatePath("/dashboard")
    return { success: true, orders: orderCount, items: itemCount }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    await db.insert(syncLogs).values({ source: "presto", location: locationName, status: "error", errorMessage: msg })
    return { success: false, error: msg }
  }
}

// ─── Shipday Sync ─────────────────────────────────────────────────────────
export async function syncShipdayData(startDate: string, endDate: string) {
  try {
    const allOrders: Record<string, unknown>[] = []
    const MAX_PAGES = 400 // per window: up to 10 000 orders

    // Shipday's /orders/query silently caps each request to roughly the most recent
    // month, so asking for a wide range (e.g. 2 months) only returns the latest ~30
    // days. To get full history we split [startDate, endDate] into short windows and
    // query each one separately, then combine. 14-day windows stay safely under the
    // cap while keeping the number of (rate-limited) requests reasonable.
    const WINDOW_DAYS = 14
    const addDays = (isoDate: string, days: number) => {
      const d = new Date(`${isoDate}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString().slice(0, 10) // yyyy-MM-dd
    }

    // Shipday rate limit is 5 requests / minute → minimum 12 s between request STARTS.
    // We keep a slightly larger margin than the theoretical 12 s so timing jitter (or
    // another caller briefly sharing the account limit) can't push us over 5/min.
    // We pace against the start of the previous request (not after processing) so the
    // JSON-parse + array work overlaps the wait window instead of being added on top.
    const MIN_GAP_MS = 13_500
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let lastRequestStart = 0

    // Fetch one page of one window, transparently retrying if Shipday still throttles
    // us. On a rate-limit response we back off ~60 s (a full window) and try the SAME
    // page again rather than aborting the whole sync — that is what previously left the
    // data incomplete: a single 400 killed pagination partway through.
    const MAX_RATE_RETRIES = 4
    async function fetchPage(startTime: string, endTime: string, startCursor: number, endCursor: number) {
      for (let attempt = 0; ; attempt++) {
        const sinceLast = Date.now() - lastRequestStart
        if (lastRequestStart > 0 && sinceLast < MIN_GAP_MS) {
          await sleep(MIN_GAP_MS - sinceLast)
        }
        lastRequestStart = Date.now()

        const res = await fetch("https://api.shipday.com/orders/query", {
          method: "POST",
          headers: {
            Authorization: `Basic ${process.env.SHIPDAY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderStatus: "ALREADY_DELIVERED",
            startTime,
            endTime,
            startCursor,
            endCursor,
          }),
        })

        if (res.ok) return await res.json()

        const body = await res.text()
        const throttled = res.status === 429 || /rate limit/i.test(body)
        if (throttled && attempt < MAX_RATE_RETRIES) {
          await sleep(60_000) // wait out a full rate-limit window, then retry same page
          continue
        }
        throw new Error(`Shipday API error: ${res.status} ${body}`)
      }
    }

    // Walk the requested range window-by-window (oldest → newest), paginating each.
    for (let winStart = startDate; winStart <= endDate; winStart = addDays(winStart, WINDOW_DAYS)) {
      let winEnd = addDays(winStart, WINDOW_DAYS - 1)
      if (winEnd > endDate) winEnd = endDate
      const startTime = `${winStart}T00:00:00Z`
      const endTime   = `${winEnd}T23:59:59Z`

      let page = 1
      while (page <= MAX_PAGES) {
        const startCursor = (page - 1) * 25 + 1
        const endCursor   = startCursor + 24

        const data = await fetchPage(startTime, endTime, startCursor, endCursor)

        const pageOrders: Record<string, unknown>[] = Array.isArray(data) ? data : []
        if (pageOrders.length === 0) break

        allOrders.push(...pageOrders)
        page++

        // Fewer than 25 results means last page of this window — stop without burning another wait
        if (pageOrders.length < 25) break
      }
    }

    type DeliveryRow = typeof deliveries.$inferInsert
    const ts = (v: unknown) => (v ? new Date(v as string) : null)
    const num = (v: unknown) => (v != null ? v.toString() : null)

    const rows: DeliveryRow[] = allOrders.map((o) => {
      const pickup   = (o.pickup   ?? {}) as Record<string, unknown>
      const delivery = (o.delivery ?? {}) as Record<string, unknown>
      const carrier  = (o.carrier  ?? {}) as Record<string, unknown>
      return {
        shipdayOrderId:       ((o.orderId ?? o.id) as string | number | undefined)?.toString() ?? "",
        orderNumber:          o.orderNumber?.toString() || null,
        placementTime:        ts(o.placementTime),
        requestedPickupTime:  ts(o.requestedPickupTime),
        requestedDeliveryTime: ts(o.requestedDeliveryTime),
        assignedTime:         ts(o.assignedTime),
        startTime:            ts(o.startTime),
        pickedupTime:         ts(o.pickedupTime),
        arrivedTime:          ts(o.arrivedTime),
        deliveryTime:         ts(o.deliveryTime),
        failedDeliveryTime:   ts(o.failedDeliveryTime),
        status:               (o.status as string) || null,
        accepted:             (o.accepted as boolean) || false,
        driverId:             carrier.id?.toString() || null,
        driverName:           (carrier.name as string) || null,
        orderTotal:           num(o.orderTotal),
        deliveryFee:          num(o.deliveryFee),
        driverPayment:        num(o.driverPayment),
        tip:                  num(o.tip) ?? "0",
        discount:             num(o.discount) ?? "0",
        tax:                  num(o.tax) ?? "0",
        distance:             num(o.distance),
        paymentMethod:        (o.paymentMethod as string) || null,
        orderSource:          (o.orderSource as string) || null,
        pickupName:           (pickup.name as string) || null,
        pickupAddress:        (pickup.formattedAddress ?? pickup.address) as string || null,
        pickupLat:            pickup.lat != null ? pickup.lat.toString() : null,
        pickupLng:            pickup.lng != null ? pickup.lng.toString() : null,
        deliveryName:         (delivery.name as string) || null,
        deliveryAddress:      (delivery.formattedAddress ?? delivery.address) as string || null,
        deliveryLat:          delivery.lat != null ? delivery.lat.toString() : null,
        deliveryLng:          delivery.lng != null ? delivery.lng.toString() : null,
        incomplete:           (o.incomplete as boolean) || false,
      }
    })

    const CHUNK = 100
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(deliveries).values(rows.slice(i, i + CHUNK)).onConflictDoNothing()
    }

    await db.insert(syncLogs).values({ source: "shipday", status: "success", recordsProcessed: rows.length })
    revalidatePath("/dashboard")
    return { success: true, count: rows.length }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    await db.insert(syncLogs).values({ source: "shipday", status: "error", errorMessage: msg })
    return { success: false, error: msg }
  }
}

// ─── Backfill orderTime from date column for pre-fix rows ────────────────
// Sets orderTime to midnight UTC of the order date for any row where it is NULL.
// This is a one-shot utility run from the sync page.
export async function backfillOrderTime() {
  try {
    const result = await db.execute(sql`
      UPDATE orders
      SET "orderTime" = (date::date)::timestamptz
      WHERE "orderTime" IS NULL
        AND date IS NOT NULL
    `)
    const count = (result as any).rowCount ?? 0
    return { success: true, updated: count }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

// ─── Clear Sync Data ──────────────────────────────────────────────────────
export async function clearSyncData(scope: "orders" | "deliveries" | "all") {
  try {
    if (scope === "orders" || scope === "all") {
      await db.delete(orderItems)
      await db.delete(orders)
    }
    if (scope === "deliveries" || scope === "all") {
      await db.delete(deliveries)
    }
    if (scope === "all") {
      // Also clear item_alias so normalisation runs fresh (keeps dim_costing_item intact)
      await db.delete(itemAlias)
    }
    await db.insert(syncLogs).values({
      source: "clear",
      status: "success",
      recordsProcessed: 0,
      errorMessage: `Cleared: ${scope}`,
    })
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    return { success: false, error: msg }
  }
}

// ─── Dashboard Data Fetchers ──────────────────────────────────────────────
export async function getOverviewKPIs(startDate: string, endDate: string, location?: string, channel?: string) {
  const orderDateFilter = [
    sql`${orders.date}::date >= ${startDate}::date`,
    sql`${orders.date}::date <= ${endDate}::date`,
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") orderDateFilter.push(eq(orders.location, location) as any)
  const ordCh = channelCondition(orders.orderChannel, channel)
  if (ordCh) orderDateFilter.push(ordCh as any)

  const itemConditions: any[] = [
    sql`${orderItems.date}::date >= ${startDate}::date`,
    sql`${orderItems.date}::date <= ${endDate}::date`,
    eq(orderItems.cancelled, false),
    sql`${orderItems.amount}::numeric > 0`,
  ]
  if (location && location !== "all") itemConditions.push(eq(orderItems.location, location))
  const itemCh = channelCondition(orderItems.orderChannel, channel)
  if (itemCh) itemConditions.push(itemCh)

  // Run both aggregates in parallel — independent queries, no reason to await serially
  const cl = costLookup()
  const [result, itemResult] = await Promise.all([
    db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
        totalOrders: sql<number>`COUNT(*)`,
        avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
        totalDiscount: sql<number>`COALESCE(SUM(${orders.discountValue}::numeric), 0)`,
      })
      .from(orders)
      .where(and(...orderDateFilter)),
    db
      .select({
        totalItemsSold: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric), 0)`,
        totalCost: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric * COALESCE(${cl.unitCost}, 0)), 0)`,
      })
      .from(orderItems)
      .leftJoin(cl, sql`${cl.nk} = ${normKey(orderItems.itemName)}`)
      .where(and(...itemConditions)),
  ])

  return { ...result[0], ...itemResult[0] }
}

export async function getItemProfitability(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [
    dateGte(orderItems.date, startDate),
    dateLte(orderItems.date, endDate),
    eq(orderItems.cancelled, false),
    // Exclude £0-revenue lines (modifiers, size/flavour selectors, free items) — no cost
    // data and no analytical value. Applies across every page that reads this action.
    sql`${orderItems.amount}::numeric > 0`,
  ]
  if (location && location !== "all") conditions.push(eq(orderItems.location, location))
  { const cc = channelCondition(orderItems.orderChannel, channel); if (cc) conditions.push(cc) }

  const cl = costLookup()
  const unit = sql`COALESCE(${cl.unitCost}, 0)` // deduped per-unit cost, 0 when unmatched
  return db
    .select({
      itemName: orderItems.itemName,
      categoryName: sql<string>`COALESCE(${orderItems.categoryName}, ${menuItems.category}, 'Uncategorised')`,
      itemType: sql<string>`COALESCE(${orderItems.itemType}, ${menuItems.itemType}, 'Unknown')`,
      orderFrequency: sql<number>`COUNT(DISTINCT ${orderItems.orderId})`,
      totalQty: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric), 0)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric), 0)`,
      avgUnitPrice: sql<number>`COALESCE(AVG(${orderItems.unitPrice}::numeric), 0)`,
      costPrice: sql<number>`COALESCE(MAX(${unit}), 0)`,
      totalCost: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric * ${unit}), 0)`,
      grossProfit: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * ${unit}), 0)`,
      marginPercent: sql<number>`CASE WHEN SUM(${orderItems.amount}::numeric) > 0 THEN ROUND((SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * ${unit})) / SUM(${orderItems.amount}::numeric) * 100, 2) ELSE 0 END`,
      totalDiscount: sql<number>`COALESCE(SUM(${orderItems.discount}::numeric), 0)`,
    })
    .from(orderItems)
    .leftJoin(menuItems, sql`LOWER(TRIM(${orderItems.itemName})) = LOWER(TRIM(${menuItems.itemName}))`)
    .leftJoin(cl, sql`${cl.nk} = ${normKey(orderItems.itemName)}`)
    .where(and(...conditions))
    .groupBy(orderItems.itemName, orderItems.categoryName, orderItems.itemType, menuItems.category, menuItems.itemType)
    .orderBy(desc(sql`SUM(${orderItems.amount}::numeric)`))
}

export async function getCategoryPerformance(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [
    dateGte(orderItems.date, startDate),
    dateLte(orderItems.date, endDate),
    eq(orderItems.cancelled, false),
    sql`${orderItems.amount}::numeric > 0`,
  ]
  if (location && location !== "all") conditions.push(eq(orderItems.location, location))
  { const cc = channelCondition(orderItems.orderChannel, channel); if (cc) conditions.push(cc) }

  const cl = costLookup()
  const unit = sql`COALESCE(${cl.unitCost}, 0)` // deduped per-unit cost, 0 when unmatched
  return db
    .select({
      category: sql<string>`COALESCE(${orderItems.categoryName}, ${menuItems.category}, 'Uncategorised')`,
      totalQty: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric), 0)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric), 0)`,
      totalCost: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric * ${unit}), 0)`,
      grossProfit: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * ${unit}), 0)`,
      marginPercent: sql<number>`CASE WHEN SUM(${orderItems.amount}::numeric) > 0 THEN ROUND((SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * ${unit})) / SUM(${orderItems.amount}::numeric) * 100, 2) ELSE 0 END`,
    })
    .from(orderItems)
    .leftJoin(menuItems, sql`LOWER(TRIM(${orderItems.itemName})) = LOWER(TRIM(${menuItems.itemName}))`)
    .leftJoin(cl, sql`${cl.nk} = ${normKey(orderItems.itemName)}`)
    .where(and(...conditions))
    .groupBy(sql`COALESCE(${orderItems.categoryName}, ${menuItems.category}, 'Uncategorised')`)
    .orderBy(desc(sql`SUM(${orderItems.amount}::numeric)`))
}

// Top items per platform (order channel) — for the per-platform sales bar charts.
export async function getTopItemsByPlatform(startDate: string, endDate: string, location?: string, perPlatform = 8, channel?: string) {
  const locSql = location && location !== "all" ? sql` AND oi.location = ${location}` : sql``
  const chCond = channelCondition(sql`oi."orderChannel"`, channel)
  const chSql = chCond ? sql` AND ${chCond}` : sql``
  const raw = await db.execute<{ platform: string; itemName: string; revenue: string; qty: string }>(sql`
    SELECT platform, "itemName", revenue, qty FROM (
      SELECT COALESCE(oi."orderChannel", oi.mode, 'Unknown') AS platform,
             oi."itemName" AS "itemName",
             SUM(oi.amount::numeric) AS revenue,
             SUM(oi.qty::numeric)    AS qty,
             ROW_NUMBER() OVER (PARTITION BY COALESCE(oi."orderChannel", oi.mode, 'Unknown') ORDER BY SUM(oi.amount::numeric) DESC) AS rn
      FROM order_items oi
      WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date
        AND oi.cancelled = false AND oi.amount::numeric > 0
        ${locSql}${chSql}
      GROUP BY COALESCE(oi."orderChannel", oi.mode, 'Unknown'), oi."itemName"
    ) z
    WHERE rn <= ${perPlatform}
    ORDER BY platform, revenue DESC
  `)
  const rows = (raw as any).rows ?? raw
  const grouped: Record<string, { itemName: string; revenue: number; qty: number }[]> = {}
  for (const r of rows as any[]) {
    ;(grouped[r.platform] ||= []).push({ itemName: r.itemName, revenue: Number(r.revenue), qty: Number(r.qty) })
  }
  // platforms ordered by total revenue desc
  return Object.entries(grouped)
    .map(([platform, items]) => ({ platform, items, total: items.reduce((s, i) => s + i.revenue, 0) }))
    .sort((a, b) => b.total - a.total)
}

export async function getPlatformPerformance(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [dateGte(orders.date, startDate), dateLte(orders.date, endDate), eq(orders.cancelled, false)]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  return db
    .select({
      platform: sql<string>`COALESCE(${orders.orderChannel}, ${orders.platform}, 'Unknown')`,
      mode: orders.mode,
      totalOrders: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      totalDiscount: sql<number>`COALESCE(SUM(${orders.discountValue}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(sql`COALESCE(${orders.orderChannel}, ${orders.platform}, 'Unknown')`, orders.mode)
    .orderBy(desc(sql`SUM(${orders.totalAmount}::numeric)`))
}

export async function getHourlyDemand(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [dateGte(orders.date, startDate), dateLte(orders.date, endDate), eq(orders.cancelled, false)]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  return db
    .select({
      date: orders.date,
      totalOrders: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.date)
    .orderBy(orders.date)
}

export async function getDeliveryPerformance(startDate: string, endDate: string) {
  const where = and(
    gte(deliveries.placementTime, new Date(startDate)),
    lte(deliveries.placementTime, new Date(endDate + "T23:59:59")),
  )

  const byDriver = await db
    .select({
      driverName: sql<string>`COALESCE(${deliveries.driverName}, 'Unassigned')`,
      totalDeliveries: sql<number>`COUNT(*)`,
      onTimeCount: sql<number>`COUNT(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL AND ${deliveries.requestedDeliveryTime} IS NOT NULL AND ${deliveries.deliveryTime} <= ${deliveries.requestedDeliveryTime} THEN 1 END)`,
      lateCount: sql<number>`COUNT(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL AND ${deliveries.requestedDeliveryTime} IS NOT NULL AND ${deliveries.deliveryTime} > ${deliveries.requestedDeliveryTime} THEN 1 END)`,
      avgDeliveryMinutes: sql<number>`ROUND(AVG(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL THEN EXTRACT(EPOCH FROM (${deliveries.deliveryTime} - ${deliveries.placementTime})) / 60 END), 1)`,
      avgDispatchMinutes: sql<number>`ROUND(AVG(CASE WHEN ${deliveries.assignedTime} IS NOT NULL THEN EXTRACT(EPOCH FROM (${deliveries.assignedTime} - ${deliveries.placementTime})) / 60 END), 1)`,
      avgLatenessMinutes: sql<number>`ROUND(AVG(CASE WHEN ${deliveries.deliveryTime} > ${deliveries.requestedDeliveryTime} THEN EXTRACT(EPOCH FROM (${deliveries.deliveryTime} - ${deliveries.requestedDeliveryTime})) / 60 END), 1)`,
      totalRevenue: sql<number>`COALESCE(SUM(${deliveries.orderTotal}::numeric), 0)`,
      totalDriverCost: sql<number>`COALESCE(SUM(${deliveries.driverPayment}::numeric), 0)`,
      totalDistance: sql<number>`COALESCE(SUM(${deliveries.distance}::numeric), 0)`,
      avgDistance: sql<number>`ROUND(AVG(${deliveries.distance}::numeric), 2)`,
    })
    .from(deliveries)
    .where(where)
    .groupBy(sql`COALESCE(${deliveries.driverName}, 'Unassigned')`)
    .orderBy(desc(sql`COUNT(*)`))

  return byDriver
}

// Area / distance / bottleneck analytics — pulls raw Shipday rows and aggregates in JS
// (postcode-district extraction is far cleaner here than in SQL).
export async function getDeliveryAreaAnalytics(startDate: string, endDate: string) {
  const rows = await db
    .select({
      orderId: deliveries.shipdayOrderId,
      placementTime: deliveries.placementTime,
      assignedTime: deliveries.assignedTime,
      pickedupTime: deliveries.pickedupTime,
      deliveryTime: deliveries.deliveryTime,
      orderTotal: deliveries.orderTotal,
      driverPayment: deliveries.driverPayment,
      distance: deliveries.distance,
      driverName: deliveries.driverName,
      address: deliveries.deliveryAddress,
    })
    .from(deliveries)
    .where(and(
      gte(deliveries.placementTime, new Date(startDate)),
      lte(deliveries.placementTime, new Date(endDate + "T23:59:59")),
    ))

  const n = (v: unknown) => Number(v ?? 0)
  const mins = (a: Date | null, b: Date | null) =>
    a && b ? (new Date(a).getTime() - new Date(b).getTime()) / 60000 : null

  // UK outward code (district): e.g. "LS6 1AB" -> "LS6"
  const districtOf = (addr: string | null): string => {
    if (!addr) return "Unknown"
    const m = addr.toUpperCase().match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}\b/)
    return m ? m[1] : "Unknown"
  }

  type Agg = { area: string; orders: number; revenue: number; driverCost: number; delivMins: number[]; assignMins: number[]; pickupMins: number[]; roadMins: number[] }
  const areas = new Map<string, Agg>()
  const bands = new Map<string, { band: string; orders: number; revenue: number; driverCost: number; order: number }>()
  const bandDefs: [string, number, (d: number) => boolean][] = [
    ["0-1 km", 0, (d) => d < 1],
    ["1-2 km", 1, (d) => d >= 1 && d < 2],
    ["2-3 km", 2, (d) => d >= 2 && d < 3],
    ["3-4 km", 3, (d) => d >= 3 && d < 4],
    ["4+ km", 4, (d) => d >= 4],
  ]

  for (const r of rows) {
    const area = districtOf(r.address)
    if (!areas.has(area)) areas.set(area, { area, orders: 0, revenue: 0, driverCost: 0, delivMins: [], assignMins: [], pickupMins: [], roadMins: [] })
    const a = areas.get(area)!
    a.orders++
    a.revenue += n(r.orderTotal)
    a.driverCost += n(r.driverPayment)
    const dm = mins(r.deliveryTime, r.placementTime); if (dm != null && dm >= 0) a.delivMins.push(dm)
    const am = mins(r.assignedTime, r.placementTime); if (am != null && am >= 0) a.assignMins.push(am)
    const pm = mins(r.pickedupTime, r.assignedTime); if (pm != null && pm >= 0) a.pickupMins.push(pm)
    const rd = mins(r.deliveryTime, r.pickedupTime); if (rd != null && rd >= 0) a.roadMins.push(rd)

    // distance band
    const dist = n(r.distance)
    const def = bandDefs.find(([, , test]) => test(dist)) ?? bandDefs[bandDefs.length - 1]
    const key = def[0]
    if (!bands.has(key)) bands.set(key, { band: key, orders: 0, revenue: 0, driverCost: 0, order: def[1] })
    const b = bands.get(key)!
    b.orders++; b.revenue += n(r.orderTotal); b.driverCost += n(r.driverPayment)
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0

  const byArea = [...areas.values()].map((a) => ({
    area: a.area,
    orders: a.orders,
    revenue: +a.revenue.toFixed(2),
    aov: a.orders ? +(a.revenue / a.orders).toFixed(2) : 0,
    driverCost: +a.driverCost.toFixed(2),
    contribution: +(a.revenue - a.driverCost).toFixed(2),
    avgDeliveryMin: +avg(a.delivMins).toFixed(1),
    assignMin: +avg(a.assignMins).toFixed(1),
    pickupMin: +avg(a.pickupMins).toFixed(1),
    roadMin: +avg(a.roadMins).toFixed(1),
  })).sort((x, y) => y.revenue - x.revenue)

  const distanceBands = bandDefs.map(([label, order]) => {
    const b = bands.get(label)
    return { band: label, orders: b?.orders ?? 0, revenue: +(b?.revenue ?? 0).toFixed(2), driverCost: +(b?.driverCost ?? 0).toFixed(2), order }
  })

  // bottleneck: overall + top areas by orders
  const bottleneckOverall = {
    assignMin: +avg(byArea.flatMap((a) => Array(a.orders).fill(a.assignMin))).toFixed(1),
    pickupMin: +avg(byArea.flatMap((a) => Array(a.orders).fill(a.pickupMin))).toFixed(1),
    roadMin: +avg(byArea.flatMap((a) => Array(a.orders).fill(a.roadMin))).toFixed(1),
  }
  const bottleneckByArea = [...byArea].sort((a, b) => b.orders - a.orders).slice(0, 8)
    .map((a) => ({ area: a.area, assignMin: a.assignMin, pickupMin: a.pickupMin, roadMin: a.roadMin }))

  // zone ranking: normalise each metric 0..1 across areas, weight, score 0..100
  const known = byArea.filter((a) => a.area !== "Unknown" && a.orders > 0)
  const maxRev = Math.max(1, ...known.map((a) => a.revenue))
  const maxOrd = Math.max(1, ...known.map((a) => a.orders))
  const delivVals = known.map((a) => a.avgDeliveryMin).filter((v) => v > 0)
  const minDeliv = Math.min(...(delivVals.length ? delivVals : [0]))
  const maxDeliv = Math.max(1, ...known.map((a) => a.avgDeliveryMin))
  const maxCost = Math.max(1, ...known.map((a) => a.driverCost))

  const zoneRanking = known.map((a) => {
    const revScore = a.revenue / maxRev
    const ordScore = a.orders / maxOrd
    // lower delivery time is better → invert
    const timeScore = maxDeliv > minDeliv ? 1 - (a.avgDeliveryMin - minDeliv) / (maxDeliv - minDeliv) : 1
    // lower driver cost is better → invert
    const costScore = 1 - a.driverCost / maxCost
    const score = +((revScore * 0.4 + ordScore * 0.3 + timeScore * 0.2 + costScore * 0.1) * 100).toFixed(0)
    const recommendation = score >= 66 ? "Grow" : score >= 33 ? "Maintain" : "Review Radius"
    return { area: a.area, orders: a.orders, revenue: a.revenue, avgDeliveryMin: a.avgDeliveryMin, driverCost: a.driverCost, score, recommendation }
  }).sort((a, b) => b.score - a.score)

  return { byArea, distanceBands, bottleneckOverall, bottleneckByArea, zoneRanking, totalRows: rows.length }
}

export async function getDeliveryKPIs(startDate: string, endDate: string) {
  const where = and(
    gte(deliveries.placementTime, new Date(startDate)),
    lte(deliveries.placementTime, new Date(endDate + "T23:59:59")),
  )

  const [overallRows, dailyTrend] = await Promise.all([
    db
      .select({
        totalDeliveries: sql<number>`COUNT(*)`,
        onTimeCount: sql<number>`COUNT(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL AND ${deliveries.requestedDeliveryTime} IS NOT NULL AND ${deliveries.deliveryTime} <= ${deliveries.requestedDeliveryTime} THEN 1 END)`,
        avgDeliveryMinutes: sql<number>`ROUND(AVG(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL THEN EXTRACT(EPOCH FROM (${deliveries.deliveryTime} - ${deliveries.placementTime})) / 60 END), 1)`,
        avgDispatchMinutes: sql<number>`ROUND(AVG(CASE WHEN ${deliveries.assignedTime} IS NOT NULL THEN EXTRACT(EPOCH FROM (${deliveries.assignedTime} - ${deliveries.placementTime})) / 60 END), 1)`,
        totalRevenue: sql<number>`COALESCE(SUM(${deliveries.orderTotal}::numeric), 0)`,
        totalDriverCost: sql<number>`COALESCE(SUM(${deliveries.driverPayment}::numeric), 0)`,
        totalDeliveryFee: sql<number>`COALESCE(SUM(${deliveries.deliveryFee}::numeric), 0)`,
        totalDistance: sql<number>`ROUND(COALESCE(SUM(${deliveries.distance}::numeric), 0), 1)`,
        avgDistance: sql<number>`ROUND(AVG(${deliveries.distance}::numeric), 2)`,
      })
      .from(deliveries)
      .where(where),
    db
      .select({
        date: sql<string>`DATE(${deliveries.placementTime})`,
        totalDeliveries: sql<number>`COUNT(*)`,
        onTimeCount: sql<number>`COUNT(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL AND ${deliveries.requestedDeliveryTime} IS NOT NULL AND ${deliveries.deliveryTime} <= ${deliveries.requestedDeliveryTime} THEN 1 END)`,
        avgDeliveryMinutes: sql<number>`ROUND(AVG(CASE WHEN ${deliveries.deliveryTime} IS NOT NULL THEN EXTRACT(EPOCH FROM (${deliveries.deliveryTime} - ${deliveries.placementTime})) / 60 END), 1)`,
        totalRevenue: sql<number>`COALESCE(SUM(${deliveries.orderTotal}::numeric), 0)`,
        totalDriverCost: sql<number>`COALESCE(SUM(${deliveries.driverPayment}::numeric), 0)`,
        totalDistance: sql<number>`ROUND(COALESCE(SUM(${deliveries.distance}::numeric), 0), 1)`,
      })
      .from(deliveries)
      .where(where)
      .groupBy(sql`DATE(${deliveries.placementTime})`)
      .orderBy(sql`DATE(${deliveries.placementTime})`),
  ])

  return { overall: overallRows[0] ?? null, dailyTrend }
}

export async function getSyncLogs() {
  return db.select().from(syncLogs).orderBy(desc(syncLogs.syncedAt)).limit(20)
}

export async function getMenuItems() {
  return db.select().from(menuItems).orderBy(menuItems.itemName)
}

export async function getOfferAnalysis(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [
    dateGte(orders.date, startDate),
    dateLte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  const discountedOrders = await db
    .select({
      date: orders.date,
      location: orders.location,
      orderChannel: sql<string>`COALESCE(${orders.orderChannel}, ${orders.platform}, 'Unknown')`,
      totalOrders: sql<number>`COUNT(*)`,
      discountedOrders: sql<number>`COUNT(CASE WHEN ${orders.discountValue}::numeric > 0 THEN 1 END)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      totalDiscount: sql<number>`COALESCE(SUM(${orders.discountValue}::numeric), 0)`,
      avgDiscount: sql<number>`COALESCE(AVG(CASE WHEN ${orders.discountValue}::numeric > 0 THEN ${orders.discountValue}::numeric END), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.date, orders.location, sql`COALESCE(${orders.orderChannel}, ${orders.platform}, 'Unknown')`)
    .orderBy(orders.date)

  return discountedOrders
}

export async function getCustomerInsights(startDate: string, endDate: string, location?: string) {
  const conditions: any[] = [
    dateGte(orders.date, startDate),
    dateLte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

  // Only the own-website (Wix) channel carries a real, reusable customer account id. Delivery
  // platforms (Uber Eats/Deliveroo/Just Eat) attach an anonymous per-order reference, so they
  // can't be tracked as customers — we exclude them and report coverage so the numbers are honest.
  const isWeb = sql`(LOWER(${orders.orderChannel}) = 'wix' OR LOWER(${orders.platform}) = 'wix')`

  const [covRow] = await db
    .select({
      totalOrders: sql<number>`COUNT(*)`,
      webOrders: sql<number>`COUNT(*) FILTER (WHERE ${isWeb})`,
      identifiedOrders: sql<number>`COUNT(*) FILTER (WHERE ${isWeb} AND ${orders.customerId} IS NOT NULL)`,
    })
    .from(orders)
    .where(and(...conditions))

  const customerData = await db
    .select({
      customerId: orders.customerId,
      orderCount: sql<number>`COUNT(*)`,
      totalSpend: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      firstOrder: sql<string>`MIN(${orders.date})`,
      lastOrder: sql<string>`MAX(${orders.date})`,
      platform: sql<string>`COALESCE(MAX(${orders.orderChannel}), MAX(${orders.platform}), 'Web')`,
    })
    .from(orders)
    .where(and(...conditions, isWeb, sql`${orders.customerId} IS NOT NULL`))
    .groupBy(orders.customerId)
    .orderBy(desc(sql`SUM(${orders.totalAmount}::numeric)`))

  // Segment identified web customers by frequency (delivery orders excluded, so counts are real)
  const identified = customerData.length
  const newCustomers = customerData.filter((c) => Number(c.orderCount) === 1).length
  const returning = customerData.filter((c) => Number(c.orderCount) >= 2).length
  const regular = customerData.filter((c) => Number(c.orderCount) >= 3).length
  const totalRevenue = customerData.reduce((s, c) => s + Number(c.totalSpend), 0)
  const returningRevenue = customerData.filter((c) => Number(c.orderCount) >= 2).reduce((s, c) => s + Number(c.totalSpend), 0)

  const totalOrders = Number(covRow?.totalOrders ?? 0)
  const identifiedOrders = Number(covRow?.identifiedOrders ?? 0)

  return {
    customers: customerData.slice(0, 50),
    coverage: {
      totalOrders,
      webOrders: Number(covRow?.webOrders ?? 0),
      identifiedOrders,
      identifiedPct: totalOrders > 0 ? (identifiedOrders / totalOrders) * 100 : 0,
    },
    summary: {
      identifiedCustomers: identified,
      newCustomers,
      returning,
      regular,
      repeatRatePct: identified > 0 ? (returning / identified) * 100 : 0,
      totalRevenue,
      returningRevenue,
      avgOrdersPerCustomer: identified > 0
        ? customerData.reduce((s, c) => s + Number(c.orderCount), 0) / identified
        : 0,
      avgSpendPerCustomer: identified > 0 ? totalRevenue / identified : 0,
    },
  }
}

// What each identified-web-customer segment (New=1 / Returning=2 / Regular=3+ orders) actually
// buys — top real products per segment (modifiers & meal upgrades excluded), so you can see how
// purchasing differs by loyalty. Segment is assigned per customer by their order count in range.
export async function getWebCustomerItemsBySegment(startDate: string, endDate: string, location?: string) {
  const locO = location && location !== "all" ? sql` AND o.location = ${location}` : sql``
  const grp = sql.raw(basketGroup(`oi."categoryName"`, `oi."itemName"`))
  const meal = sql.raw(mealBundleSql(`oi."itemName"`))

  const res = await db.execute<{ segment: string; item: string; qty: string; revenue: string; orders: string }>(sql`
    WITH cust AS (
      SELECT o."customerId" AS cid, COUNT(*) AS n
      FROM orders o
      WHERE o.date::date >= ${startDate}::date AND o.date::date <= ${endDate}::date
        AND o.cancelled = false AND o."customerId" IS NOT NULL
        AND (LOWER(o."orderChannel") = 'wix' OR LOWER(o."platform") = 'wix')
        ${locO}
      GROUP BY o."customerId"
    ),
    seg AS (
      SELECT cid, CASE WHEN n >= 3 THEN 'Regular' WHEN n = 2 THEN 'Returning' ELSE 'New' END AS segment
      FROM cust
    ),
    lines AS (
      SELECT s.segment,
             TRIM(oi."itemName")          AS item,
             SUM(oi.qty::numeric)         AS qty,
             SUM(oi.amount::numeric)      AS revenue,
             COUNT(DISTINCT oi."orderId") AS orders
      FROM order_items oi
      JOIN orders o ON o."orderId" = oi."orderId"
      JOIN seg s ON s.cid = o."customerId"
      WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date
        AND oi.cancelled = false AND oi.amount::numeric > 0
        AND (${grp}) <> 'Modifier' AND NOT ${meal}
        ${locO}
      GROUP BY s.segment, TRIM(oi."itemName")
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY segment ORDER BY qty DESC) AS rn FROM lines
    )
    SELECT segment, item, qty, revenue, orders FROM ranked WHERE rn <= 8 ORDER BY segment, qty DESC
  `)

  const rows: any[] = (res as any).rows ?? res
  const bySeg = (name: string) =>
    rows.filter((r) => r.segment === name).map((r) => ({
      item: r.item as string, qty: Number(r.qty), revenue: Number(r.revenue), orders: Number(r.orders),
    }))
  return { newCustomers: bySeg("New"), returning: bySeg("Returning"), regular: bySeg("Regular") }
}

export async function getHourlyDemandHeatmap(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [
    dateGte(orders.date, startDate),
    dateLte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  // Daily totals + day-of-week breakdown are independent — run them together
  const [daily, dowBreakdown] = await Promise.all([
    db
      .select({
        date: orders.date,
        location: orders.location,
        totalOrders: sql<number>`COUNT(*)`,
        totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
        avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
        mode: orders.mode,
      })
      .from(orders)
      .where(and(...conditions))
      .groupBy(orders.date, orders.location, orders.mode)
      .orderBy(orders.date),
    db
      .select({
        dayOfWeek: sql<number>`EXTRACT(DOW FROM ${orders.date}::date)`,
        totalOrders: sql<number>`COUNT(*)`,
        totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
        avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      })
      .from(orders)
      .where(and(...conditions))
      .groupBy(sql`EXTRACT(DOW FROM ${orders.date}::date)`)
      .orderBy(sql`EXTRACT(DOW FROM ${orders.date}::date)`),
  ])

  return { daily, dowBreakdown }
}

export async function getHourlyBreakdown(startDate: string, endDate: string, location?: string | null, dayOfWeek?: number | null, channel?: string) {
  // Use orders.orderTime (Presto timestamp) — falls back to Shipday if not yet populated
  const conditions: any[] = [
    dateGte(orders.date, startDate),
    dateLte(orders.date, endDate),
    eq(orders.cancelled, false),
    sql`${orders.orderTime} IS NOT NULL`,
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }
  // orderTime is stored as UTC wall-clock — convert to UK local (Europe/London, GMT/BST)
  // before extracting the hour/day, otherwise during BST every order reads an hour early
  // and the chart shows trade before the shop opens (GA 10:30, HP 11:00).
  if (dayOfWeek != null) {
    conditions.push(sql`EXTRACT(DOW FROM ${orders.orderTime} AT TIME ZONE 'Europe/London') = ${dayOfWeek}`)
  }

  return db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`,
      totalOrders: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(sql`EXTRACT(HOUR FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`)
    .orderBy(sql`EXTRACT(HOUR FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`)
}

// Revenue heatmap: day-of-week × hour (UK local time) for staffing/offer timing.
export async function getRevenueHeatmap(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [
    dateGte(orders.date, startDate),
    dateLte(orders.date, endDate),
    eq(orders.cancelled, false),
    sql`${orders.orderTime} IS NOT NULL`,
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  return db
    .select({
      dow: sql<number>`EXTRACT(DOW FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`,
      hour: sql<number>`EXTRACT(HOUR FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`,
      revenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      orders: sql<number>`COUNT(*)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(
      sql`EXTRACT(DOW FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`,
      sql`EXTRACT(HOUR FROM ${orders.orderTime} AT TIME ZONE 'Europe/London')::int`,
    )
}

export async function getModeBreakdown(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [
    dateGte(orders.date, startDate),
    dateLte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  return db
    .select({
      mode: sql<string>`COALESCE(${orders.mode}, 'Unknown')`,
      totalOrders: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      totalDiscount: sql<number>`COALESCE(SUM(${orders.discountValue}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(sql`COALESCE(${orders.mode}, 'Unknown')`)
    .orderBy(desc(sql`SUM(${orders.totalAmount}::numeric)`))
}

export async function getDailyRevenueTrend(startDate: string, endDate: string, location?: string, channel?: string) {
  const conditions: any[] = [dateGte(orders.date, startDate), dateLte(orders.date, endDate), eq(orders.cancelled, false)]
  if (location && location !== "all") conditions.push(eq(orders.location, location))
  { const cc = channelCondition(orders.orderChannel, channel); if (cc) conditions.push(cc) }

  // Group by date only (one row per day). Per-location revenue is added via
  // conditional sums so a single point carries both stores' trends for comparison.
  return db
    .select({
      date: orders.date,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      totalOrders: sql<number>`COUNT(*)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      hydeParkRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${orders.location} = 'Hyde Park' THEN ${orders.totalAmount}::numeric END), 0)`,
      grandArcadeRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${orders.location} = 'Grand Arcade' THEN ${orders.totalAmount}::numeric END), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.date)
    .orderBy(orders.date)
}

// Order line structure validation — surfaces malformed/orphan rows in the basket data.
export async function getOrderLineValidation(startDate: string, endDate: string, location?: string, channel?: string) {
  const oiChC = channelCondition(sql`oi."orderChannel"`, channel)
  const oChC = channelCondition(sql`o."orderChannel"`, channel)
  const oiLoc = sql`${location && location !== "all" ? sql` AND oi.location = ${location}` : sql``}${oiChC ? sql` AND ${oiChC}` : sql``}`
  const oLoc = sql`${location && location !== "all" ? sql` AND o.location = ${location}` : sql``}${oChC ? sql` AND ${oChC}` : sql``}`

  const raw = await db.execute<Record<string, string>>(sql`
    SELECT
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}) AS total_lines,
      (SELECT COUNT(DISTINCT oi."orderId") FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}) AS distinct_order_ids,
      (SELECT COUNT(*) FROM orders o
        WHERE o.date::date >= ${startDate}::date AND o.date::date <= ${endDate}::date ${oLoc}) AS total_orders,
      -- orphan item lines: an order_items row whose orderId has no matching order
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o."orderId" = oi."orderId")) AS orphan_lines,
      -- orders that have no item lines at all
      (SELECT COUNT(*) FROM orders o
        WHERE o.date::date >= ${startDate}::date AND o.date::date <= ${endDate}::date ${oLoc}
          AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi."orderId" = o."orderId")) AS orders_no_lines,
      -- zero / negative quantity lines
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}
          AND COALESCE(oi.qty::numeric, 0) <= 0) AS zero_qty_lines,
      -- negative amount lines
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}
          AND oi.amount::numeric < 0) AS negative_amount_lines,
      -- uncategorised lines
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}
          AND (oi."categoryName" IS NULL OR TRIM(oi."categoryName") = '')) AS uncategorised_lines,
      -- blank item names
      (SELECT COUNT(*) FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date ${oiLoc}
          AND (oi."itemName" IS NULL OR TRIM(oi."itemName") = '')) AS blank_name_lines
  `)
  const r = ((raw as any).rows ?? raw)[0] ?? {}
  const n = (k: string) => Number(r[k] ?? 0)

  const totalLines = n("total_lines")
  const issues = n("orphan_lines") + n("orders_no_lines") + n("zero_qty_lines") + n("negative_amount_lines") + n("blank_name_lines")
  // health score: % of clean lines (uncategorised treated as a soft warning, not counted as hard error)
  const healthScore = totalLines > 0 ? Math.max(0, Math.round((1 - issues / totalLines) * 100)) : 100

  return {
    totalLines,
    totalOrders: n("total_orders"),
    distinctOrderIds: n("distinct_order_ids"),
    orphanLines: n("orphan_lines"),
    ordersNoLines: n("orders_no_lines"),
    zeroQtyLines: n("zero_qty_lines"),
    negativeAmountLines: n("negative_amount_lines"),
    uncategorisedLines: n("uncategorised_lines"),
    blankNameLines: n("blank_name_lines"),
    healthScore,
  }
}

export async function getBasketAnalysis(startDate: string, endDate: string, location?: string, channel?: string) {
  // Raw SQL for subquery-based aggregations — Drizzle conditions can't be interpolated into FROM subqueries
  const chCond = channelCondition(sql`oi."orderChannel"`, channel)
  const locFilter = sql`${location && location !== "all" ? sql` AND oi.location = ${location}` : sql``}${chCond ? sql` AND ${chCond}` : sql``}`
  // Keep only real sellable products — drop modifier lines (dips/options/etc) and meal-upgrade
  // add-ons so item lists, counts and the distribution reflect actual basket contents.
  const realProduct = sql.raw(`(${basketGroup(`oi."categoryName"`, `oi."itemName"`)}) <> 'Modifier' AND NOT ${mealBundleSql(`oi."itemName"`)}`)

  const conditions: any[] = [
    dateGte(orderItems.date, startDate),
    dateLte(orderItems.date, endDate),
    eq(orderItems.cancelled, false),
    sql`${orderItems.amount}::numeric > 0`,
    sql`(${sql.raw(basketGroup(`order_items."categoryName"`, `order_items."itemName"`))}) <> 'Modifier' AND NOT ${sql.raw(mealBundleSql(`order_items."itemName"`))}`,
  ]
  if (location && location !== "all") conditions.push(eq(orderItems.location, location))
  { const cc = channelCondition(orderItems.orderChannel, channel); if (cc) conditions.push(cc) }

  // All three are independent reads — fire them in parallel
  const [summaryRows, distRows, topItems] = await Promise.all([
    db.execute<{ avg_items: string; avg_basket: string; total_orders: string }>(sql`
      SELECT
        ROUND(AVG(items_per_order), 2)  AS avg_items,
        ROUND(AVG(basket_value), 2)     AS avg_basket,
        COUNT(*)                        AS total_orders
      FROM (
        SELECT
          oi."orderId",
          COUNT(DISTINCT TRIM(oi."itemName"))  AS items_per_order,
          MAX(o."totalAmount"::numeric)        AS basket_value
        FROM order_items oi
        JOIN orders o ON o."orderId" = oi."orderId"
        WHERE oi.date::date >= ${startDate}::date
          AND oi.date::date <= ${endDate}::date
          AND oi.cancelled = false
          AND oi.amount::numeric > 0
          AND ${realProduct}
          ${locFilter}
        GROUP BY oi."orderId"
      ) sub
    `),
    db.execute<{ bucket: string; order_count: string }>(sql`
      SELECT
        CASE
          WHEN items_per_order::int = 1 THEN '1 item'
          WHEN items_per_order::int = 2 THEN '2 items'
          WHEN items_per_order::int = 3 THEN '3 items'
          WHEN items_per_order::int = 4 THEN '4 items'
          ELSE '5+ items'
        END                   AS bucket,
        COUNT(*)              AS order_count
      FROM (
        SELECT oi."orderId", COUNT(DISTINCT TRIM(oi."itemName")) AS items_per_order
        FROM order_items oi
        JOIN orders o ON o."orderId" = oi."orderId"
        WHERE oi.date::date >= ${startDate}::date
          AND oi.date::date <= ${endDate}::date
          AND oi.cancelled = false
          AND oi.amount::numeric > 0
          AND ${realProduct}
          ${locFilter}
        GROUP BY oi."orderId"
      ) sub
      GROUP BY 1
      ORDER BY MIN(items_per_order::int)
    `),
    db
      .select({
        itemName: orderItems.itemName,
        categoryName: sql<string>`COALESCE(${orderItems.categoryName}, 'Uncategorised')`,
        orderFrequency: sql<number>`COUNT(DISTINCT ${orderItems.orderId})`,
        totalQty: sql<number>`SUM(${orderItems.qty}::numeric)`,
        totalRevenue: sql<number>`SUM(${orderItems.amount}::numeric)`,
      })
      .from(orderItems)
      .where(and(...conditions))
      .groupBy(orderItems.itemName, orderItems.categoryName)
      .orderBy(desc(sql`COUNT(DISTINCT ${orderItems.orderId})`))
      .limit(20),
  ])

  const summaryArr: any[] = (summaryRows as unknown as { rows: any[] }).rows ?? (summaryRows as unknown as any[])
  const s = summaryArr[0]
  const summary = s ? {
    avgItemsPerOrder: Number(s.avg_items ?? 0),
    avgBasketValue: Number(s.avg_basket ?? 0),
    totalOrders: Number(s.total_orders ?? 0),
  } : null

  const distArr: any[] = (distRows as unknown as { rows: any[] }).rows ?? (distRows as unknown as any[])
  const distribution = distArr.map((r: any) => ({
    bucket: r.bucket as string,
    orderCount: Number(r.order_count),
  }))

  return { summary, distribution, topItems }
}

// Classify a POS line into a menu group for basket/upsell analysis. Categories are messy
// (68 location-variant spellings + modifier lines), so we match by pattern. Order matters:
// calzone items are Mains even inside the "Garlic Breads & Calzones" category; modifiers
// (dips/options/size/crust/offers) are excluded from basket logic entirely.
const basketGroup = (catCol: string, nameCol: string) => `CASE
  WHEN ${nameCol} ILIKE '%calzone%' THEN 'Main'
  WHEN ${catCol} ~* '^(size|sizes|crust|base|add price|add ingredients|online hidden|offers)$'
       OR ${catCol} ILIKE '%dip%' OR ${catCol} ILIKE '%option%' THEN 'Modifier'
  WHEN ${catCol} ILIKE '%shake%' OR ${catCol} ILIKE '%drink%' THEN 'Drink'
  WHEN ${catCol} ILIKE '%dessert%' OR ${catCol} ILIKE '%sundae%' OR ${catCol} ILIKE '%ice cream%'
       OR ${catCol} ILIKE '%cake%' OR ${catCol} ILIKE '%pudding%' THEN 'Dessert'
  WHEN ${catCol} ILIKE '%side%' OR ${catCol} ILIKE '%extra%' OR ${catCol} ILIKE '%fries%'
       OR ${catCol} ILIKE 'garlic bread%' THEN 'Side'
  WHEN ${catCol} ~* '^calzones?$' OR ${catCol} ILIKE '%pizza%' OR ${catCol} ILIKE '%burger%'
       OR ${catCol} ILIKE '%kebab%' OR ${catCol} ILIKE '%donner%' OR ${catCol} ILIKE '%chicken%'
       OR ${catCol} ILIKE '%wing%' OR ${catCol} ILIKE '%wrap%' OR ${catCol} ILIKE '%box meal%'
       OR ${catCol} ILIKE '%meal deal%' OR ${catCol} ILIKE '%peri%' OR ${catCol} ILIKE '%piri%'
       OR ${catCol} ILIKE '%grill%' OR ${catCol} ILIKE '%loaded%' OR ${catCol} ILIKE '%kid%'
       OR ${catCol} ~* '^main$' THEN 'Main'
  ELSE 'Other' END`

// "Meal upgrade" add-on lines (e.g. "Make It a Meal (Side & Drink)", "Meal (Fries & Drink)",
// bare "Meal") — the POS files these under the generic "Main" category, but they're upgrades
// that bundle a side + drink. We credit them as attaching BOTH a side and a drink, and exclude
// them from product lists. Careful NOT to match real mains like "2Pc Chicken MEAL".
const mealBundleSql = (nameCol: string) =>
  `(${nameCol} ILIKE '%make it a meal%' OR ${nameCol} ILIKE '%meal (%drink%' OR btrim(${nameCol}) ILIKE 'meal')`

// Real market-basket analysis: item affinity (what's bought together), attach-rate of
// add-ons onto mains (the upsell gap), and basket-value lift (the £ upside of upselling).
export async function getBasketInsights(startDate: string, endDate: string, location?: string, channel?: string) {
  const chCond = channelCondition(sql`oi."orderChannel"`, channel)
  const locFilter = sql`${location && location !== "all" ? sql` AND oi.location = ${location}` : sql``}${chCond ? sql` AND ${chCond}` : sql``}`
  const grp = sql.raw(basketGroup(`oi."categoryName"`, `oi."itemName"`))
  const meal = sql.raw(mealBundleSql(`oi."itemName"`))

  const [affinityRes, upsellRes] = await Promise.all([
    // Item pairs bought in the same order — support / confidence / lift.
    // Exclude modifiers AND meal-upgrade lines so this shows genuine product cross-sells.
    db.execute<{
      item_a: string; item_b: string; pair_orders: string
      support_pct: string; conf_a_to_b: string; conf_b_to_a: string; lift: string
    }>(sql`
      WITH lines AS (
        SELECT DISTINCT oi."orderId", TRIM(oi."itemName") AS item
        FROM order_items oi
        WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date
          AND oi.cancelled = false AND oi.amount::numeric > 0
          AND (${grp}) <> 'Modifier' AND NOT ${meal}
          ${locFilter}
      ),
      item_orders AS (SELECT item, COUNT(*) AS orders FROM lines GROUP BY item),
      tot AS (SELECT COUNT(DISTINCT "orderId") AS n FROM lines),
      pairs AS (
        SELECT a.item AS item_a, b.item AS item_b, COUNT(*) AS pair_orders
        FROM lines a JOIN lines b ON a."orderId" = b."orderId" AND a.item < b.item
        GROUP BY a.item, b.item
      )
      SELECT p.item_a, p.item_b, p.pair_orders,
             ROUND(p.pair_orders::numeric / t.n * 100, 1)              AS support_pct,
             ROUND(p.pair_orders::numeric / ia.orders * 100, 1)        AS conf_a_to_b,
             ROUND(p.pair_orders::numeric / ib.orders * 100, 1)        AS conf_b_to_a,
             ROUND((p.pair_orders::numeric * t.n) / (ia.orders::numeric * ib.orders), 2) AS lift
      FROM pairs p
      JOIN item_orders ia ON ia.item = p.item_a
      JOIN item_orders ib ON ib.item = p.item_b
      CROSS JOIN tot t
      WHERE p.pair_orders >= 5
      ORDER BY p.pair_orders DESC, lift DESC
      LIMIT 15
    `),
    // Per-order group presence → attach-rate of add-ons onto mains + basket-value lift.
    // Meal-upgrade lines are credited as attaching BOTH a side and a drink (and are not mains).
    db.execute<{
      main_orders: string; side_orders: string; drink_orders: string; dessert_orders: string
      main_drink: string; main_side: string; main_dessert: string
      aov_drink_y: string; aov_drink_n: string
      aov_side_y: string; aov_side_n: string
      aov_dessert_y: string; aov_dessert_n: string
    }>(sql`
      WITH og AS (
        SELECT s."orderId",
               MAX(o."totalAmount"::numeric) AS basket,
               bool_or(s.grp = 'Main' AND NOT s.is_meal) AS has_main,
               bool_or(s.grp = 'Drink'   OR s.is_meal)   AS has_drink,
               bool_or(s.grp = 'Side'    OR s.is_meal)   AS has_side,
               bool_or(s.grp = 'Dessert')                AS has_dessert
        FROM (
          SELECT oi."orderId", (${grp}) AS grp, ${meal} AS is_meal
          FROM order_items oi
          WHERE oi.date::date >= ${startDate}::date AND oi.date::date <= ${endDate}::date
            AND oi.cancelled = false AND oi.amount::numeric > 0 ${locFilter}
        ) s
        JOIN orders o ON o."orderId" = s."orderId"
        GROUP BY s."orderId"
      )
      SELECT
        COUNT(*) FILTER (WHERE has_main)                              AS main_orders,
        COUNT(*) FILTER (WHERE has_side)                             AS side_orders,
        COUNT(*) FILTER (WHERE has_drink)                            AS drink_orders,
        COUNT(*) FILTER (WHERE has_dessert)                          AS dessert_orders,
        COUNT(*) FILTER (WHERE has_main AND has_drink)               AS main_drink,
        COUNT(*) FILTER (WHERE has_main AND has_side)                AS main_side,
        COUNT(*) FILTER (WHERE has_main AND has_dessert)             AS main_dessert,
        ROUND(AVG(basket) FILTER (WHERE has_main AND has_drink), 2)      AS aov_drink_y,
        ROUND(AVG(basket) FILTER (WHERE has_main AND NOT has_drink), 2)  AS aov_drink_n,
        ROUND(AVG(basket) FILTER (WHERE has_main AND has_side), 2)       AS aov_side_y,
        ROUND(AVG(basket) FILTER (WHERE has_main AND NOT has_side), 2)   AS aov_side_n,
        ROUND(AVG(basket) FILTER (WHERE has_main AND has_dessert), 2)    AS aov_dessert_y,
        ROUND(AVG(basket) FILTER (WHERE has_main AND NOT has_dessert), 2) AS aov_dessert_n
      FROM og
    `),
  ])

  const aRows: any[] = (affinityRes as any).rows ?? affinityRes
  const affinity = aRows.map((r) => ({
    itemA: r.item_a as string,
    itemB: r.item_b as string,
    pairOrders: Number(r.pair_orders),
    supportPct: Number(r.support_pct),
    // Directional confidence: report the stronger direction as the "attach" story
    confidence: Math.max(Number(r.conf_a_to_b), Number(r.conf_b_to_a)),
    lift: Number(r.lift),
  }))

  const u: any = ((upsellRes as any).rows ?? upsellRes)[0] ?? {}
  const mainOrders = Number(u.main_orders ?? 0)
  const mk = (attached: number, aovY: any, aovN: any) => ({
    attachedOrders: attached,
    attachRate: mainOrders > 0 ? (attached / mainOrders) * 100 : 0,
    aovWith: Number(aovY ?? 0),
    aovWithout: Number(aovN ?? 0),
  })
  const attach = {
    mainOrders,
    drink: mk(Number(u.main_drink ?? 0), u.aov_drink_y, u.aov_drink_n),
    side: mk(Number(u.main_side ?? 0), u.aov_side_y, u.aov_side_n),
    dessert: mk(Number(u.main_dessert ?? 0), u.aov_dessert_y, u.aov_dessert_n),
  }

  // Orders containing each menu group — a clean replacement for the old top-20-derived
  // "Most Ordered Categories" chart (meal upgrades counted as side + drink).
  const groups = [
    { name: "Mains", orders: mainOrders },
    { name: "Sides", orders: Number(u.side_orders ?? 0) },
    { name: "Drinks", orders: Number(u.drink_orders ?? 0) },
    { name: "Desserts", orders: Number(u.dessert_orders ?? 0) },
  ].sort((a, b) => b.orders - a.orders)

  return { affinity, attach, groups }
}

export async function getForecastData(location?: string) {
  const locFilter = location && location !== "all" ? sql` AND location = ${location}` : sql``

  const [dowRows, recentTrend] = await Promise.all([
    db.execute<{ day_of_week: string; avg_revenue: string; avg_orders: string; avg_aov: string }>(sql`
      SELECT
        EXTRACT(DOW FROM day)::int        AS day_of_week,
        ROUND(AVG(daily_revenue), 2)      AS avg_revenue,
        ROUND(AVG(daily_orders), 1)       AS avg_orders,
        ROUND(AVG(daily_aov), 2)          AS avg_aov
      FROM (
        SELECT
          date::date                        AS day,
          SUM("totalAmount"::numeric)       AS daily_revenue,
          COUNT(*)                          AS daily_orders,
          AVG("totalAmount"::numeric)       AS daily_aov
        FROM orders
        WHERE date::date >= (CURRENT_DATE - INTERVAL '56 days')
          AND cancelled = false
          ${locFilter}
        GROUP BY date::date
      ) sub
      GROUP BY EXTRACT(DOW FROM day)::int
      ORDER BY EXTRACT(DOW FROM day)::int
    `),
    db
      .select({
        date: orders.date,
        totalRevenue: sql<number>`SUM(${orders.totalAmount}::numeric)`,
        totalOrders: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(and(
        sql`${orders.date}::date >= (CURRENT_DATE - INTERVAL '30 days')`,
        eq(orders.cancelled, false),
        ...(location && location !== "all" ? [eq(orders.location, location)] : [])
      ))
      .groupBy(orders.date)
      .orderBy(orders.date),
  ])

  const dowArr: any[] = (dowRows as unknown as { rows: any[] }).rows ?? (dowRows as unknown as any[])
  const dowStats = dowArr.map((r: any) => ({
    dayOfWeek: Number(r.day_of_week),
    avgRevenue: Number(r.avg_revenue ?? 0),
    avgOrders: Number(r.avg_orders ?? 0),
    avgAov: Number(r.avg_aov ?? 0),
  }))

  return { dowStats, recentTrend }
}

// ─── Offer Performance Tracking ───────────────────────────────────────────
// Offers come from Presto as order_items rows where categoryName = 'OFFERS'.
// The (trimmed) itemName is the offer name. Multiple offers are supported.
export async function getOfferAnalytics(
  startDate: string,
  endDate: string,
  location?: string,
  offerName?: string | null,
  channel?: string,
) {
  const oiChC = channelCondition(sql`oi."orderChannel"`, channel)
  const locSql = sql`${location && location !== "all" ? sql` AND oi.location = ${location}` : sql``}${oiChC ? sql` AND ${oiChC}` : sql``}`

  // 1) List of all distinct offers in range (for the name slicer) + headline numbers
  const offerListRaw = await db.execute<{
    offer: string; orders: string; units: string; offer_revenue: string; offer_discount: string
  }>(sql`
    SELECT
      TRIM(oi."itemName")                       AS offer,
      COUNT(DISTINCT oi."orderId")              AS orders,
      COALESCE(SUM(oi.qty::numeric), 0)         AS units,
      COALESCE(SUM(oi.amount::numeric), 0)      AS offer_revenue,
      COALESCE(SUM(oi.discount::numeric), 0)    AS offer_discount
    FROM order_items oi
    WHERE oi."categoryName" ILIKE '%offer%'
      AND oi.cancelled = false
      -- Stray POS line mis-filed under Offers; not a real promotion, exclude it.
      AND LOWER(TRIM(oi."itemName")) <> 'zinger burger solo'
      AND oi.date::date >= ${startDate}::date
      AND oi.date::date <= ${endDate}::date
      ${locSql}
    GROUP BY TRIM(oi."itemName")
    ORDER BY COUNT(DISTINCT oi."orderId") DESC
  `)
  const offers = ((offerListRaw as any).rows ?? offerListRaw).map((r: any) => ({
    offer: r.offer as string,
    orders: Number(r.orders),
    units: Number(r.units),
    offerRevenue: Number(r.offer_revenue),
    offerDiscount: Number(r.offer_discount),
  }))

  // 2) Baseline: overall AOV + overall margin % across all (non-offer-specific) orders in range
  const oChC = channelCondition(sql`o."orderChannel"`, channel)
  const orderLoc = sql`${location && location !== "all" ? sql` AND o.location = ${location}` : sql``}${oChC ? sql` AND ${oChC}` : sql``}`
  const baseRaw = await db.execute<{ total_orders: string; aov: string; revenue: string }>(sql`
    SELECT COUNT(*) AS total_orders,
           COALESCE(AVG(o."totalAmount"::numeric), 0) AS aov,
           COALESCE(SUM(o."totalAmount"::numeric), 0) AS revenue
    FROM orders o
    WHERE o.cancelled = false
      AND o.date::date >= ${startDate}::date
      AND o.date::date <= ${endDate}::date
      ${orderLoc}
  `)
  const baseMarginRaw = await db.execute<{ margin_pct: string }>(sql`
    SELECT CASE WHEN SUM(oi.amount::numeric) > 0
      THEN ROUND((SUM(oi.amount::numeric) - SUM(oi.qty::numeric * COALESCE(cl.unit_cost, 0))) / SUM(oi.amount::numeric) * 100, 1)
      ELSE 0 END AS margin_pct
    FROM order_items oi
    LEFT JOIN ${costLookupRaw} cl ON cl.nk = ${normKey(sql`oi."itemName"`)}
    WHERE oi.cancelled = false
      AND oi.date::date >= ${startDate}::date
      AND oi.date::date <= ${endDate}::date
      ${locSql}
  `)
  const baseRow = ((baseRaw as any).rows ?? baseRaw)[0] ?? {}
  const baseMarginRow = ((baseMarginRaw as any).rows ?? baseMarginRaw)[0] ?? {}
  const baseline = {
    totalOrders: Number(baseRow.total_orders ?? 0),
    overallAOV: Number(baseRow.aov ?? 0),
    overallRevenue: Number(baseRow.revenue ?? 0),
    overallMarginPct: Number(baseMarginRow.margin_pct ?? 0),
  }

  // Default to the most-used offer if none selected
  const target = offerName && offerName !== "all" ? offerName : (offers[0]?.offer ?? null)
  if (!target) return { offers, baseline, selected: null }

  // 3) Basket-level metrics for orders that CONTAIN the selected offer
  const basketRaw = await db.execute<{
    basket_orders: string; basket_revenue: string; basket_aov: string; basket_discount: string; avg_items: string
  }>(sql`
    WITH offer_orders AS (
      SELECT DISTINCT oi."orderId"
      FROM order_items oi
      WHERE oi."categoryName" ILIKE '%offer%'
        AND TRIM(oi."itemName") = ${target}
        AND oi.cancelled = false
        AND oi.date::date >= ${startDate}::date
        AND oi.date::date <= ${endDate}::date
        ${locSql}
    )
    SELECT
      COUNT(*)                                   AS basket_orders,
      COALESCE(SUM(o."totalAmount"::numeric), 0) AS basket_revenue,
      COALESCE(AVG(o."totalAmount"::numeric), 0) AS basket_aov,
      COALESCE(SUM(o."discountValue"::numeric), 0) AS basket_discount,
      COALESCE((
        SELECT AVG(cnt) FROM (
          SELECT SUM(oi2.qty::numeric) AS cnt FROM order_items oi2
          WHERE oi2."orderId" IN (SELECT "orderId" FROM offer_orders)
          GROUP BY oi2."orderId"
        ) z
      ), 0)                                       AS avg_items
    FROM orders o
    WHERE o."orderId" IN (SELECT "orderId" FROM offer_orders)
  `)
  const basketRow = ((basketRaw as any).rows ?? basketRaw)[0] ?? {}

  // 4) Profitability of the offer baskets (item revenue, matched cost, gross profit, margin)
  const profitRaw = await db.execute<{ item_revenue: string; item_cost: string; gross_profit: string; margin_pct: string }>(sql`
    WITH offer_orders AS (
      SELECT DISTINCT oi."orderId"
      FROM order_items oi
      WHERE oi."categoryName" ILIKE '%offer%'
        AND TRIM(oi."itemName") = ${target}
        AND oi.cancelled = false
        AND oi.date::date >= ${startDate}::date
        AND oi.date::date <= ${endDate}::date
        ${locSql}
    )
    SELECT
      COALESCE(SUM(oi.amount::numeric), 0)                                                    AS item_revenue,
      COALESCE(SUM(oi.qty::numeric * COALESCE(cl.unit_cost, 0)), 0)                           AS item_cost,
      COALESCE(SUM(oi.amount::numeric) - SUM(oi.qty::numeric * COALESCE(cl.unit_cost, 0)), 0) AS gross_profit,
      CASE WHEN SUM(oi.amount::numeric) > 0
        THEN ROUND((SUM(oi.amount::numeric) - SUM(oi.qty::numeric * COALESCE(cl.unit_cost, 0))) / SUM(oi.amount::numeric) * 100, 1)
        ELSE 0 END                                                                            AS margin_pct
    FROM order_items oi
    LEFT JOIN ${costLookupRaw} cl ON cl.nk = ${normKey(sql`oi."itemName"`)}
    WHERE oi."orderId" IN (SELECT "orderId" FROM offer_orders)
  `)
  const profitRow = ((profitRaw as any).rows ?? profitRaw)[0] ?? {}

  // 5) Daily trend of offer usage
  const trendRaw = await db.execute<{ date: string; orders: string; revenue: string }>(sql`
    SELECT oi.date::date AS date,
           COUNT(DISTINCT oi."orderId")         AS orders,
           COALESCE(SUM(oi.amount::numeric), 0) AS revenue
    FROM order_items oi
    WHERE oi."categoryName" ILIKE '%offer%'
      AND TRIM(oi."itemName") = ${target}
      AND oi.cancelled = false
      AND oi.date::date >= ${startDate}::date
      AND oi.date::date <= ${endDate}::date
      ${locSql}
    GROUP BY oi.date::date
    ORDER BY oi.date::date
  `)
  const dailyTrend = ((trendRaw as any).rows ?? trendRaw).map((r: any) => ({
    date: r.date as string,
    orders: Number(r.orders),
    revenue: Number(r.revenue),
  }))

  const offerHeadline = offers.find((o: any) => o.offer === target) ?? { orders: 0, units: 0, offerRevenue: 0, offerDiscount: 0 }
  const basketOrders = Number(basketRow.basket_orders ?? 0)
  const basketAOV = Number(basketRow.basket_aov ?? 0)
  const penetration = baseline.totalOrders > 0 ? (basketOrders / baseline.totalOrders) * 100 : 0
  const aovUpliftPct = baseline.overallAOV > 0 ? ((basketAOV - baseline.overallAOV) / baseline.overallAOV) * 100 : 0

  const selected = {
    offer: target,
    ordersUsed: offerHeadline.orders,
    units: offerHeadline.units,
    basketOrders,
    basketRevenue: Number(basketRow.basket_revenue ?? 0),
    basketAOV,
    basketDiscount: Number(basketRow.basket_discount ?? 0),
    avgItemsPerBasket: Number(basketRow.avg_items ?? 0),
    grossProfit: Number(profitRow.gross_profit ?? 0),
    itemCost: Number(profitRow.item_cost ?? 0),
    marginPct: Number(profitRow.margin_pct ?? 0),
    penetration,
    aovUpliftPct,
    dailyTrend,
  }

  return { offers, baseline, selected }
}

// ─── Execution Tracker ────────────────────────────────────────────────────
export async function getActionItems() {
  return db
    .select()
    .from(actionItems)
    .orderBy(
      // todo & in_progress first, then by priority, then nearest deadline
      sql`CASE ${actionItems.status} WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END`,
      sql`CASE ${actionItems.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
      sql`${actionItems.deadline} NULLS LAST`,
    )
}

export async function createActionItem(input: {
  title: string
  detail?: string | null
  category?: string | null
  priority?: string
  owner?: string | null
  deadline?: string | null
  impact?: string | null
}) {
  try {
    const [row] = await db
      .insert(actionItems)
      .values({
        title: input.title,
        detail: input.detail ?? null,
        category: input.category ?? "Other",
        priority: input.priority ?? "medium",
        owner: input.owner ?? null,
        deadline: input.deadline || null,
        impact: input.impact ?? null,
      })
      .returning()
    revalidatePath("/dashboard/actions")
    return { success: true, item: row }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function updateActionItem(
  id: number,
  patch: Partial<{ title: string; owner: string | null; deadline: string | null; status: string; priority: string; category: string }>,
) {
  try {
    await db
      .update(actionItems)
      .set({
        ...patch,
        deadline: patch.deadline !== undefined ? (patch.deadline || null) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(actionItems.id, id))
    revalidatePath("/dashboard/actions")
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function deleteActionItem(id: number) {
  try {
    await db.delete(actionItems).where(eq(actionItems.id, id))
    revalidatePath("/dashboard/actions")
    return { success: true }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}
