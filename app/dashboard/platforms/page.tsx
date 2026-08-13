"use client"

import { useState, useEffect } from "react"
import { getPlatformPerformance, getTopItemsByPlatform } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
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
  if (discountPct > 20) return <Badge variant="destructive" className="text-[10px]">High Discount</Badge>
  if (aov > avgAov * 1.1) return <Badge className="text-[10px] bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)]">High AOV</Badge>
  return <Badge variant="outline" className="text-[10px]">Healthy</Badge>
}

export default function PlatformsPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
  })
  const [platforms, setPlatforms] = useState<PlatformRow[]>([])
  const [topItems, setTopItems] = useState<Awaited<ReturnType<typeof getTopItemsByPlatform>>>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [p, t] = await Promise.all([
        getPlatformPerformance(f.startDate, f.endDate, f.location, f.channel),
        getTopItemsByPlatform(f.startDate, f.endDate, f.location, 8, f.channel),
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
        <h1 className="text-2xl font-bold text-foreground">Platform Performance</h1>
        <p className="text-sm text-muted-foreground">Revenue, AOV, and discount analysis by order channel</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: `£${totalRevenue.toFixed(2)}`, icon: <PoundSterling className="size-4" /> },
          { label: "Total Orders", value: totalOrders.toLocaleString(), icon: <Hash className="size-4" /> },
          { label: "Avg Order Value", value: `£${avgAov.toFixed(2)}`, icon: <TrendingUp className="size-4" /> },
          { label: "Total Discounts", value: `£${totalDiscount.toFixed(2)}`, icon: <ShoppingCart className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-20 mt-1" /> : <p className="text-lg font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Revenue by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48 w-full" /> : (
              <ChartContainer config={chartCfg} className="h-48 w-full">
                <BarChart data={byPlatform} margin={{ left: 0 }}>
                  <XAxis dataKey="platform" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
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
            <CardTitle className="text-sm font-semibold">Revenue Share</CardTitle>
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
                    contentStyle={{ fontSize: 11, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}
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

      {/* AOV comparison */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-sm font-semibold">Average Order Value by Platform</CardTitle>
          <CardDescription className="text-xs">Higher AOV = more value per transaction</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-40 w-full" /> : (
            <ChartContainer config={chartCfg} className="h-40 w-full">
              <BarChart data={byPlatform} margin={{ left: 0 }}>
                <XAxis dataKey="platform" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`£${num(v).toFixed(2)}`, "Avg Order"]} />
                <Bar dataKey="avgOrderValue" radius={4} name="Avg Order Value">
                  {byPlatform.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Top items sold per platform */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-sm font-semibold">Top Items Sold per Platform</CardTitle>
          <CardDescription className="text-xs">Best-selling items by revenue on each order channel</CardDescription>
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
                  <p className="text-xs font-semibold text-foreground mb-1 capitalize">{p.platform} <span className="text-muted-foreground font-normal">· £{p.total.toFixed(0)} total</span></p>
                  <ChartContainer config={chartCfg} className="h-56 w-full">
                    <BarChart data={p.items} layout="vertical" margin={{ left: 4, right: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `£${v}`} />
                      <YAxis type="category" dataKey="itemName" tick={{ fontSize: 9 }} width={120} tickFormatter={(v) => v.length > 18 ? v.slice(0, 18) + "…" : v} />
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

      {/* Full comparison table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Platform Comparison</CardTitle>
          <CardDescription className="text-xs">Full breakdown including detailed channel + mode splits</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs">Mode</TableHead>
                  <TableHead className="text-xs text-right">Orders</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">AOV</TableHead>
                  <TableHead className="text-xs text-right">Discounts</TableHead>
                  <TableHead className="text-xs text-right">Discount %</TableHead>
                  <TableHead className="text-xs text-right">Rev Share</TableHead>
                  <TableHead className="text-xs">Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platforms.map((row, i) => {
                  const discountPct = num(row.totalRevenue) > 0 ? (num(row.totalDiscount) / num(row.totalRevenue)) * 100 : 0
                  const revShare = totalRevenue > 0 ? (num(row.totalRevenue) / totalRevenue) * 100 : 0
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{row.platform}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.mode || "—"}</TableCell>
                      <TableCell className="text-xs text-right">{num(row.totalOrders)}</TableCell>
                      <TableCell className="text-xs text-right font-medium">£{num(row.totalRevenue).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">£{num(row.avgOrderValue).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">£{num(row.totalDiscount).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <span className={discountPct > 20 ? "text-destructive font-semibold" : discountPct > 10 ? "text-[oklch(0.75_0.18_75)]" : ""}>
                          {discountPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-right">{revShare.toFixed(1)}%</TableCell>
                      <TableCell className="text-xs">{healthBadge(discountPct, num(row.avgOrderValue), avgAov)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Strategic decisions */}
      {!loading && byPlatform.length > 1 && (
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Strategic Signals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {byPlatform[0] && (
                <div className="flex gap-2 text-xs">
                  <Badge className="text-[10px] shrink-0">Top Channel</Badge>
                  <span><strong>{byPlatform[0].platform}</strong> generates £{byPlatform[0].totalRevenue.toFixed(2)} ({totalRevenue > 0 ? ((byPlatform[0].totalRevenue / totalRevenue) * 100).toFixed(1) : 0}% of revenue) — protect and grow</span>
                </div>
              )}
              {byPlatform.find((p) => (p.totalDiscount / Math.max(p.totalRevenue, 1)) > 0.15) && (
                <div className="flex gap-2 text-xs">
                  <Badge variant="destructive" className="text-[10px] shrink-0">High Discount</Badge>
                  <span><strong>{byPlatform.find((p) => (p.totalDiscount / Math.max(p.totalRevenue, 1)) > 0.15)?.platform}</strong> has discount rate over 15% — review offer strategy</span>
                </div>
              )}
              {byPlatform.reduce((max, p) => p.avgOrderValue > max.avgOrderValue ? p : max, byPlatform[0]) !== byPlatform[0] && (
                <div className="flex gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px] shrink-0">High AOV</Badge>
                  <span><strong>{byPlatform.reduce((max, p) => p.avgOrderValue > max.avgOrderValue ? p : max, byPlatform[0]).platform}</strong> has the highest average order value — increase allocation</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
