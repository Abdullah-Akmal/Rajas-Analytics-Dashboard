"use client"

import { useState, useEffect } from "react"
import { getPlatformPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell } from "recharts"
import { format, subDays } from "date-fns"

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartConfig = {
  totalRevenue: { label: "Revenue", color: "var(--color-chart-1)" },
  totalOrders: { label: "Orders", color: "var(--color-chart-2)" },
  avgOrderValue: { label: "Avg Order", color: "var(--color-chart-3)" },
}

type PlatformRow = {
  platform: string
  mode: string | null
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  totalDiscount: number
}

export default function PlatformsPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [data, setData] = useState<PlatformRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const r = await getPlatformPerformance(f.startDate, f.endDate, f.location)
      setData(r as PlatformRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  // Aggregate by platform
  const byPlatform = data.reduce((acc: Record<string, PlatformRow>, row) => {
    const key = row.platform
    if (!acc[key]) acc[key] = { ...row, totalOrders: 0, totalRevenue: 0, totalDiscount: 0, avgOrderValue: 0 }
    acc[key].totalOrders += Number(row.totalOrders)
    acc[key].totalRevenue += Number(row.totalRevenue)
    acc[key].totalDiscount += Number(row.totalDiscount)
    return acc
  }, {})
  const platformList = Object.values(byPlatform).map((p) => ({
    ...p,
    avgOrderValue: p.totalOrders > 0 ? p.totalRevenue / p.totalOrders : 0,
  }))

  const totalRev = platformList.reduce((s, p) => s + p.totalRevenue, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Platform Analytics</h1>
        <p className="text-sm text-muted-foreground">Performance breakdown by order channel — Uber Eats, Deliveroo, JustEat, Walk-in, Phone</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48 w-full" /> : platformList.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data — sync Presto first</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={platformList}>
                  <XAxis dataKey="platform" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalRevenue" fill="var(--color-chart-1)" radius={4} name="Revenue" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Order Share by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48 w-full" /> : platformList.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <div className="flex items-center gap-4">
                <PieChart width={160} height={160}>
                  <Pie data={platformList} dataKey="totalOrders" cx="50%" cy="50%" outerRadius={70}>
                    {platformList.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                </PieChart>
                <div className="flex flex-col gap-1.5 flex-1">
                  {platformList.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{p.platform}</span>
                      </div>
                      <span className="text-muted-foreground">{totalRev > 0 ? ((p.totalRevenue / totalRev) * 100).toFixed(1) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Platform Comparison Table</CardTitle>
          <CardDescription className="text-xs">Revenue, orders, average order value and discount impact per platform</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : platformList.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No platform data yet — sync Presto data first</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs text-right">Orders</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">Avg Order</TableHead>
                  <TableHead className="text-xs text-right">Discounts</TableHead>
                  <TableHead className="text-xs text-right">Revenue Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platformList.sort((a, b) => b.totalRevenue - a.totalRevenue).map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">
                      <Badge variant="outline" className="capitalize text-[10px]">{p.platform}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right">{Number(p.totalOrders).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-right font-medium">£{Number(p.totalRevenue).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-right">£{Number(p.avgOrderValue).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-right text-destructive">-£{Number(p.totalDiscount).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-right">
                      {totalRev > 0 ? ((p.totalRevenue / totalRev) * 100).toFixed(1) : 0}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
