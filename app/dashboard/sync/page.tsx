"use client"

import { useState, useEffect } from "react"
import { syncGoogleSheets, syncPrestoData, syncShipdayData, getSyncLogs, clearSyncData } from "@/app/actions/dashboard"
import { syncCostingSheet, normaliseOrderItems } from "@/lib/normalise/actions"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { RefreshCw, CheckCircle, XCircle, Clock, Database, Sheet, Truck, GitMerge, Trash2, AlertTriangle } from "lucide-react"
import { format } from "date-fns"

type SyncLog = {
  id: number
  source: string
  location: string | null
  status: string
  recordsProcessed: number | null
  errorMessage: string | null
  syncedAt: Date
}

export default function SyncPage() {
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [prestoStartDate, setPrestoStartDate] = useState(format(new Date(Date.now() - 7 * 86400000), "yyyy-MM-dd"))
  const [prestoEndDate, setPrestoEndDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [prestoProgress, setPrestoProgress] = useState("")
  const [shipdayStart, setShipdayStart] = useState(format(new Date(Date.now() - 7 * 86400000), "yyyy-MM-dd"))
  const [shipdayEnd, setShipdayEnd] = useState(format(new Date(), "yyyy-MM-dd"))
  const [clearConfirm, setClearConfirm] = useState<"orders" | "deliveries" | "all" | null>(null)
  const [clearMsg, setClearMsg] = useState("")

  const getDatesInRange = (start: string, end: string): string[] => {
    const dates: string[] = []
    const cur = new Date(start)
    const endD = new Date(end)
    while (cur <= endD) {
      dates.push(format(cur, "yyyy-MM-dd"))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }

  const getDayCount = () => getDatesInRange(prestoStartDate, prestoEndDate).length

  const runPrestoRange = async (locationKey: "HYDE_PARK" | "GRAND_ARCADE" | "BOTH") => {
    const dates = getDatesInRange(prestoStartDate, prestoEndDate)
    const locations: Array<"HYDE_PARK" | "GRAND_ARCADE"> =
      locationKey === "BOTH" ? ["HYDE_PARK", "GRAND_ARCADE"] : [locationKey]
    const keys = locationKey === "BOTH" ? ["presto_hp", "presto_ga"] : [locationKey === "HYDE_PARK" ? "presto_hp" : "presto_ga"]

    keys.forEach((k) => setLoading((p) => ({ ...p, [k]: true })))
    setPrestoProgress(`Starting sync for ${dates.length} day${dates.length > 1 ? "s" : ""}...`)

    const totals: Record<string, number> = { HYDE_PARK: 0, GRAND_ARCADE: 0 }
    let hadError = ""

    // Process one date at a time but both locations in parallel per date
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i]
      setPrestoProgress(`Day ${i + 1} of ${dates.length}: ${d}`)
      try {
        const results = await Promise.all(locations.map((loc) => syncPrestoData(d, loc)))
        results.forEach((result, idx) => {
          if (result.success) totals[locations[idx]] += result.orders ?? 0
          else hadError = result.error ?? "Unknown error"
        })
      } catch (e) {
        hadError = e instanceof Error ? e.message : "Unknown error"
      }
    }

    keys.forEach((k) => setLoading((p) => ({ ...p, [k]: false })))
    const totalAll = Object.values(totals).reduce((a, b) => a + b, 0)
    const summary = hadError
      ? `Error: ${hadError}`
      : locationKey === "BOTH"
      ? `Synced ${totals.HYDE_PARK} Hyde Park + ${totals.GRAND_ARCADE} Grand Arcade orders (${dates.length} days)`
      : `Synced ${totalAll} orders across ${dates.length} days`
    setPrestoProgress(summary)
    keys.forEach((k) => setMessages((p) => ({ ...p, [k]: summary })))
    fetchLogs()
  }

  const fetchLogs = async () => {
    const l = await getSyncLogs()
    setLogs(l as SyncLog[])
  }

  useEffect(() => { fetchLogs() }, [])

  const run = async <T extends { success: boolean; error?: string; count?: number; orders?: number; items?: number }>(
    key: string,
    fn: () => Promise<T>,
    formatMsg?: (result: T) => string,
  ) => {
    setLoading((p) => ({ ...p, [key]: true }))
    setMessages((p) => ({ ...p, [key]: "" }))
    try {
      const result = await fn()
      if (result.success) {
        const msg = formatMsg ? formatMsg(result) : `Synced ${result.count ?? result.orders ?? 0} records successfully`
        setMessages((p) => ({ ...p, [key]: msg }))
      } else {
        setMessages((p) => ({ ...p, [key]: `Error: ${result.error}` }))
      }
    } catch (e) {
      setMessages((p) => ({ ...p, [key]: `Error: ${e instanceof Error ? e.message : "Unknown"}` }))
    } finally {
      setLoading((p) => ({ ...p, [key]: false }))
      fetchLogs()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Data Sync</h1>
        <p className="text-sm text-muted-foreground">Pull live data from Google Sheets, Presto and Shipday into the dashboard</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Google Sheets */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                <Sheet className="size-4 text-[oklch(0.7_0.15_150)]" />
              </div>
              <div>
                <CardTitle className="text-sm">Google Sheets</CardTitle>
                <CardDescription className="text-xs">Item costing & pricing</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Pulls item names, cost prices, and selling prices from your live Google Sheet. Updates profit calculations across the dashboard.
            </p>
            <Button
              size="sm"
              onClick={() => run("sheets", syncGoogleSheets)}
              disabled={loading.sheets}
              className="w-full"
            >
              <RefreshCw className={`size-3.5 mr-2 ${loading.sheets ? "animate-spin" : ""}`} />
              {loading.sheets ? "Syncing..." : "Sync Now"}
            </Button>
            {messages.sheets && (
              <p className={`text-xs ${messages.sheets.startsWith("Error") ? "text-destructive" : "text-[oklch(0.7_0.15_150)]"}`}>
                {messages.sheets}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Presto */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                <Database className="size-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm">Presto POS</CardTitle>
                <CardDescription className="text-xs">Orders & item sales</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Date range</label>
                <span className="text-xs text-muted-foreground">
                  {getDayCount()} day{getDayCount() !== 1 ? "s" : ""}
                  {getDayCount() > 7 && <span className="text-warning ml-1">— may be slow</span>}
                </span>
              </div>
              <div className="flex gap-2">
                <Input type="date" value={prestoStartDate} onChange={(e) => setPrestoStartDate(e.target.value)} className="h-8 text-xs" />
                <Input type="date" value={prestoEndDate} onChange={(e) => setPrestoEndDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <p className="text-[10px] text-muted-foreground">
                ~{getDayCount() * 13}s estimated ({getDayCount() * 13 > 60 ? `${Math.ceil(getDayCount() * 13 / 60)} min` : `${getDayCount() * 13}s`})
              </p>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={loading.presto_hp || loading.presto_ga}
              onClick={() => runPrestoRange("BOTH")}
            >
              <RefreshCw className={`size-3.5 mr-2 ${(loading.presto_hp || loading.presto_ga) ? "animate-spin" : ""}`} />
              {(loading.presto_hp || loading.presto_ga) ? prestoProgress || "Syncing..." : "Sync Both Locations"}
            </Button>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={loading.presto_hp || loading.presto_ga}
                onClick={() => runPrestoRange("HYDE_PARK")}
              >
                Hyde Park only
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={loading.presto_hp || loading.presto_ga}
                onClick={() => runPrestoRange("GRAND_ARCADE")}
              >
                Grand Arcade only
              </Button>
            </div>
            {prestoProgress && (
              <p className={`text-xs ${prestoProgress.startsWith("Error") ? "text-destructive" : (loading.presto_hp || loading.presto_ga) ? "text-muted-foreground animate-pulse" : "text-[oklch(0.7_0.15_150)]"}`}>
                {prestoProgress}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Shipday */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                <Truck className="size-4 text-[oklch(0.6_0.15_200)]" />
              </div>
              <div>
                <CardTitle className="text-sm">Shipday</CardTitle>
                <CardDescription className="text-xs">Delivery & driver data</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground">Date range</label>
              <div className="flex gap-2">
                <Input type="date" value={shipdayStart} onChange={(e) => setShipdayStart(e.target.value)} className="h-8 text-xs" />
                <Input type="date" value={shipdayEnd} onChange={(e) => setShipdayEnd(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => run("shipday", () => syncShipdayData(shipdayStart, shipdayEnd))}
              disabled={loading.shipday}
              className="w-full"
            >
              <RefreshCw className={`size-3.5 mr-2 ${loading.shipday ? "animate-spin" : ""}`} />
              {loading.shipday ? "Syncing..." : "Sync Deliveries"}
            </Button>
            {messages.shipday && (
              <p className={`text-xs ${messages.shipday.startsWith("Error") ? "text-destructive" : "text-[oklch(0.7_0.15_150)]"}`}>
                {messages.shipday}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Normalisation row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Costing sheet → dim_costing_item */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                <Sheet className="size-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm">Item Costing (canonical)</CardTitle>
                <CardDescription className="text-xs">Sync sheet → dim_costing_item</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Pulls the "Item Costing" tab and upserts every canonical item name + cost
              into the normalisation table. Run this whenever you update the sheet.
            </p>
            <Button
              size="sm"
              onClick={() => run("costing_sheet", syncCostingSheet)}
              disabled={loading.costing_sheet}
              className="w-full"
            >
              <RefreshCw className={`size-3.5 mr-2 ${loading.costing_sheet ? "animate-spin" : ""}`} />
              {loading.costing_sheet ? "Syncing…" : "Sync Costing Sheet"}
            </Button>
            {messages.costing_sheet && (
              <p className={`text-xs ${messages.costing_sheet.startsWith("Error") ? "text-destructive" : "text-[oklch(0.7_0.15_150)]"}`}>
                {messages.costing_sheet}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Normalise order_items → item_alias */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-secondary flex items-center justify-center">
                <GitMerge className="size-4 text-[oklch(0.6_0.15_200)]" />
              </div>
              <div>
                <CardTitle className="text-sm">Normalise Item Names</CardTitle>
                <CardDescription className="text-xs">Build item_alias from POS data</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Scans all POS item names, decodes pizza abbreviations, matches to canonical
              names, and populates the review queue with anything that needs human sign-off.
              Run after every Presto sync.
            </p>
            <Button
              size="sm"
              onClick={() => run(
                "normalise",
                normaliseOrderItems as () => Promise<{ success: boolean; error?: string; total?: number; matched?: number; modifier?: number; inReview?: number }>,
                (r) => `Processed ${r.total ?? 0} item names — ${r.matched ?? 0} matched, ${r.modifier ?? 0} modifiers, ${r.inReview ?? 0} sent to review queue`,
              )}
              disabled={loading.normalise}
              className="w-full"
            >
              <RefreshCw className={`size-3.5 mr-2 ${loading.normalise ? "animate-spin" : ""}`} />
              {loading.normalise ? "Normalising…" : "Run Normalisation"}
            </Button>
            {messages.normalise && (
              <p className={`text-xs ${messages.normalise.startsWith("Error") ? "text-destructive" : "text-[oklch(0.7_0.15_150)]"}`}>
                {messages.normalise}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Danger Zone — Clear Data */}
      <Card className="border-destructive/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-destructive/10 flex items-center justify-center">
              <Trash2 className="size-4 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-sm text-destructive">Clear Synced Data</CardTitle>
              <CardDescription className="text-xs">Remove data to start fresh — cannot be undone</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>Clearing data is permanent. The costing sheet (171 items) and confirmed name mappings are <strong>never deleted</strong> — only the raw order/delivery records from Presto and Shipday are removed. Re-sync after clearing.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              { scope: "orders" as const, label: "Clear Orders", desc: "Removes all orders and order items from Presto. Delivery data kept.", danger: false },
              { scope: "deliveries" as const, label: "Clear Deliveries", desc: "Removes all Shipday delivery records. Order data kept.", danger: false },
              { scope: "all" as const, label: "Clear Everything", desc: "Removes all orders, items, deliveries and resets item aliases. Costing sheet kept.", danger: true },
            ]).map(({ scope, label, desc, danger }) => (
              <div key={scope} className={`flex flex-col gap-2 p-3 rounded-lg border ${danger ? "border-destructive/50 bg-destructive/5" : "border-border bg-secondary/40"}`}>
                <p className="text-xs font-medium text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
                {clearConfirm === scope ? (
                  <div className="flex gap-2 mt-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1 h-7 text-xs"
                      disabled={loading[`clear_${scope}`]}
                      onClick={async () => {
                        setLoading((p) => ({ ...p, [`clear_${scope}`]: true }))
                        setClearMsg("")
                        try {
                          const r = await clearSyncData(scope)
                          setClearMsg(r.success ? `${label} completed.` : `Error: ${r.error}`)
                          fetchLogs()
                        } finally {
                          setLoading((p) => ({ ...p, [`clear_${scope}`]: false }))
                          setClearConfirm(null)
                        }
                      }}
                    >
                      {loading[`clear_${scope}`] ? "Clearing…" : "Confirm — delete"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setClearConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant={danger ? "destructive" : "outline"}
                    className="h-7 text-xs mt-1"
                    onClick={() => setClearConfirm(scope)}
                  >
                    <Trash2 className="size-3 mr-1.5" />
                    {label}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {clearMsg && (
            <p className={`text-xs ${clearMsg.startsWith("Error") ? "text-destructive" : "text-[oklch(0.7_0.15_150)]"}`}>
              {clearMsg}
            </p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Sync Logs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Sync History</CardTitle>
            <Button size="sm" variant="ghost" onClick={fetchLogs} className="text-xs h-7">
              <RefreshCw className="size-3 mr-1" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No sync history yet</p>
          ) : (
            <div className="flex flex-col gap-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  {log.status === "success" ? (
                    <CheckCircle className="size-4 text-[oklch(0.7_0.15_150)] shrink-0" />
                  ) : (
                    <XCircle className="size-4 text-destructive shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium capitalize">{log.source.replace("_", " ")}</span>
                      {log.location && <Badge variant="outline" className="text-[10px]">{log.location}</Badge>}
                      <Badge variant={log.status === "success" ? "secondary" : "destructive"} className="text-[10px]">
                        {log.status}
                      </Badge>
                    </div>
                    {log.errorMessage && (
                      <p className="text-xs text-destructive mt-0.5 truncate">{log.errorMessage}</p>
                    )}
                    {log.status === "success" && (
                      <p className="text-xs text-muted-foreground mt-0.5">{log.recordsProcessed} records processed</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Clock className="size-3" />
                    {format(new Date(log.syncedAt), "dd MMM HH:mm")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
