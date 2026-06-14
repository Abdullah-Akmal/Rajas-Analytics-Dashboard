"use client"

import { useState, useEffect } from "react"
import { syncGoogleSheets, syncPrestoData, syncShipdayData, getSyncLogs } from "@/app/actions/dashboard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { RefreshCw, CheckCircle, XCircle, Clock, Database, Sheet, Truck } from "lucide-react"
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
  const [prestoStartDate, setPrestoStartDate] = useState(format(new Date(Date.now() - 30 * 86400000), "yyyy-MM-dd"))
  const [prestoEndDate, setPrestoEndDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [shipdayStart, setShipdayStart] = useState(format(new Date(Date.now() - 30 * 86400000), "yyyy-MM-dd"))
  const [shipdayEnd, setShipdayEnd] = useState(format(new Date(), "yyyy-MM-dd"))

  // Build array of dates between start and end inclusive
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

  const runPrestoRange = async (locationKey: "HYDE_PARK" | "GRAND_ARCADE") => {
    const key = locationKey === "HYDE_PARK" ? "presto_hp" : "presto_ga"
    const dates = getDatesInRange(prestoStartDate, prestoEndDate)
    setLoading((p) => ({ ...p, [key]: true }))
    setMessages((p) => ({ ...p, [key]: `Syncing ${dates.length} days...` }))
    let totalOrders = 0
    let hadError = ""
    for (const d of dates) {
      try {
        const result = await syncPrestoData(d, locationKey)
        if (result.success) totalOrders += result.orders ?? 0
        else hadError = result.error ?? "Unknown error"
      } catch (e) {
        hadError = e instanceof Error ? e.message : "Unknown error"
      }
    }
    setLoading((p) => ({ ...p, [key]: false }))
    setMessages((p) => ({ ...p, [key]: hadError ? `Error: ${hadError}` : `Synced ${totalOrders} orders across ${dates.length} days` }))
    fetchLogs()
  }

  const fetchLogs = async () => {
    const l = await getSyncLogs()
    setLogs(l as SyncLog[])
  }

  useEffect(() => { fetchLogs() }, [])

  const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string; count?: number; orders?: number; items?: number }>) => {
    setLoading((p) => ({ ...p, [key]: true }))
    setMessages((p) => ({ ...p, [key]: "" }))
    try {
      const result = await fn()
      if (result.success) {
        const count = result.count ?? result.orders ?? 0
        setMessages((p) => ({ ...p, [key]: `Synced ${count} records successfully` }))
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
              <label className="text-xs text-muted-foreground">Date range</label>
              <div className="flex gap-2">
                <Input type="date" value={prestoStartDate} onChange={(e) => setPrestoStartDate(e.target.value)} className="h-8 text-xs" />
                <Input type="date" value={prestoEndDate} onChange={(e) => setPrestoEndDate(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={loading.presto_hp}
                onClick={() => runPrestoRange("HYDE_PARK")}
              >
                <RefreshCw className={`size-3 mr-1 ${loading.presto_hp ? "animate-spin" : ""}`} />
                {loading.presto_hp ? "Syncing..." : "Hyde Park"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={loading.presto_ga}
                onClick={() => runPrestoRange("GRAND_ARCADE")}
              >
                <RefreshCw className={`size-3 mr-1 ${loading.presto_ga ? "animate-spin" : ""}`} />
                {loading.presto_ga ? "Syncing..." : "Grand Arcade"}
              </Button>
            </div>
            {(messages.presto_hp || messages.presto_ga) && (
              <p className={`text-xs ${(messages.presto_hp || messages.presto_ga).startsWith("Error") ? "text-destructive" : "text-[oklch(0.7_0.15_150)]"}`}>
                {messages.presto_hp || messages.presto_ga}
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
