"use server"

import { db } from "@/lib/db"
import { menuItems, orders, orderItems, deliveries, syncLogs } from "@/lib/db/schema"
import { eq, desc, and, gte, lte, sql } from "drizzle-orm"
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
    const spreadsheetId = process.env.GOOGLE_SHEET_ID

    // Get all sheet names first
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: spreadsheetId! })
    const sheetNames = spreadsheet.data.sheets?.map((s) => s.properties?.title).filter(Boolean) || []

    // Find the menu-price sheet
    const menuSheet = sheetNames.find((name) =>
      name?.toLowerCase().includes("menu") || name?.toLowerCase().includes("price")
    ) || sheetNames[0]

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `${menuSheet}!A:Z`,
    })

    const rows = response.data.values || []
    if (rows.length < 2) return { success: false, error: "No data found in sheet" }

    const headers = rows[0].map((h: string) => h?.toString().toLowerCase().trim())
    const nameIdx = headers.findIndex((h: string) => h.includes("item") || h.includes("name") || h.includes("product"))
    const costIdx = headers.findIndex((h: string) => h.includes("cost") || h.includes("ingredient"))
    const priceHPIdx = headers.findIndex((h: string) => h.includes("hyde") || (h.includes("price") && !h.includes("grand")))
    const priceGAIdx = headers.findIndex((h: string) => h.includes("grand") || h.includes("arcade"))
    const catIdx = headers.findIndex((h: string) => h.includes("categor"))
    const typeIdx = headers.findIndex((h: string) => h.includes("type"))

    const items = rows.slice(1).filter((row: string[]) => row[nameIdx]?.toString().trim())

    // Clear existing items and re-insert
    await db.delete(menuItems)

    const itemsToInsert = items.map((row: string[]) => ({
      itemName: row[nameIdx]?.toString().trim() || "",
      costPrice: row[costIdx] ? (parseFloat(row[costIdx].toString().replace(/[£,$]/g, "")) || null)?.toString() ?? null : null,
      sellingPriceHydePark: priceHPIdx >= 0 && row[priceHPIdx] ? (parseFloat(row[priceHPIdx].toString().replace(/[£,$]/g, "")) || null)?.toString() ?? null : null,
      sellingPriceGrandArcade: priceGAIdx >= 0 && row[priceGAIdx] ? (parseFloat(row[priceGAIdx].toString().replace(/[£,$]/g, "")) || null)?.toString() ?? null : null,
      category: catIdx >= 0 ? row[catIdx]?.toString().trim() || null : null,
      itemType: typeIdx >= 0 ? row[typeIdx]?.toString().trim() || null : null,
      lastSyncedAt: new Date(),
    }))

    if (itemsToInsert.length > 0) {
      await db.insert(menuItems).values(itemsToInsert)
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
    const data = await prestoFetch(`/location/${locationId}/reports/shift/detailed?where=date:${dateStr}`)
    const sales = data?.data || data?.sales || data || []

    let orderCount = 0
    let itemCount = 0

    for (const sale of Array.isArray(sales) ? sales : []) {
      const orderId = sale.id?.toString() || sale.orderId?.toString()
      if (!orderId) continue

      // Upsert order
      await db
        .insert(orders)
        .values({
          orderId,
          location: locationName,
          date: dateStr,
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
        })
        .onConflictDoUpdate({
          target: orders.orderId,
          set: {
            totalAmount: sale.totalAmount?.toString() || "0",
            cancelled: sale.cancelled || false,
          },
        })

      orderCount++

      // Insert order items
      const saleItems = sale.saleItems || sale.items || []
      for (const item of saleItems) {
        const existing = await db
          .select()
          .from(orderItems)
          .where(and(eq(orderItems.orderId, orderId), eq(orderItems.itemName, item.itemName || "")))
          .limit(1)

        if (existing.length === 0) {
          await db.insert(orderItems).values({
            orderId,
            location: locationName,
            date: dateStr,
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
          itemCount++
        }
      }
    }

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
    const res = await fetch("https://api.shipday.com/orders/query", {
      method: "POST",
      headers: {
        Authorization: `Basic ${process.env.SHIPDAY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate, endDate, pageSize: 100 }),
    })

    if (!res.ok) throw new Error(`Shipday API error: ${res.status}`)
    const data = await res.json()
    const shipdayOrders = data?.orders || data || []

    let count = 0
    for (const order of Array.isArray(shipdayOrders) ? shipdayOrders : []) {
      await db
        .insert(deliveries)
        .values({
          shipdayOrderId: order.orderId?.toString() || order.id?.toString(),
          orderNumber: order.orderNumber?.toString() || null,
          placementTime: order.placementTime ? new Date(order.placementTime) : null,
          assignedTime: order.assignedTime ? new Date(order.assignedTime) : null,
          startTime: order.startTime ? new Date(order.startTime) : null,
          pickedupTime: order.pickedupTime ? new Date(order.pickedupTime) : null,
          arrivedTime: order.arrivedTime ? new Date(order.arrivedTime) : null,
          deliveryTime: order.deliveryTime ? new Date(order.deliveryTime) : null,
          failedDeliveryTime: order.failedDeliveryTime ? new Date(order.failedDeliveryTime) : null,
          status: order.status || null,
          driverId: order.carrier?.id?.toString() || null,
          driverName: order.carrier?.name || null,
          orderTotal: order.orderTotal?.toString() || null,
          deliveryFee: order.deliveryFee?.toString() || null,
          driverPayment: order.driverPayment?.toString() || null,
          tip: order.tip?.toString() || "0",
          discount: order.discount?.toString() || "0",
          tax: order.tax?.toString() || "0",
          distance: order.distance?.toString() || null,
          paymentMethod: order.paymentMethod || null,
          orderSource: order.orderSource || null,
          incomplete: order.incomplete || false,
        })
        .onConflictDoNothing()

      count++
    }

    await db.insert(syncLogs).values({ source: "shipday", status: "success", recordsProcessed: count })
    revalidatePath("/dashboard")
    return { success: true, count }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    await db.insert(syncLogs).values({ source: "shipday", status: "error", errorMessage: msg })
    return { success: false, error: msg }
  }
}

// ─── Dashboard Data Fetchers ──────────────────────────────────────────────
export async function getOverviewKPIs(startDate: string, endDate: string, location?: string) {
  const conditions = [
    gte(orders.date, startDate),
    lte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

  const result = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      totalOrders: sql<number>`COUNT(*)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      totalDiscount: sql<number>`COALESCE(SUM(${orders.discountValue}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))

  const itemResult = await db
    .select({
      totalItemsSold: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric), 0)`,
      totalCost: sql<number>`COALESCE(SUM(oi.qty::numeric * mi."costPrice"::numeric), 0)`,
    })
    .from(orderItems)
    .leftJoin(menuItems, eq(orderItems.itemName, menuItems.itemName))
    .where(and(gte(orderItems.date, startDate), lte(orderItems.date, endDate), eq(orderItems.cancelled, false)))

  return { ...result[0], ...itemResult[0] }
}

export async function getItemProfitability(startDate: string, endDate: string, location?: string) {
  const conditions = [
    gte(orderItems.date, startDate),
    lte(orderItems.date, endDate),
    eq(orderItems.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orderItems.location, location))

  return db
    .select({
      itemName: orderItems.itemName,
      categoryName: sql<string>`COALESCE(${orderItems.categoryName}, ${menuItems.category}, 'Uncategorised')`,
      itemType: sql<string>`COALESCE(${orderItems.itemType}, ${menuItems.itemType}, 'Unknown')`,
      totalQty: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric), 0)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric), 0)`,
      avgUnitPrice: sql<number>`COALESCE(AVG(${orderItems.unitPrice}::numeric), 0)`,
      costPrice: sql<number>`COALESCE(MAX(${menuItems.costPrice}::numeric), 0)`,
      totalCost: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric * COALESCE(${menuItems.costPrice}::numeric, 0)), 0)`,
      grossProfit: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * COALESCE(${menuItems.costPrice}::numeric, 0)), 0)`,
      marginPercent: sql<number>`CASE WHEN SUM(${orderItems.amount}::numeric) > 0 THEN ROUND((SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * COALESCE(${menuItems.costPrice}::numeric, 0))) / SUM(${orderItems.amount}::numeric) * 100, 2) ELSE 0 END`,
      totalDiscount: sql<number>`COALESCE(SUM(${orderItems.discount}::numeric), 0)`,
    })
    .from(orderItems)
    .leftJoin(menuItems, eq(orderItems.itemName, menuItems.itemName))
    .where(and(...conditions))
    .groupBy(orderItems.itemName, orderItems.categoryName, orderItems.itemType, menuItems.category, menuItems.itemType)
    .orderBy(desc(sql`SUM(${orderItems.amount}::numeric)`))
}

export async function getCategoryPerformance(startDate: string, endDate: string, location?: string) {
  const conditions = [
    gte(orderItems.date, startDate),
    lte(orderItems.date, endDate),
    eq(orderItems.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orderItems.location, location))

  return db
    .select({
      category: sql<string>`COALESCE(${orderItems.categoryName}, ${menuItems.category}, 'Uncategorised')`,
      totalQty: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric), 0)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric), 0)`,
      totalCost: sql<number>`COALESCE(SUM(${orderItems.qty}::numeric * COALESCE(${menuItems.costPrice}::numeric, 0)), 0)`,
      grossProfit: sql<number>`COALESCE(SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * COALESCE(${menuItems.costPrice}::numeric, 0)), 0)`,
      marginPercent: sql<number>`CASE WHEN SUM(${orderItems.amount}::numeric) > 0 THEN ROUND((SUM(${orderItems.amount}::numeric) - SUM(${orderItems.qty}::numeric * COALESCE(${menuItems.costPrice}::numeric, 0))) / SUM(${orderItems.amount}::numeric) * 100, 2) ELSE 0 END`,
    })
    .from(orderItems)
    .leftJoin(menuItems, eq(orderItems.itemName, menuItems.itemName))
    .where(and(...conditions))
    .groupBy(sql`COALESCE(${orderItems.categoryName}, ${menuItems.category}, 'Uncategorised')`)
    .orderBy(desc(sql`SUM(${orderItems.amount}::numeric)`))
}

