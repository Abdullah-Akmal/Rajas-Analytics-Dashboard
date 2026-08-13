"use client"

import { useState, useEffect, Fragment } from "react"
import { getOverviewKPIs, getDailyRevenueTrend, getPlatformPerformance, getCategoryPerformance, getRevenueHeatmap, getItemProfitability } from "@/app/actions/dashboard"
import { KpiCard } from "@/components/kpi-card"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, PieChart, Pie, Cell, Tooltip, Legend } from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { format, subDays } from "date-fns"
import { PoundSterling, ShoppingBag, TrendingUp, Percent, Package, Truck } from "lucide-react"

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--color-chart-1)" },
  orders: { label: "Orders", color: "var(--color-chart-2)" },
  profit: { label: "Profit", color: "var(--color-chart-3)" },
  totalRevenue: { label: "Total", color: "var(--color-chart-1)" },
  hydeParkRevenue: { label: "Hyde Park", color: "var(--color-chart-2)" },
  grandArcadeRevenue: { label: "Grand Arcade", color: "var(--color-chart-4)" },
}

export default function DashboardPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
  })
  const [kpis, setKpis] = useState<Record<string, number> | null>(null)
  const [trend, setTrend] = useState<unknown[]>([])
  const [platforms, setPlatforms] = useState<unknown[]>([])
  const [categories, setCategories] = useState<unknown[]>([])
  const [items, setItems] = useState<Awaited<ReturnType<typeof getItemProfitability>>>([])
  const [heatmap, setHeatmap] = useState<{ dow: number; hour: number; revenue: number; orders: number }[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [k, t, p, c, h, it] = await Promise.all([
        getOverviewKPIs(f.startDate, f.endDate, f.location, f.channel),
        getDailyRevenueTrend(f.startDate, f.endDate, f.location, f.channel),
        getPlatformPerformance(f.startDate, f.endDate, f.location, f.channel),
        getCategoryPerformance(f.startDate, f.endDate, f.location, f.channel),
        getRevenueHeatmap(f.startDate, f.endDate, f.location, f.channel),
        getItemProfitability(f.startDate, f.endDate, f.location, f.channel),
      ])
      setKpis(k as Record<string, number>)
      setTrend(t)
      setPlatforms(p)
      setCategories(c)
      setHeatmap(h as { dow: number; hour: number; revenue: number; orders: number }[])
      setItems(it)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const handleFilterChange = (f: typeof filters) => {
    setFilters(f)
    fetchData(f)
  }

  const fmt = (n: number | undefined | null) => n ? `£${Number(n).toFixed(2)}` : "£0.00"
  const fmtN = (n: number | undefined | null) => n ? Number(n).toLocaleString() : "0"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Overview</h1>
        <p className="text-sm text-muted-foreground">Revenue, profitability and performance at a glance</p>
      </div>

      <DateLocationFilter onFilterChange={handleFilterChange} />

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard
            title="Total Revenue"
            value={fmt(kpis?.totalRevenue)}
            icon={<PoundSterling className="size-4" />}
            accent="default"
          />
          <KpiCard
            title="Total Orders"
            value={fmtN(kpis?.totalOrders)}
            icon={<ShoppingBag className="size-4" />}
          />
          <KpiCard
            title="Avg Order Value"
            value={fmt(kpis?.avgOrderValue)}
            icon={<TrendingUp className="size-4" />}
          />
          <KpiCard
            title="Gross Profit"
            value={fmt(kpis?.totalRevenue && kpis?.totalCost ? kpis.totalRevenue - kpis.totalCost : kpis?.totalRevenue)}
            icon={<Percent className="size-4" />}
            accent="success"
          />
          <KpiCard
            title="Items Sold"
            value={fmtN(kpis?.totalItemsSold)}
            icon={<Package className="size-4" />}
          />
          <KpiCard
            title="Total Discounts"
            value={fmt(kpis?.totalDiscount)}
            icon={<Truck className="size-4" />}
            accent="warning"
          />
        </div>
      )}

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Daily Revenue Trend</CardTitle>
            <CardDescription className="text-xs">Revenue over selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : trend.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data — sync Presto data first
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <LineChart data={trend as Record<string, unknown>[]}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {filters.location === "all" ? (
                    <>
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="hydeParkRevenue" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} name="Hyde Park" />
                      <Line type="monotone" dataKey="grandArcadeRevenue" stroke="var(--color-chart-4)" strokeWidth={2} dot={false} name="Grand Arcade" />
                    </>
                  ) : (
                    <Line type="monotone" dataKey="totalRevenue" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Revenue" />
                  )}
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Platform Breakdown</CardTitle>
            <CardDescription className="text-xs">Revenue share by order channel</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : platforms.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data — sync Presto data first
              </div>
            ) : (() => {
              // Aggregate by platform (same logic as platforms page)
              const byPlatform = (platforms as Record<string, unknown>[]).reduce((acc: Record<string, { platform: string; totalRevenue: number; totalOrders: number }>, row) => {
                const key = row.platform as string
                if (!acc[key]) acc[key] = { platform: key, totalRevenue: 0, totalOrders: 0 }
                acc[key].totalRevenue += Number(row.totalRevenue)
                acc[key].totalOrders += Number(row.totalOrders)
                return acc
              }, {})
              const platformList = Object.values(byPlatform)
              const totalRev = platformList.reduce((s, p) => s + p.totalRevenue, 0)
              return (
                <div className="flex items-center gap-4 h-48">
                  <PieChart width={160} height={160}>
                    <Pie data={platformList} dataKey="totalRevenue" nameKey="platform" cx="50%" cy="50%" outerRadius={70}>
                      {platformList.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`£${Number(value).toFixed(0)} · ${totalRev > 0 ? ((Number(value) / totalRev) * 100).toFixed(1) : 0}%`, name]}
                      contentStyle={{ fontSize: 11, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}
                      labelStyle={{ display: "none" }}
                    />
                  </PieChart>
                  <div className="flex flex-col gap-2 flex-1">
                    {platformList.sort((a, b) => b.totalRevenue - a.totalRevenue).map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="size-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="capitalize font-medium">{p.platform}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">£{p.totalRevenue.toFixed(0)}</span>
                          <span className="text-muted-foreground text-[10px]">{totalRev > 0 ? ((p.totalRevenue / totalRev) * 100).toFixed(1) : 0}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Category Revenue</CardTitle>
            <CardDescription className="text-xs">Revenue share by menu category</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : categories.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data — sync data first
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <PieChart width={160} height={160}>
                  <Pie
                    data={(categories as Record<string, unknown>[])
                      .map((c) => ({ category: c.category, totalRevenue: Number(c.totalRevenue) }))
                      .sort((a, b) => b.totalRevenue - a.totalRevenue)
                      .slice(0, 5)}
                    dataKey="totalRevenue"
                    nameKey="category"
                    cx={80}
                    cy={80}
                    outerRadius={72}
                    innerRadius={40}
                    paddingAngle={2}
                  >
                    {(categories as Record<string, unknown>[]).slice(0, 5).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: unknown, name: unknown) => [`£${Number(v).toFixed(2)}`, name as string]} />
                </PieChart>
                <div className="flex flex-col gap-1.5 flex-1">
                  {(categories as Record<string, unknown>[])
                    .slice()
                    .sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue))
                    .slice(0, 5)
                    .map((cat, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="size-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span className="text-foreground">{cat.category as string}</span>
                        </div>
                        <span className="text-muted-foreground">£{Number(cat.totalRevenue).toFixed(0)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Top Items by Gross Profit</CardTitle>
            <CardDescription className="text-xs">Top 10 items by gross profit £ (revenue − cost · costed items only)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : items.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data — sync data first
              </div>
            ) : (() => {
              // Aggregate by item name — the action groups by name+category+type, so the
              // same item can appear in multiple rows (e.g. "Spicy Rice" across categories).
              // Sum them into one entry before ranking so each item shows up once.
              const agg = new Map<string, { revenue: number; cost: number; profit: number }>()
              for (const i of items) {
                const cost = Number(i.totalCost)
                if (cost <= 0) continue // exclude uncosted items — their "profit" is just revenue
                const prev = agg.get(i.itemName) ?? { revenue: 0, cost: 0, profit: 0 }
                prev.revenue += Number(i.totalRevenue)
                prev.cost += cost
                prev.profit += Number(i.grossProfit)
                agg.set(i.itemName, prev)
              }
              const chartItems = [...agg.entries()]
                .map(([name, v]) => ({
                  itemName: name.length > 20 ? name.substring(0, 20) + "…" : name,
                  fullName: name,
                  grossProfit: v.profit,
                  totalRevenue: v.revenue,
                  marginPercent: v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0,
                }))
                .filter((i) => i.grossProfit > 0)
                .sort((a, b) => b.grossProfit - a.grossProfit)
                .slice(0, 10)
              if (chartItems.length === 0) {
                return (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm text-center px-4">
                    No costed items in this period — sync the costing sheet and run normalisation
                  </div>
                )
              }
              return (
                <ChartContainer config={chartConfig} className="h-48 w-full">
                  <BarChart data={chartItems} layout="vertical" margin={{ left: 4, right: 4 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                    <YAxis type="category" dataKey="itemName" tick={{ fontSize: 9 }} width={130} />
                    <ChartTooltip
                      content={({ payload }) => payload?.[0] ? (
                        <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow">
                          <p className="font-semibold">{payload[0].payload.fullName}</p>
                          <p className="text-muted-foreground">Gross profit: £{payload[0].payload.grossProfit.toFixed(2)}</p>
                          <p className="text-muted-foreground">Revenue: £{payload[0].payload.totalRevenue.toFixed(2)}</p>
                          <p className="text-muted-foreground">Margin: {payload[0].payload.marginPercent.toFixed(1)}%</p>
                        </div>
                      ) : null}
                    />
                    <Bar dataKey="grossProfit" fill="var(--color-chart-3)" radius={4} name="Gross Profit £" />
                  </BarChart>
                </ChartContainer>
              )
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Revenue Heatmap — day × hour */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-sm font-semibold">Sales Heatmap — Hour × Day</CardTitle>
          <CardDescription className="text-xs">Order count by hour (rows) and weekday (columns), UK time — spot peak windows for staffing & offers</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <Skeleton className="h-56 w-full" /> : heatmap.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No timestamped sales — re-sync Presto</div>
          ) : (() => {
            // Columns = weekdays (Mon → Sun); DOW values from Postgres EXTRACT(DOW): Sun=0..Sat=6
            const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            const DAY_DOW = [1, 2, 3, 4, 5, 6, 0]
            // Rows = trading window in order: 11:00 → 04:00 next day
            const HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4]
            const map = new Map<string, { rev: number; ord: number }>()
            let maxOrd = 0
            for (const c of heatmap) {
              const ord = Number(c.orders)
              map.set(`${c.dow}-${c.hour}`, { rev: Number(c.revenue), ord })
              if (ord > maxOrd) maxOrd = ord
            }
            // Full clock label, e.g. 11 AM, 12 PM, 1 PM, 12 AM
            const fmtH = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`
            return (
              <div className="min-w-[380px]">
                <div className="grid" style={{ gridTemplateColumns: `56px repeat(${DAY_LABELS.length}, 1fr)` }}>
                  <div />
                  {DAY_LABELS.map((day) => (
                    <div key={day} className="text-[10px] font-medium text-muted-foreground text-center pb-1">{day}</div>
                  ))}
                  {HOURS.map((h) => (
                    <Fragment key={h}>
                      <div className="text-[10px] text-muted-foreground flex items-center justify-end pr-2">{fmtH(h)}</div>
                      {DAY_DOW.map((dow, i) => {
                        const cell = map.get(`${dow}-${h}`)
                        const ord = cell?.ord ?? 0
                        const rev = cell?.rev ?? 0
                        const intensity = maxOrd > 0 ? ord / maxOrd : 0
                        return (
                          <div
                            key={dow}
                            title={`${DAY_LABELS[i]} ${fmtH(h)} — ${ord} ${ord === 1 ? "order" : "orders"} · £${rev.toFixed(2)}`}
                            className="aspect-square m-[1px] rounded-sm flex items-center justify-center"
                            style={{
                              background: ord > 0 ? `color-mix(in oklab, var(--color-chart-1) ${Math.round(15 + intensity * 85)}%, transparent)` : "var(--secondary)",
                            }}
                          >
                            {ord > 0 && <span className="text-[9px] text-foreground/80">{ord}</span>}
                          </div>
                        )
                      })}
                    </Fragment>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-muted-foreground">
                  <span>Fewer</span>
                  {[0.15, 0.4, 0.65, 0.9].map((i) => (
                    <span key={i} className="size-3 rounded-sm" style={{ background: `color-mix(in oklab, var(--color-chart-1) ${Math.round(i * 100)}%, transparent)` }} />
                  ))}
                  <span>More orders</span>
                </div>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      {/* Quick Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Locations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {["Hyde Park", "Grand Arcade"].map((loc) => (
              <div key={loc} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary">
                <div className="size-2 rounded-full bg-[oklch(0.7_0.15_150)]" />
                <span className="text-xs font-medium text-foreground">{loc}</span>
                <Badge variant="outline" className="text-[10px]">Active</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
