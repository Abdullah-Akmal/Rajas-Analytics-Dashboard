"use client"

import { useState, useEffect } from "react"
import { getForecastData } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, CartesianGrid, ReferenceLine, Cell } from "recharts"
import { format, addDays } from "date-fns"
import { TrendingUp, Calendar, Zap } from "lucide-react"

type ForecastData = Awaited<ReturnType<typeof getForecastData>>

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

const chartCfg = {
  avgRevenue: { label: "Avg Revenue", color: "var(--color-chart-1)" },
  avgOrders: { label: "Avg Orders", color: "var(--color-chart-2)" },
  totalRevenue: { label: "Revenue", color: "var(--color-chart-1)" },
  forecast: { label: "Forecast", color: "var(--color-chart-3)" },
}

function num(v: unknown) { return Number(v ?? 0) }

function busyLabel(revenue: number, maxRevenue: number): { label: string; color: string } {
  const pct = maxRevenue > 0 ? revenue / maxRevenue : 0
  if (pct >= 0.85) return { label: "Busy", color: "bg-destructive/20 text-destructive border-destructive/30" }
  if (pct >= 0.65) return { label: "Active", color: "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)] border-[oklch(0.38_0.1_75)]" }
  if (pct >= 0.4) return { label: "Moderate", color: "bg-secondary text-foreground border-border" }
  return { label: "Quiet", color: "bg-muted/50 text-muted-foreground border-border" }
}