export async function getPlatformPerformance(startDate: string, endDate: string, location?: string) {
  const conditions = [gte(orders.date, startDate), lte(orders.date, endDate), eq(orders.cancelled, false)]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

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

export async function getHourlyDemand(startDate: string, endDate: string, location?: string) {
  const conditions = [gte(orders.date, startDate), lte(orders.date, endDate), eq(orders.cancelled, false)]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

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
  return db
    .select({
      driverName: deliveries.driverName,
      totalDeliveries: sql<number>`COUNT(*)`,
      successRate: sql<number>`ROUND(COUNT(CASE WHEN ${deliveries.status} = 'ALREADY_DELIVERED' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2)`,
      avgDeliveryMinutes: sql<number>`ROUND(AVG(EXTRACT(EPOCH FROM (${deliveries.deliveryTime} - ${deliveries.placementTime})) / 60), 1)`,
      avgDispatchMinutes: sql<number>`ROUND(AVG(EXTRACT(EPOCH FROM (${deliveries.assignedTime} - ${deliveries.placementTime})) / 60), 1)`,
      totalRevenue: sql<number>`COALESCE(SUM(${deliveries.orderTotal}::numeric), 0)`,
      totalDriverCost: sql<number>`COALESCE(SUM(${deliveries.driverPayment}::numeric), 0)`,
      totalDistance: sql<number>`COALESCE(SUM(${deliveries.distance}::numeric), 0)`,
    })
    .from(deliveries)
    .where(and(
      gte(deliveries.placementTime, new Date(startDate)),
      lte(deliveries.placementTime, new Date(endDate + "T23:59:59")),
    ))
    .groupBy(deliveries.driverName)
    .orderBy(desc(sql`COUNT(*)`))
}

export async function getSyncLogs() {
  return db.select().from(syncLogs).orderBy(desc(syncLogs.syncedAt)).limit(20)
}

export async function getMenuItems() {
  return db.select().from(menuItems).orderBy(menuItems.itemName)
}

export async function getOfferAnalysis(startDate: string, endDate: string, location?: string) {
  const conditions = [
    gte(orders.date, startDate),
    lte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

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
  const conditions = [
    gte(orders.date, startDate),
    lte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

  const customerData = await db
    .select({
      customerId: orders.customerId,
      orderCount: sql<number>`COUNT(*)`,
      totalSpend: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
      firstOrder: sql<string>`MIN(${orders.date})`,
      lastOrder: sql<string>`MAX(${orders.date})`,
      platform: sql<string>`COALESCE(MAX(${orders.orderChannel}), MAX(${orders.platform}), 'Unknown')`,
    })
    .from(orders)
    .where(and(...conditions, sql`${orders.customerId} IS NOT NULL`))
    .groupBy(orders.customerId)
    .orderBy(desc(sql`SUM(${orders.totalAmount}::numeric)`))

  // Segment customers
  const newCustomers = customerData.filter((c) => Number(c.orderCount) === 1).length
  const returning = customerData.filter((c) => Number(c.orderCount) >= 2).length
  const loyal = customerData.filter((c) => Number(c.orderCount) >= 5).length
  const totalRevenue = customerData.reduce((s, c) => s + Number(c.totalSpend), 0)
  const loyalRevenue = customerData.filter((c) => Number(c.orderCount) >= 5).reduce((s, c) => s + Number(c.totalSpend), 0)

  return {
    customers: customerData.slice(0, 50),
    summary: {
      totalCustomers: customerData.length,
      newCustomers,
      returning,
      loyal,
      totalRevenue,
      loyalRevenue,
      avgOrdersPerCustomer: customerData.length > 0
        ? customerData.reduce((s, c) => s + Number(c.orderCount), 0) / customerData.length
        : 0,
      avgSpendPerCustomer: customerData.length > 0 ? totalRevenue / customerData.length : 0,
    },
  }
}

export async function getHourlyDemandHeatmap(startDate: string, endDate: string, location?: string) {
  const conditions = [
    gte(orders.date, startDate),
    lte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

  // Get daily totals grouped by date only (Presto doesn't store exact hour in orders table)
  const daily = await db
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
    .orderBy(orders.date)

  // Day-of-week breakdown
  const dowBreakdown = await db
    .select({
      dayOfWeek: sql<number>`EXTRACT(DOW FROM ${orders.date}::date)`,
      totalOrders: sql<number>`COUNT(*)`,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(sql`EXTRACT(DOW FROM ${orders.date}::date)`)
    .orderBy(sql`EXTRACT(DOW FROM ${orders.date}::date)`)

  return { daily, dowBreakdown }
}

export async function getModeBreakdown(startDate: string, endDate: string, location?: string) {
  const conditions = [
    gte(orders.date, startDate),
    lte(orders.date, endDate),
    eq(orders.cancelled, false),
  ]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

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

export async function getDailyRevenueTrend(startDate: string, endDate: string, location?: string) {
  const conditions = [gte(orders.date, startDate), lte(orders.date, endDate), eq(orders.cancelled, false)]
  if (location && location !== "all") conditions.push(eq(orders.location, location))

  return db
    .select({
      date: orders.date,
      location: orders.location,
      totalRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}::numeric), 0)`,
      totalOrders: sql<number>`COUNT(*)`,
      avgOrderValue: sql<number>`COALESCE(AVG(${orders.totalAmount}::numeric), 0)`,
    })
    .from(orders)
    .where(and(...conditions))
    .groupBy(orders.date, orders.location)
    .orderBy(orders.date)
}
