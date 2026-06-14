"use client"

import { useState, useEffect } from "react"
import { getHourlyDemandHeatmap, getModeBreakdown } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { format, subDays } from "date-fns"
import { TrendingUp, ShoppingBag } from "lucide-react"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartConfig = {
  totalOrders: { label: "Orders", color: "var(--color-chart-1)" },
  totalRevenue: { label: "Revenue", color: "var(--color-chart-2)" },
  avgOrderValue: { label: "Avg Order", color: "var(--color-chart-3)" },
}

type DailyRow = {
  date: string
  location: string
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  mode: string | null
}

type DowRow = {
  dayOfWeek: number
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
}

type ModeRow = {
  mode: string
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  totalDiscount: number
}

export default function DemandPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [dowBreakdown, setDowBreakdown] = useState<DowRow[]>([])
  const [modes, setModes] = useState<ModeRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [h, m] = await Promise.all([
        getHourlyDemandHeatmap(f.startDate, f.endDate, f.location),
        getModeBreakdown(f.startDate, f.endDate, f.location),
      ])
      setDaily(h.daily as DailyRow[])
      setDowBreakdown(h.dowBreakdown as DowRow[])
      setModes(m as ModeRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  // Aggregate daily by date (across modes)
  const dailyAgg = Object.values(
    daily.reduce((acc: Record<string, { date: string; totalOrders: number; totalRevenue: number }>, row) => {
      if (!acc[row.date]) acc[row.date] = { date: row.date, totalOrders: 0, totalRevenue: 0 }
      acc[row.date].totalOrders += Number(row.totalOrders)
      acc[row.date].totalRevenue += Number(row.totalRevenue)
      return acc
    }, {})
  ).sort((a, b) => a.date.localeCompare(b.date))

  const dowData = DAYS.map((day, i) => {
    const found = dowBreakdown.find((d) => Number(d.dayOfWeek) === i)
    return { day, totalOrders: found ? Number(found.totalOrders) : 0, totalRevenue: found ? Number(found.totalRevenue) : 0 }
  })

  const peakDay = [...dowData].sort((a, b) => b.totalOrders - a.totalOrders)[0]
  const totalOrders = dailyAgg.reduce((s, d) => s + d.totalOrders, 0)
  const totalRevenue = dailyAgg.reduce((s, d) => s + d.totalRevenue, 0)
  const avgDaily = dailyAgg.length > 0 ? totalOrders / dailyAgg.length : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Hourly Demand & Operations</h1>
        <p className="text-sm text-muted-foreground">Day-of-week patterns, order modes, and revenue trends</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Orders", value: totalOrders.toLocaleString(), icon: <ShoppingBag className="size-4" /> },
          { label: "Total Revenue", value: `£${totalRevenue.toFixed(2)}`, icon: <TrendingUp className="size-4" /> },
          { label: "Avg Orders/Day", value: avgDaily.toFixed(0), icon: <TrendingUp className="size-4" /> },
          { label: "Peak Day", value: peakDay?.day || "—", icon: <TrendingUp className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-bold text-foreground">{k.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Daily trend + DoW */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Daily Revenue Trend</CardTitle>
            <CardDescription className="text-xs">Revenue over selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : dailyAgg.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data — sync Presto first</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-52 w-full">
                <LineChart data={dailyAgg}>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="totalRevenue" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Revenue" />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Orders by Day of Week</CardTitle>
            <CardDescription className="text-xs">Which days are busiest</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : (
              <ChartContainer config={chartConfig} className="h-52 w-full">
                <BarChart data={dowData}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalOrders" fill="var(--color-chart-1)" radius={4} name="Orders" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by DoW + Order Mode */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue by Day of Week</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : (
              <ChartContainer config={chartConfig} className="h-52 w-full">
                <BarChart data={dowData}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalRevenue" fill="var(--color-chart-2)" radius={4} name="Revenue" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Order Mode Split</CardTitle>
            <CardDescription className="text-xs">Delivery vs Collection vs Walk-in vs Dine-in</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : modes.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={modes} dataKey="totalOrders" nameKey="mode" cx="50%" cy="50%" outerRadius={72} innerRadius={36}>
                      {modes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [v, "Orders"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {modes.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{m.mode}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{Number(m.totalOrders).toLocaleString()}</span>
                        <Badge variant="outline" className="text-[10px]">£{Number(m.avgOrderValue).toFixed(0)} avg</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Staffing Guide */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Staffing Recommendation</CardTitle>
          <CardDescription className="text-xs">Based on day-of-week order volume patterns</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {dowData.map((d, i) => {
              const maxOrders = Math.max(...dowData.map((x) => x.totalOrders), 1)
              const intensity = d.totalOrders / maxOrders
              const staffLevel = intensity >= 0.8 ? "High" : intensity >= 0.5 ? "Medium" : "Low"
              const staffColor = intensity >= 0.8 ? "bg-destructive/20 text-destructive border-destructive/30" : intensity >= 0.5 ? "bg-[oklch(0.75_0.18_75)]/20 text-[oklch(0.75_0.18_75)] border-[oklch(0.75_0.18_75)]/30" : "bg-[oklch(0.7_0.15_150)]/20 text-[oklch(0.7_0.15_150)] border-[oklch(0.7_0.15_150)]/30"
              return (
                <div key={i} className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-center ${staffColor}`}>
                  <span className="text-xs font-semibold">{d.day}</span>
                  <span className="text-[10px]">{d.totalOrders}</span>
                  <span className="text-[10px] font-medium">{staffLevel}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
