"use client"

import { useState, useEffect } from "react"
import { getPlatformPerformance, getTopItemsByPlatform } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { ChannelPerformancePanel } from "@/components/analytics/channel-performance-panel"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid, Tooltip } from "recharts"
import { format, subDays } from "date-fns"
import { ShoppingCart, PoundSterling, TrendingUp, Hash } from "lucide-react"

type PlatformRow = Awaited<ReturnType<typeof getPlatformPerformance>>[number]

const COLORS = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)",
]

const chartCfg = {
  totalRevenue: { label: "Revenue", color: "var(--color-chart-1)" },
  totalOrders: { label: "Orders", color: "var(--color-chart-2)" },
  avgOrderValue: { label: "Avg Order", color: "var(--color-chart-3)" },
  totalDiscount: { label: "Discounts", color: "var(--color-chart-5)" },
}

function num(v: unknown) { return Number(v ?? 0) }

function platformLabel(row: PlatformRow) {
  return `${row.platform}${row.mode ? ` (${row.mode})` : ""}`
}

function healthBadge(discountPct: number, aov: number, avgAov: number) {
  if (discountPct > 20) return <Badge variant="destructive" className="text-xs">High Discount</Badge>
  if (aov > avgAov * 1.1) return <Badge className="text-xs bg-success-subtle text-success">High AOV</Badge>
  return <Badge variant="outline" className="text-xs">Healthy</Badge>
}

export default function PlatformsPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 7), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
    mode: "all",
    platform: "all",
    brand: "all",
    productType: "all",
    category: "all",
  })
  const [platforms, setPlatforms] = useState<PlatformRow[]>([])
  const [topItems, setTopItems] = useState<Awaited<ReturnType<typeof getTopItemsByPlatform>>>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [p, t] = await Promise.all([
        getPlatformPerformance(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform, { brand: f.brand, productType: f.productType, category: f.category }),
        getTopItemsByPlatform(f.startDate, f.endDate, f.location, 8, f.channel, f.mode, f.platform, { brand: f.brand, productType: f.productType, category: f.category }),
      ])
      setPlatforms(p as PlatformRow[])
      setTopItems(t)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  // Aggregate by platform name (collapse modes)
  const byPlatform = Object.values(
    platforms.reduce<Record<string, { platform: string; totalOrders: number; totalRevenue: number; avgOrderValue: number; totalDiscount: number; count: number }>>((acc, row) => {
      const key = row.platform
      if (!acc[key]) acc[key] = { platform: key, totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, totalDiscount: 0, count: 0 }
      acc[key].totalOrders += num(row.totalOrders)
      acc[key].totalRevenue += num(row.totalRevenue)
      acc[key].totalDiscount += num(row.totalDiscount)
      acc[key].count++
      return acc
    }, {})
  ).map((p) => ({ ...p, avgOrderValue: p.totalOrders > 0 ? p.totalRevenue / p.totalOrders : 0 }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  const totalRevenue = byPlatform.reduce((s, p) => s + p.totalRevenue, 0)
  const totalOrders = byPlatform.reduce((s, p) => s + p.totalOrders, 0)
  const totalDiscount = byPlatform.reduce((s, p) => s + p.totalDiscount, 0)
  const avgAov = totalOrders > 0 ? totalRevenue / totalOrders : 0

  const pieData = byPlatform.map((p) => ({ name: p.platform, value: +p.totalRevenue.toFixed(2) }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Channel Performance</h1>
        <p className="text-sm text-muted-foreground">Which channels are growing — and which actually leave Raja&apos;s the most money</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* §9 primary view: one channel table with revenue, orders, AOV, mix, change
          and CONTRIBUTION — the figure the spec cares about. */}
      <ChannelPerformancePanel
        startDate={filters.startDate}
        endDate={filters.endDate}
        location={filters.location}
        brand={filters.brand}
        productType={filters.productType}
        category={filters.category}
      />

      {/* Corrections items 16-19: one Revenue by Platform chart, one Revenue Share
          chart, no duplicated KPIs or comparison tables. The Channel Comparison
          table in the panel above is the primary decision area, so the page-level
          KPI row, the AOV chart and the second comparison table were removed. */}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-base font-semibold">Revenue by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48 w-full" /> : (
              <ChartContainer config={chartCfg} className="h-48 w-full">
                <BarChart data={byPlatform} margin={{ left: 0 }}>
                  <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`£${num(v).toFixed(2)}`, "Revenue"]} />
                  <Bar dataKey="totalRevenue" radius={4} name="Revenue">
                    {byPlatform.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-base font-semibold">Revenue Share</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loading ? <Skeleton className="size-40 rounded-full" /> : (
              <>
                <PieChart width={160} height={160}>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx={80} cy={80} outerRadius={70} innerRadius={40} paddingAngle={2}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`£${Number(value).toFixed(0)} · ${totalRevenue > 0 ? ((Number(value) / totalRevenue) * 100).toFixed(1) : 0}%`, name]}
                    contentStyle={{ fontSize: 12, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}
                    labelStyle={{ display: "none" }}
                  />
                </PieChart>
                <div className="flex flex-col gap-1 w-full mt-1">
                  {pieData.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className="size-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="font-semibold">{totalRevenue > 0 ? ((p.value / totalRevenue) * 100).toFixed(1) : 0}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>


      {/* Top items sold per platform */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-base font-semibold">Top Items Sold per Platform</CardTitle>
          <CardDescription className="text-sm">Best-selling items by revenue on each order channel</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}</div>
          ) : topItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No item data in this range</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {topItems.map((p, pi) => (
                <div key={p.platform}>
                  <p className="text-sm font-semibold text-foreground mb-1 capitalize">{p.platform} <span className="text-muted-foreground font-normal">· £{p.total.toFixed(0)} total</span></p>
                  <ChartContainer config={chartCfg} className="h-56 w-full">
                    <BarChart data={p.items} layout="vertical" margin={{ left: 4, right: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `£${v}`} />
                      <YAxis type="category" dataKey="itemName" tick={{ fontSize: 12 }} width={120} tickFormatter={(v) => v.length > 18 ? v.slice(0, 18) + "…" : v} />
                      <ChartTooltip content={({ payload }) => payload?.[0] ? (
                        <div className="bg-popover border rounded p-2 text-xs">
                          <p className="font-medium">{payload[0].payload.itemName}</p>
                          <p>£{num(payload[0].payload.revenue).toFixed(2)} · {num(payload[0].payload.qty).toFixed(0)} sold</p>
                        </div>
                      ) : null} />
                      <Bar dataKey="revenue" radius={3} name="Revenue" fill={COLORS[pi % COLORS.length]} />
                    </BarChart>
                  </ChartContainer>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
