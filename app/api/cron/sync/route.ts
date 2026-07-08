import { NextResponse } from "next/server"
import { syncPrestoData, syncShipdayData } from "@/app/actions/dashboard"

// Weekly data sync (last 7 days) for Presto (both locations) + Shipday.
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
  if (!shipday.success) errors.push(`Shipday: ${shipday.error}`)

  return {
    window: { start, end },
    presto,
    shipday: shipday.success ? { count: shipday.count ?? 0 } : { error: shipday.error },
    errors,
    ok: errors.length === 0,
  }
}

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured on the server" }, { status: 500 })
  }
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
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
