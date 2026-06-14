"use client"

import { useState, useEffect } from "react"
import { getOfferAnalysis, getPlatformPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts"
import { format, subDays } from "date-fns"
import { Tag, TrendingDown, AlertTriangle, PoundSterling } from "lucide-react"

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartConfig = {
  totalDiscount: { label: "Discounts", color: "var(--color-chart-1)" },
  discountedOrders: { label: "Discounted Orders", color: "var(--color-chart-2)" },
  totalRevenue: { label: "Revenue", color: "var(--color-chart-3)" },
}

type OfferRow = {
  date: string
  location: string
  orderChannel: string
  totalOrders: number
  discountedOrders: number
  totalRevenue: number
  totalDiscount: number
  avgDiscount: number
}

type PlatformRow = {
  platform: string
  mode: string | null
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  totalDiscount: number
}

export default function OffersPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [platforms, setPlatforms] = useState<PlatformRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [o, p] = await Promise.all([
        getOfferAnalysis(f.startDate, f.endDate, f.location),
        getPlatformPerformance(f.startDate, f.endDate, f.location),
      ])
      setOffers(o as OfferRow[])
      setPlatforms(p as PlatformRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  // Aggregate by platform
  const byPlatform = Object.values(
    offers.reduce((acc: Record<string, { orderChannel: string; totalOrders: number; discountedOrders: number; totalDiscount: number; totalRevenue: number }>, row) => {
      const key = row.orderChannel
      if (!acc[key]) acc[key] = { orderChannel: key, totalOrders: 0, discountedOrders: 0, totalDiscount: 0, totalRevenue: 0 }
      acc[key].totalOrders += Number(row.totalOrders)
      acc[key].discountedOrders += Number(row.discountedOrders)
      acc[key].totalDiscount += Number(row.totalDiscount)
      acc[key].totalRevenue += Number(row.totalRevenue)
      return acc
    }, {})
  )

  // Daily discount trend
  const dailyTrend = Object.values(
    offers.reduce((acc: Record<string, { date: string; totalDiscount: number; discountedOrders: number }>, row) => {
      if (!acc[row.date]) acc[row.date] = { date: row.date, totalDiscount: 0, discountedOrders: 0 }
      acc[row.date].totalDiscount += Number(row.totalDiscount)
      acc[row.date].discountedOrders += Number(row.discountedOrders)
      return acc
    }, {})
  ).sort((a, b) => a.date.localeCompare(b.date))

  const totalDiscount = offers.reduce((s, o) => s + Number(o.totalDiscount), 0)
  const totalRevenue = offers.reduce((s, o) => s + Number(o.totalRevenue), 0)
  const totalOrders = offers.reduce((s, o) => s + Number(o.totalOrders), 0)
  const discountedOrders = offers.reduce((s, o) => s + Number(o.discountedOrders), 0)
  const discountRate = totalOrders > 0 ? (discountedOrders / totalOrders) * 100 : 0
  const discountAsRevPct = totalRevenue > 0 ? (totalDiscount / (totalRevenue + totalDiscount)) * 100 : 0

  // Platform discount data for pie
  const platformDiscountData = Object.values(
    platforms.reduce((acc: Record<string, { platform: string; totalDiscount: number; totalRevenue: number }>, row) => {
      if (!acc[row.platform]) acc[row.platform] = { platform: row.platform, totalDiscount: 0, totalRevenue: 0 }
      acc[row.platform].totalDiscount += Number(row.totalDiscount)
      acc[row.platform].totalRevenue += Number(row.totalRevenue)
      return acc
    }, {})
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Offers & Discounts</h1>
        <p className="text-sm text-muted-foreground">Discount impact on revenue across all platforms</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Discounts Given", value: `£${totalDiscount.toFixed(2)}`, icon: <Tag className="size-4" />, accent: "warning" },
          { label: "Discount Rate", value: `${discountRate.toFixed(1)}%`, icon: <TrendingDown className="size-4" />, accent: "default" },
          { label: "Discount vs Revenue", value: `${discountAsRevPct.toFixed(1)}%`, icon: <AlertTriangle className="size-4" />, accent: discountAsRevPct > 15 ? "destructive" : "default" },
          { label: "Discounted Orders", value: discountedOrders.toLocaleString(), icon: <PoundSterling className="size-4" />, accent: "default" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`size-9 rounded-lg flex items-center justify-center ${k.accent === "warning" ? "bg-[oklch(0.75_0.18_75)]/20 text-[oklch(0.75_0.18_75)]" : k.accent === "destructive" ? "bg-destructive/20 text-destructive" : "bg-secondary text-primary"}`}>
                {k.icon}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-bold text-foreground">{k.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Daily Discount Trend</CardTitle>
            <CardDescription className="text-xs">Total discounts given per day</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : dailyTrend.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-52 w-full">
                <LineChart data={dailyTrend}>
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="totalDiscount" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Discounts" />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Discounts by Platform</CardTitle>
            <CardDescription className="text-xs">Which platforms drive most discount spend</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : platformDiscountData.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={150} height={150}>
                  <PieChart>
                    <Pie data={platformDiscountData} dataKey="totalDiscount" nameKey="platform" cx="50%" cy="50%" outerRadius={65} innerRadius={30}>
                      {platformDiscountData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [`£${Number(v).toFixed(2)}`, "Discount"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {platformDiscountData.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{p.platform}</span>
                      </div>
                      <span className="text-muted-foreground font-medium">£{Number(p.totalDiscount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Platform Breakdown Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Discount by Platform — Detailed</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : byPlatform.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No data — sync Presto data first</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs text-right">Total Orders</TableHead>
                  <TableHead className="text-xs text-right">Discounted Orders</TableHead>
                  <TableHead className="text-xs text-right">Discount Rate</TableHead>
                  <TableHead className="text-xs text-right">Total Revenue</TableHead>
                  <TableHead className="text-xs text-right">Total Discount</TableHead>
                  <TableHead className="text-xs text-right">Discount % of Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPlatform.map((p, i) => {
                  const rate = Number(p.totalOrders) > 0 ? (Number(p.discountedOrders) / Number(p.totalOrders)) * 100 : 0
                  const pct = Number(p.totalRevenue) > 0 ? (Number(p.totalDiscount) / (Number(p.totalRevenue) + Number(p.totalDiscount))) * 100 : 0
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium capitalize">{p.orderChannel}</TableCell>
                      <TableCell className="text-xs text-right">{Number(p.totalOrders).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right">{Number(p.discountedOrders).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right">
                        <Badge variant={rate > 30 ? "destructive" : "outline"} className="text-[10px]">{rate.toFixed(1)}%</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right">£{Number(p.totalRevenue).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right text-[oklch(0.75_0.18_75)]">£{Number(p.totalDiscount).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <span className={pct > 15 ? "text-destructive font-semibold" : "text-muted-foreground"}>{pct.toFixed(1)}%</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Strategic insight */}
      {!loading && totalDiscount > 0 && (
        <Card className="border-[oklch(0.75_0.18_75)]/40 bg-[oklch(0.75_0.18_75)]/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-4 text-[oklch(0.75_0.18_75)] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Strategic Insight</p>
                <p className="text-xs text-muted-foreground mt-1">
                  You are giving away <strong className="text-foreground">£{totalDiscount.toFixed(2)}</strong> in discounts
                  ({discountAsRevPct.toFixed(1)}% of gross revenue). {discountAsRevPct > 15
                    ? "This is above the 15% threshold — review which platforms and promotions are driving this."
                    : "This is within acceptable range. Monitor weekly to ensure it stays below 15%."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
