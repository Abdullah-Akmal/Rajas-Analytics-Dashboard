"use client"

import { useState, useEffect } from "react"
import { getOverviewKPIs, getDailyRevenueTrend, getPlatformPerformance, getCategoryPerformance } from "@/app/actions/dashboard"
import { KpiCard } from "@/components/kpi-card"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Tooltip } from "recharts"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { format, subDays } from "date-fns"
import { PoundSterling, ShoppingBag, TrendingUp, Percent, Package, Truck } from "lucide-react"

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--color-chart-1)" },
  orders: { label: "Orders", color: "var(--color-chart-2)" },
  profit: { label: "Profit", color: "var(--color-chart-3)" },
}

export default function DashboardPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [kpis, setKpis] = useState<Record<string, number> | null>(null)
  const [trend, setTrend] = useState<unknown[]>([])
  const [platforms, setPlatforms] = useState<unknown[]>([])
  const [categories, setCategories] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [k, t, p, c] = await Promise.all([
        getOverviewKPIs(f.startDate, f.endDate, f.location),
        getDailyRevenueTrend(f.startDate, f.endDate, f.location),
        getPlatformPerformance(f.startDate, f.endDate, f.location),
        getCategoryPerformance(f.startDate, f.endDate, f.location),
      ])
      setKpis(k as Record<string, number>)
      setTrend(t)
      setPlatforms(p)
      setCategories(c)
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
          <CardHeader className="pb-2">
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
                  <Line type="monotone" dataKey="totalRevenue" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Revenue" />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Platform Breakdown</CardTitle>
            <CardDescription className="text-xs">Revenue by order channel</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : platforms.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data — sync Presto data first
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={platforms as Record<string, unknown>[]}>
                  <XAxis dataKey="platform" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalRevenue" fill="var(--color-chart-1)" radius={4} name="Revenue" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
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
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={categories as Record<string, unknown>[]} dataKey="totalRevenue" nameKey="category" cx="50%" cy="50%" outerRadius={80}>
                      {(categories as Record<string, unknown>[]).map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => [`£${Number(v).toFixed(2)}`, "Revenue"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1 flex-1">
                  {(categories as Record<string, unknown>[]).slice(0, 6).map((cat, i) => (
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
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Margin by Category</CardTitle>
            <CardDescription className="text-xs">Gross margin % per category</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : categories.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data — sync data first
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={categories as Record<string, unknown>[]} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={80} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="marginPercent" fill="var(--color-chart-3)" radius={4} name="Margin %" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

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
