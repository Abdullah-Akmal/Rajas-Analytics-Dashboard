"use client"

import { useState, useEffect } from "react"
import { getDemandPatterns, type DemandResult } from "@/lib/operations/demand"
import { DateLocationFilter, DEFAULT_RANGE_DAYS } from "@/components/date-location-filter"
import { KpiCard } from "@/components/kpi-card"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, Legend } from "recharts"
import { format, subDays } from "date-fns"
import { ShoppingBag, Clock, CalendarDays, TrendingUp } from "lucide-react"

/**
 * Hourly Demand & Order Pattern (Operations corrections §4).
 *
 * Removed on purpose: the Low/Medium/High staffing recommendation, Daily Revenue
 * Trend and Revenue by Day of Week. Staffing is parked until a real labour model
 * exists; revenue trend already lives on the Overview.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
// Two neutral series colours — store separation, not decoration.
const STORE_COLORS: Record<string, string> = {
  "Hyde Park": "var(--color-chart-1)",
  "Grand Arcade": "var(--color-chart-2)",
}
const MODE_LABEL: Record<string, string> = {
  walk_in: "Walk-in", dine_in: "Dine-in", collection: "Collection", delivery: "Delivery", unknown: "Unknown",
}

const fmtHour = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`)
const TONE: Record<string, string> = {
  good: "border-success bg-success-subtle text-foreground",
  warning: "border-warning bg-warning-subtle text-foreground",
  problem: "border-destructive bg-destructive/10 text-foreground",
  neutral: "border-border bg-secondary text-foreground",
}

export default function DemandPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), DEFAULT_RANGE_DAYS), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all", channel: "all", mode: "all", platform: "all",
    brand: "all", productType: "all", category: "all",
  })
  const [data, setData] = useState<DemandResult | null>(null)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [metric, setMetric] = useState<"orders" | "revenue">("orders")
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters, day: number | null) => {
    setLoading(true)
    try {
      const pm = { brand: f.brand, productType: f.productType, category: f.category }
      setData(await getDemandPatterns(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform, pm, day))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters, selectedDay) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stores = data?.stores ?? []
  const t = data?.totals
  // Trim the empty overnight hours so the trading day fills the chart.
  const rawHourly = data?.hourly ?? []
  const activeHours = rawHourly.filter((x) => stores.some((s) => (x[`${s}|orders`] ?? 0) > 0)).map((x) => x.hour)
  const hourly = rawHourly
    .filter((h) => activeHours.length === 0 || (h.hour >= Math.min(...activeHours) && h.hour <= Math.max(...activeHours)))
    .map((h) => ({ ...h, label: fmtHour(h.hour) }))
  const byDay = (data?.byDay ?? []).map((d) => ({ ...d, label: DAYS[d.dow] }))

  // Order mode: one compact row per mode, a column per store.
  const modeNames = [...new Set((data?.modes ?? []).map((m) => m.mode))]
  const modeTotal = (store: string) => (data?.modes ?? []).filter((m) => m.store === store).reduce((s, m) => s + m.orders, 0)
  const modeRows = modeNames
    .map((mode) => ({
      mode,
      byStore: stores.map((s) => {
        const orders = (data?.modes ?? []).find((m) => m.mode === mode && m.store === s)?.orders ?? 0
        const total = modeTotal(s)
        return { store: s, orders, pct: total > 0 ? (orders / total) * 100 : 0 }
      }),
    }))
    .sort((a, b) => b.byStore.reduce((s, x) => s + x.orders, 0) - a.byStore.reduce((s, x) => s + x.orders, 0))

  const chartConfig = Object.fromEntries(stores.map((s) => [`${s}|${metric}`, { label: s, color: STORE_COLORS[s] }]))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Hourly Demand &amp; Order Pattern</h1>
        <p className="text-sm text-muted-foreground">
          When orders arrive, on which days and through which fulfilment mode — from Presto POS orders.
        </p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f, selectedDay) }} />

      {/* ── Headline ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !t ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <KpiCard
              title="Total Orders"
              value={t.orders.toLocaleString()}
              trend={t.ordersChangePct ?? undefined}
              trendLabel={data?.isPartial ? "vs same point, prior period" : "vs prior period"}
              subValue={t.ordersChangePct === null ? "No comparable prior data" : undefined}
              icon={<ShoppingBag className="size-4" />}
            />
            <KpiCard
              title="Peak Hour"
              value={data?.peakHour != null ? `${fmtHour(data.peakHour)}–${fmtHour((data.peakHour + 1) % 24)}` : "—"}
              subValue={stores.length > 1 ? t.byStore.map((s) => `${s.store.split(" ")[0]} ${s.peakHour != null ? fmtHour(s.peakHour) : "—"}`).join(" · ") : undefined}
              icon={<Clock className="size-4" />}
            />
            <KpiCard
              title="Busiest Day"
              value={data?.busiestDow != null ? DAY_NAMES[data.busiestDow] : "—"}
              icon={<CalendarDays className="size-4" />}
            />
            <KpiCard
              title="Avg Orders / Day"
              value={t.days > 0 ? (t.orders / t.days).toFixed(0) : "—"}
              subValue={`${t.days} trading day${t.days === 1 ? "" : "s"}`}
              icon={<TrendingUp className="size-4" />}
            />
          </>
        )}
      </div>

      {/* ── Key patterns & exceptions (item 8) ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Key Patterns</CardTitle>
          <CardDescription className="text-sm">What stands out in this selection.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-20 w-full" /> : (
            <ul className="flex flex-col gap-2">
              {(data?.exceptions ?? []).map((e, i) => (
                <li key={i} className={`text-sm rounded-md border-l-4 px-3 py-2 ${TONE[e.tone]}`}>{e.text}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── One hourly demand chart, with an Orders/Revenue toggle (item 6) ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base">Hourly Demand</CardTitle>
              <CardDescription className="text-sm">
                {metric === "orders" ? "Orders" : "Sales (incl. VAT)"} by hour of day, UK time
                {stores.length > 1 ? " — each store shown separately" : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-md border border-border overflow-hidden">
                {(["orders", "revenue"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetric(m)}
                    className={`px-3 py-1 text-sm ${metric === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {m === "orders" ? "Orders" : "Revenue"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant={selectedDay === null ? "default" : "outline"} className="h-8 px-2 text-sm"
                  onClick={() => { setSelectedDay(null); fetchData(filters, null) }}>All days</Button>
                {DAYS.map((d, i) => (
                  <Button key={d} size="sm" variant={selectedDay === i ? "default" : "outline"} className="h-8 px-2 text-sm"
                    onClick={() => { setSelectedDay(i); fetchData(filters, i) }}>{d}</Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-64 w-full" /> : (t?.orders ?? 0) === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No orders in this selection.</div>
          ) : (
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={hourly}>
                <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} tickFormatter={(v) => (metric === "revenue" ? `£${v}` : `${v}`)} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {stores.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
                {stores.map((s) => (
                  <Bar key={s} dataKey={`${s}|${metric}`} name={s} fill={STORE_COLORS[s]} radius={3} />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Orders by Day of Week</CardTitle>
            <CardDescription className="text-sm">Total orders on each weekday in the period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-56 w-full" /> : (
              <ChartContainer
                config={Object.fromEntries(stores.map((s) => [`${s}|orders`, { label: s, color: STORE_COLORS[s] }]))}
                className="h-56 w-full"
              >
                <BarChart data={byDay}>
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {stores.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
                  {stores.map((s) => (
                    <Bar key={s} dataKey={`${s}|orders`} name={s} fill={STORE_COLORS[s]} radius={3} />
                  ))}
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Compact order-mode split (item 7) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Order Mode Split</CardTitle>
            <CardDescription className="text-sm">How orders are fulfilled — share of each store&apos;s orders</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : modeRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No orders.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">Mode</TableHead>
                    {stores.map((s) => <TableHead key={s} className="text-sm text-right">{s}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modeRows.map((r) => (
                    <TableRow key={r.mode}>
                      <TableCell className="text-sm font-medium">{MODE_LABEL[r.mode] ?? r.mode}</TableCell>
                      {r.byStore.map((c) => (
                        <TableCell key={c.store} className="text-sm text-right">
                          {c.orders.toLocaleString()} <span className="text-muted-foreground">({c.pct.toFixed(0)}%)</span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
