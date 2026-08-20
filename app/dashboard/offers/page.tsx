"use client"

import { useState, useEffect } from "react"
import { getOfferAnalysis, getPlatformPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts"
import { format, subDays } from "date-fns"
import { Tag, TrendingDown, AlertTriangle, PoundSterling } from "lucide-react"

type OfferRow = Awaited<ReturnType<typeof getOfferAnalysis>>[number]

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartCfg = {
  totalDiscount: { label: "Total Discounts", color: "var(--color-chart-5)" },
  discountedOrders: { label: "Discounted Orders", color: "var(--color-chart-1)" },
  totalRevenue: { label: "Revenue", color: "var(--color-chart-2)" },
  discountRate: { label: "Discount Rate %", color: "var(--color-chart-3)" },
}

function num(v: unknown) { return Number(v ?? 0) }

export default function OffersPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
    mode: "all",
    platform: "all",
  })
  const [rows, setRows] = useState<OfferRow[]>([])
  const [platforms, setPlatforms] = useState<Awaited<ReturnType<typeof getPlatformPerformance>>>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [o, p] = await Promise.all([
        getOfferAnalysis(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform),
        getPlatformPerformance(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform),
      ])
      setRows(o)
      setPlatforms(p)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const totalRevenue = rows.reduce((s, r) => s + num(r.totalRevenue), 0)
  const totalDiscount = rows.reduce((s, r) => s + num(r.totalDiscount), 0)
  const totalOrders = rows.reduce((s, r) => s + num(r.totalOrders), 0)
  const discountedOrders = rows.reduce((s, r) => s + num(r.discountedOrders), 0)
  const discountRate = totalRevenue > 0 ? (totalDiscount / totalRevenue) * 100 : 0
  const discountedOrderPct = totalOrders > 0 ? (discountedOrders / totalOrders) * 100 : 0
  const avgDiscount = discountedOrders > 0 ? totalDiscount / discountedOrders : 0

  // By channel summary
  const byChannel = Object.values(
    rows.reduce<Record<string, { channel: string; totalDiscount: number; totalRevenue: number; discountedOrders: number; totalOrders: number }>>(
      (acc, r) => {
        const ch = r.orderChannel as string || "Unknown"
        if (!acc[ch]) acc[ch] = { channel: ch, totalDiscount: 0, totalRevenue: 0, discountedOrders: 0, totalOrders: 0 }
        acc[ch].totalDiscount += num(r.totalDiscount)
        acc[ch].totalRevenue += num(r.totalRevenue)
        acc[ch].discountedOrders += num(r.discountedOrders)
        acc[ch].totalOrders += num(r.totalOrders)
        return acc
      }, {}
    )
  ).map((c) => ({
    ...c,
    discountRate: c.totalRevenue > 0 ? +((c.totalDiscount / c.totalRevenue) * 100).toFixed(1) : 0,
    avgDiscount: c.discountedOrders > 0 ? +(c.totalDiscount / c.discountedOrders).toFixed(2) : 0,
  })).sort((a, b) => b.totalDiscount - a.totalDiscount)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Offers & Discounts</h1>
        <p className="text-sm text-muted-foreground">Discount impact analysis — understand which channels and periods carry the most discount cost</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Discount Value", value: `£${totalDiscount.toFixed(2)}`, icon: <PoundSterling className="size-4" />, danger: discountRate > 15 },
          { label: "Discount Rate", value: `${discountRate.toFixed(1)}%`, icon: <Tag className="size-4" />, danger: discountRate > 15 },
          { label: "Discounted Orders", value: `${discountedOrderPct.toFixed(1)}%`, icon: <AlertTriangle className="size-4" />, danger: discountedOrderPct > 30 },
          { label: "Avg Discount / Order", value: `£${avgDiscount.toFixed(2)}`, icon: <TrendingDown className="size-4" />, danger: false },
        ].map((k) => (
          <Card key={k.label} className={k.danger ? "border-destructive/50" : ""}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`size-9 rounded-lg flex items-center justify-center ${k.danger ? "bg-destructive/15 text-destructive" : "bg-secondary text-primary"}`}>{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-20 mt-1" /> : (
                  <p className={`text-lg font-bold ${k.danger ? "text-destructive" : "text-foreground"}`}>{k.value}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* By channel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Discount by Channel</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : (
              <ChartContainer config={chartCfg} className="h-44 w-full">
                <BarChart data={byChannel} margin={{ left: 0 }}>
                  <XAxis dataKey="channel" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={({ payload }) => payload?.[0] ? (
                    <div className="bg-popover border rounded p-2 text-xs">
                      <p className="font-medium">{payload[0].payload.channel}</p>
                      <p>Discount: £{num(payload[0].payload.totalDiscount).toFixed(2)}</p>
                      <p>Rate: {payload[0].payload.discountRate}%</p>
                    </div>
                  ) : null} />
                  <Bar dataKey="totalDiscount" radius={4} name="Discount Value">
                    {byChannel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Discount Rate % by Channel</CardTitle>
            <CardDescription className="text-xs">Discount as % of channel revenue</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : (
              <ChartContainer config={chartCfg} className="h-44 w-full">
                <BarChart data={byChannel} margin={{ left: 0 }}>
                  <XAxis dataKey="channel" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 50]} />
                  <ChartTooltip content={({ payload }) => payload?.[0] ? (
                    <div className="bg-popover border rounded p-2 text-xs">
                      <p className="font-medium">{payload[0].payload.channel}</p>
                      <p>Rate: {payload[0].payload.discountRate}%</p>
                    </div>
                  ) : null} />
                  <Bar dataKey="discountRate" radius={4} name="Discount Rate %">
                    {byChannel.map((_, i) => (
                      <Cell key={i} fill={byChannel[i].discountRate > 20 ? "var(--color-destructive, #ef4444)" : byChannel[i].discountRate > 10 ? "var(--color-chart-5)" : "var(--color-chart-3)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full channel table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Channel Discount Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : byChannel.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No discount data yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs text-right">Total Orders</TableHead>
                  <TableHead className="text-xs text-right">Discounted Orders</TableHead>
                  <TableHead className="text-xs text-right">Discount %</TableHead>
                  <TableHead className="text-xs text-right">Total Revenue</TableHead>
                  <TableHead className="text-xs text-right">Total Discount</TableHead>
                  <TableHead className="text-xs text-right">Avg Discount</TableHead>
                  <TableHead className="text-xs text-right">Discount Rate</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byChannel.map((c, i) => {
                  const ordPct = c.totalOrders > 0 ? (c.discountedOrders / c.totalOrders) * 100 : 0
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{c.channel}</TableCell>
                      <TableCell className="text-xs text-right">{c.totalOrders}</TableCell>
                      <TableCell className="text-xs text-right">{c.discountedOrders}</TableCell>
                      <TableCell className="text-xs text-right">{ordPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-xs text-right">£{c.totalRevenue.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">£{c.totalDiscount.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">£{c.avgDiscount.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <span className={c.discountRate > 20 ? "text-destructive font-semibold" : c.discountRate > 10 ? "text-[oklch(0.75_0.18_75)]" : ""}>
                          {c.discountRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.discountRate > 20 ? <Badge variant="destructive" className="text-[10px]">Reduce offers</Badge>
                          : c.discountRate > 10 ? <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Review</Badge>
                          : <Badge variant="outline" className="text-[10px]">Healthy</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {!loading && (
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Offer Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-xs">
              {discountRate > 20 && (
                <div className="flex gap-2">
                  <Badge variant="destructive" className="shrink-0 text-[10px]">Critical</Badge>
                  <span>Discount rate is {discountRate.toFixed(1)}% — above the 20% risk threshold. Identify which channels carry the highest rate and reduce promotional frequency.</span>
                </div>
              )}
              {byChannel.find((c) => c.discountRate > 25) && (
                <div className="flex gap-2">
                  <Badge variant="destructive" className="shrink-0 text-[10px]">High Risk</Badge>
                  <span><strong>{byChannel.find((c) => c.discountRate > 25)?.channel}</strong> has a {byChannel.find((c) => c.discountRate > 25)?.discountRate}% discount rate — consider removing or capping offers on this channel.</span>
                </div>
              )}
              {discountRate < 10 && (
                <div className="flex gap-2">
                  <Badge className="shrink-0 text-[10px] bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)]">Healthy</Badge>
                  <span>Discount rate is within healthy range. Focus offers on high-margin items to drive volume without impacting profitability.</span>
                </div>
              )}
              <div className="flex gap-2">
                <Badge variant="outline" className="shrink-0 text-[10px]">Strategy</Badge>
                <span>Avoid discounting STAR items. Use offers on PROMOTE items to increase their visibility and sell-through.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
