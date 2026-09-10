import { NextResponse } from "next/server"
import { syncPrestoData, syncShipdayData } from "@/app/actions/dashboard"
import { syncCostingSheet } from "@/lib/normalise/actions"
import { syncPricingSheet } from "@/lib/pricing/actions"
import { buildProductMaster } from "@/lib/product-master/actions"
import { db } from "@/lib/db"
import { syncLogs } from "@/lib/db/schema"

// DAILY data sync over a rolling last-7-days window for Presto (both locations) +
// Shipday. The window overlaps deliberately: a missed or failed run self-heals on
// the next one, and late-arriving platform orders get picked up.
// Designed to be triggered by a scheduler (Vercel Cron, GitHub Actions, cron-job.org,
// Windows Task Scheduler, etc.). Protected by CRON_SECRET so it can't be run by anyone
// who guesses the URL — the caller must send `Authorization: Bearer <CRON_SECRET>`.
// Vercel Cron sends this header automatically when CRON_SECRET is set in the project env.

export const dynamic = "force-dynamic"
export const maxDuration = 300 // sync can take a while across 7 days × 2 locations

// UK-local calendar date (yyyy-MM-dd), honouring GMT/BST — matches how the rest of the
// app stamps order dates so the 7-day window lines up with Presto's trading days.
const _ukDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
const ukDateStr = (d: Date) => _ukDateFmt.format(d)

function lastNDates(n: number): string[] {
  const out: string[] = []
  const now = Date.now()
  for (let i = n - 1; i >= 0; i--) out.push(ukDateStr(new Date(now - i * 86_400_000)))
  return out
}

async function runWeeklySync() {
  const dates = lastNDates(7)
  const start = dates[0]
  const end = dates[dates.length - 1]

  // Presto: one calendar day at a time, both locations in parallel per day.
  // syncPrestoData already pulls each day's shift PLUS the previous day's shift, so
  // after-midnight orders on the window's first day are captured too.
  const presto = { HYDE_PARK: 0, GRAND_ARCADE: 0 }
  const errors: string[] = []
  for (const d of dates) {
    const results = await Promise.all([
      syncPrestoData(d, "HYDE_PARK"),
      syncPrestoData(d, "GRAND_ARCADE"),
    ] as const)
    const [hp, ga] = results
    if (hp.success) presto.HYDE_PARK += hp.orders ?? 0
    else errors.push(`Presto HP ${d}: ${hp.error}`)
    if (ga.success) presto.GRAND_ARCADE += ga.orders ?? 0
    else errors.push(`Presto GA ${d}: ${ga.error}`)
  }

  // Shipday takes a date range directly.
  const shipday = await syncShipdayData(start, end)

  // Corrections Priority 8 (items 56-62): the supplier -> recipe -> item cost chain
  // lives in the costing workbook's formulas, but Analytics only sees a change once
  // the sheet is re-read. Syncing Presto alone left a supplier price rise sitting in
  // the sheet indefinitely, which breaks the "no manual re-entry" requirement. Costs,
  // prices and the Product Master are refreshed here, in dependency order.
  const costing = await syncCostingSheet()
  const pricing = await syncPricingSheet()
  const productMaster = await buildProductMaster()
  if (!shipday.success) errors.push(`Shipday: ${shipday.error}`)
  if (!costing.success) errors.push(`Costing sheet: ${costing.error}`)
  if (!pricing.success) errors.push(`Pricing sheet: ${pricing.error}`)
  if (!productMaster.success) errors.push(`Product Master: ${productMaster.error}`)

  return {
    window: { start, end },
    presto,
    shipday: shipday.success ? { count: shipday.count ?? 0 } : { error: shipday.error },
    costing: costing.success ? { items: costing.count ?? 0 } : { error: costing.error },
    pricing: pricing.success ? { rows: pricing.items ?? 0 } : { error: pricing.error },
    productMaster: productMaster.success
      ? { products: productMaster.products ?? 0, aliasesLinked: productMaster.aliasesLinked ?? 0 }
      : { error: productMaster.error },
    errors,
    ok: errors.length === 0,
  }
}

// Rejected runs used to return before anything was written, so a missing or wrong
// CRON_SECRET left no trace: the dashboard simply stopped getting new data. Record the
// rejection in sync_logs so it shows up on the Data Sync tab.
async function logRejected(reason: string) {
  try {
    await db.insert(syncLogs).values({ source: "cron", status: "error", errorMessage: reason })
  } catch {}
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    await logRejected("CRON_SECRET is not set in the deployment environment; scheduled sync skipped")
    return NextResponse.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 })
  }
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    await logRejected("Scheduled sync rejected: Authorization header did not match CRON_SECRET")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const summary = await runWeeklySync()
    return NextResponse.json(summary, { status: summary.ok ? 200 : 207 })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

// Vercel Cron issues GET; allow POST too for manual/other schedulers.
export const GET = handle
export const POST = handle
