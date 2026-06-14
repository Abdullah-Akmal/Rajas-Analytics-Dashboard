"use client"

import { useState, useEffect } from "react"
import { getDailyRevenueTrend, getItemProfitability } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, BarChart, Bar } from "recharts"
import { format, subDays } from "date-fns"

const chartConfig = {
  totalRevenue: { label: "Revenue", color: "var(--color-chart-1)" },
  totalOrders: { label: "Orders", color: "var(--color-chart-2)" },
}

export default function SalesPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [trend, setTrend] = useState<unknown[]>([])
  const [items, setItems] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [t, i] = await Promise.all([
        getDailyRevenueTrend(f.startDate, f.endDate, f.location),
        getItemProfitability(f.startDate, f.endDate, f.location),
      ])
      setTrend(t)
      setItems(i)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const top10Items = [...items as Record<string, unknown>[]].sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue)).slice(0, 10)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Sales Performance</h1>
        <p className="text-sm text-muted-foreground">Daily trends, top-selling items and revenue analysis</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Daily Revenue</CardTitle>
            <CardDescription className="text-xs">Revenue trend over selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : trend.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No sales data — sync Presto first</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-52 w-full">
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
            <CardTitle className="text-sm font-semibold">Daily Orders</CardTitle>
            <CardDescription className="text-xs">Order volume trend</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : trend.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-52 w-full">
                <BarChart data={trend as Record<string, unknown>[]}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalOrders" fill="var(--color-chart-2)" radius={2} name="Orders" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Top 10 Items by Revenue</CardTitle>
          <CardDescription className="text-xs">Best selling items by total revenue generated</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48 w-full" /> : top10Items.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No item sales data yet</div>
          ) : (
            <div className="flex flex-col gap-2">
              {top10Items.map((item, i) => {
                const rev = Number((item as Record<string, unknown>).totalRevenue)
                const maxRev = Number((top10Items[0] as Record<string, unknown>).totalRevenue)
                const pct = maxRev > 0 ? (rev / maxRev) * 100 : 0
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium truncate">{(item as Record<string, unknown>).itemName as string}</span>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          <Badge variant="outline" className="text-[10px]">{Number((item as Record<string, unknown>).totalQty).toFixed(0)} sold</Badge>
                          <span className="text-xs font-semibold text-primary">£{rev.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