export default function ForecastPage() {
  const [location, setLocation] = useState("all")
  const [data, setData] = useState<ForecastData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (loc: string) => {
    setLoading(true)
    try {
      setData(await getForecastData(loc))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(location) }, [])

  const dowStats = data?.dowStats ?? []
  const recentTrend = data?.recentTrend ?? []

  // Build a lookup map DOW → stats
  const dowMap = Object.fromEntries(dowStats.map((d) => [num(d.dayOfWeek), d]))

  // Generate next 7 days forecast
  const today = new Date()
  const next7 = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i + 1)
    const dow = date.getDay()
    const stats = dowMap[dow]
    return {
      date: format(date, "EEE d MMM"),
      dow: DOW_NAMES[dow],
      dowFull: DOW_FULL[dow],
      forecastRevenue: stats ? num(stats.avgRevenue) : 0,
      forecastOrders: stats ? num(stats.avgOrders) : 0,
      forecastAov: stats && num(stats.avgOrders) > 0 ? num(stats.avgRevenue) / num(stats.avgOrders) : num(stats?.avgAov),
    }
  })

  const maxForecast = Math.max(...next7.map((d) => d.forecastRevenue))

  // Sort DOW stats for the pattern chart
  const dowPattern = Array.from({ length: 7 }, (_, i) => {
    const stats = dowMap[i]
    return {
      day: DOW_NAMES[i],
      avgRevenue: stats ? num(stats.avgRevenue) : 0,
      avgOrders: stats ? num(stats.avgOrders) : 0,
    }
  })
  const maxDow = Math.max(...dowPattern.map((d) => d.avgRevenue))

  const totalForecastWeek = next7.reduce((s, d) => s + d.forecastRevenue, 0)
  const busiest = next7.reduce((max, d) => d.forecastRevenue > max.forecastRevenue ? d : max, next7[0])
  const quietest = next7.reduce((min, d) => d.forecastRevenue < min.forecastRevenue ? d : min, next7[0])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Forecasting</h1>
        <p className="text-sm text-muted-foreground">Simple statistical forecast based on last 8 weeks of day-of-week patterns — no ML required</p>
      </div>

      {/* Location filter only (no date for forecast) */}
      <div className="flex gap-2 flex-wrap">
        {["all", "Hyde Park", "Grand Arcade"].map((loc) => (
          <button
            key={loc}
            onClick={() => { setLocation(loc); fetchData(loc) }}
            className={`text-xs px-3 py-1.5 rounded-md border transition-all ${location === loc ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {loc === "all" ? "Both Locations" : loc}
          </button>
        ))}
      </div>

      {/* 7-day forecast summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Forecast This Week", value: loading ? "—" : `£${totalForecastWeek.toFixed(0)}`, icon: <TrendingUp className="size-4" /> },
          { label: "Busiest Day", value: loading ? "—" : busiest?.dowFull ?? "—", icon: <Calendar className="size-4" /> },
          { label: "Quietest Day", value: loading ? "—" : quietest?.dowFull ?? "—", icon: <Zap className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-24 mt-1" /> : <p className="text-lg font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Next 7 days forecast cards */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Next 7 Days Forecast</CardTitle>
          <CardDescription className="text-xs">Based on 8-week historical day-of-week averages</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {next7.map((day, i) => {
                const busy = busyLabel(day.forecastRevenue, maxForecast)
                return (
                  <div key={i} className="flex flex-col items-center p-2 rounded-lg bg-secondary gap-1">
                    <p className="text-[10px] text-muted-foreground font-medium">{day.dow}</p>
                    <p className="text-[9px] text-muted-foreground">{day.date.split(" ").slice(1).join(" ")}</p>
                    <p className="text-sm font-bold text-foreground mt-0.5">£{day.forecastRevenue.toFixed(0)}</p>
                    <p className="text-[9px] text-muted-foreground">{day.forecastOrders.toFixed(0)} orders</p>
                    <span className={`text-[9px] px-1 py-0.5 rounded border font-medium mt-0.5 ${busy.color}`}>{busy.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forecast bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">7-Day Revenue Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-44 w-full" /> : (
            <ChartContainer config={chartCfg} className="h-44 w-full">
              <BarChart data={next7} margin={{ left: 0 }}>
                <XAxis dataKey="dow" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                <ChartTooltip content={({ payload }) => payload?.[0] ? (
                  <div className="bg-popover border rounded p-2 text-xs">
                    <p className="font-medium">{payload[0].payload.date}</p>
                    <p>Forecast: £{num(payload[0].payload.forecastRevenue).toFixed(0)}</p>
                    <p className="text-muted-foreground">{num(payload[0].payload.forecastOrders).toFixed(0)} orders · £{num(payload[0].payload.forecastAov).toFixed(2)} AOV</p>
                  </div>
                ) : null} />
                <Bar dataKey="forecastRevenue" radius={4} name="Forecast Revenue">
                  {next7.map((d, i) => {
                    const busy = busyLabel(d.forecastRevenue, maxForecast)
                    return <Cell key={i} fill={busy.label === "Busy" ? "var(--color-chart-1)" : busy.label === "Active" ? "var(--color-chart-2)" : "var(--color-chart-4)"} />
                  })}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Weekly pattern (historical) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Historical Day-of-Week Pattern</CardTitle>
          <CardDescription className="text-xs">Average revenue per day over last 8 weeks — this is the basis of the forecast</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-44 w-full" /> : dowPattern.every((d) => d.avgRevenue === 0) ? (
            <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">
              No historical data yet — sync at least 4 weeks of Presto data
            </div>
          ) : (
            <ChartContainer config={chartCfg} className="h-44 w-full">
              <BarChart data={dowPattern} margin={{ left: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                <ChartTooltip content={({ payload }) => payload?.[0] ? (
                  <div className="bg-popover border rounded p-2 text-xs">
                    <p className="font-medium">{payload[0].payload.day}</p>
                    <p>Avg revenue: £{num(payload[0].payload.avgRevenue).toFixed(0)}</p>
                    <p className="text-muted-foreground">Avg orders: {num(payload[0].payload.avgOrders).toFixed(0)}</p>
                  </div>
                ) : null} />
                <Bar dataKey="avgRevenue" radius={4} name="Avg Revenue">
                  {dowPattern.map((d, i) => (
                    <Cell key={i} fill={d.avgRevenue === maxDow ? "var(--color-chart-1)" : "var(--color-chart-2)"} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Recent 30-day trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Recent 30-Day Revenue Trend</CardTitle>
          <CardDescription className="text-xs">Actual daily revenue — context for the forecast</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-44 w-full" /> : recentTrend.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">No recent data — sync Presto data first</div>
          ) : (
            <ChartContainer config={chartCfg} className="h-44 w-full">
              <LineChart data={recentTrend} margin={{ left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 8 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                <ChartTooltip content={({ payload }) => payload?.[0] ? (
                  <div className="bg-popover border rounded p-2 text-xs">
                    <p className="font-medium">{payload[0].payload.date}</p>
                    <p>£{num(payload[0].payload.totalRevenue).toFixed(2)}</p>
                    <p className="text-muted-foreground">{num(payload[0].payload.totalOrders)} orders</p>
                  </div>
                ) : null} />
                <Line type="monotone" dataKey="totalRevenue" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} name="Revenue" />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Staffing signals */}
      {!loading && next7.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Staffing Signals</CardTitle>
            <CardDescription className="text-xs">Data-driven staffing recommendations for next week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-xs">
              {busiest && (
                <div className="flex gap-2">
                  <Badge variant="destructive" className="text-[10px] shrink-0">Busy</Badge>
                  <span><strong>{busiest.dowFull}</strong> is forecast as the busiest day (£{busiest.forecastRevenue.toFixed(0)}, {busiest.forecastOrders.toFixed(0)} orders) — ensure full staffing and pre-prep.</span>
                </div>
              )}
              {quietest && quietest.forecastRevenue < maxForecast * 0.4 && (
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-[10px] shrink-0">Quiet</Badge>
                  <span><strong>{quietest.dowFull}</strong> is forecast quiet (£{quietest.forecastRevenue.toFixed(0)}) — consider reduced staffing or training shifts.</span>
                </div>
              )}
              <div className="flex gap-2">
                <Badge variant="outline" className="text-[10px] shrink-0">Note</Badge>
                <span>Forecast is based on historical averages only. Promotions, events, and weather will affect actuals — check alerts daily.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
