"use client"

import { useState, useEffect } from "react"
import { getCustomerInsights } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { format, subDays } from "date-fns"
import { Users, Star, RefreshCw, PoundSterling, TrendingUp } from "lucide-react"

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"]

const chartConfig = {
  new: { label: "New", color: "var(--color-chart-1)" },
  returning: { label: "Returning", color: "var(--color-chart-2)" },
  loyal: { label: "Loyal", color: "var(--color-chart-3)" },
}

type CustomerRow = {
  customerId: string | null
  orderCount: number
  totalSpend: number
  avgOrderValue: number
  firstOrder: string
  lastOrder: string
  platform: string
}

type Summary = {
  totalCustomers: number
  newCustomers: number
  returning: number
  loyal: number
  totalRevenue: number
  loyalRevenue: number
  avgOrdersPerCustomer: number
  avgSpendPerCustomer: number
}

export default function CustomersPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const result = await getCustomerInsights(f.startDate, f.endDate, f.location)
      setCustomers(result.customers as CustomerRow[])
      setSummary(result.summary as Summary)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const segmentData = summary ? [
    { name: "New (1 order)", value: summary.newCustomers },
    { name: "Returning (2–4)", value: summary.returning - summary.loyal },
    { name: "Loyal (5+)", value: summary.loyal },
  ] : []

  const loyalRevenuePct = summary && summary.totalRevenue > 0
    ? (summary.loyalRevenue / summary.totalRevenue) * 100
    : 0

  const top10 = [...customers].sort((a, b) => Number(b.totalSpend) - Number(a.totalSpend)).slice(0, 10)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Customer Insights</h1>
        <p className="text-sm text-muted-foreground">Customer segmentation and behaviour analysis</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Customers", value: summary ? summary.totalCustomers.toLocaleString() : "—", icon: <Users className="size-4" /> },
          { label: "Loyal Customers (5+)", value: summary ? summary.loyal.toLocaleString() : "—", icon: <Star className="size-4" /> },
          { label: "Avg Orders / Customer", value: summary ? Number(summary.avgOrdersPerCustomer).toFixed(1) : "—", icon: <RefreshCw className="size-4" /> },
          { label: "Avg Spend / Customer", value: summary ? `£${Number(summary.avgSpendPerCustomer).toFixed(2)}` : "—", icon: <PoundSterling className="size-4" /> },
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

      {/* Segmentation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Customer Segments</CardTitle>
            <CardDescription className="text-xs">New vs Returning vs Loyal</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : segmentData.every(s => s.value === 0) ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No customer data — ensure Presto tracks customer IDs</div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={segmentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} innerRadius={36}>
                      {segmentData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [v, "Customers"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-3 flex-1">
                  {segmentData.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="size-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span>{s.name}</span>
                      </div>
                      <span className="font-semibold text-foreground">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue by Segment</CardTitle>
            <CardDescription className="text-xs">Loyal customers revenue contribution</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : !summary ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <div className="flex flex-col gap-4 pt-2">
                <div className="p-4 rounded-lg bg-secondary flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Loyal customer revenue (5+ orders)</p>
                    <p className="text-2xl font-bold text-foreground mt-0.5">£{Number(summary.loyalRevenue).toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">of total revenue</p>
                    <p className={`text-2xl font-bold mt-0.5 ${loyalRevenuePct >= 40 ? "text-[oklch(0.7_0.15_150)]" : "text-primary"}`}>
                      {loyalRevenuePct.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <ChartContainer config={chartConfig} className="h-24 w-full">
                  <BarChart data={[
                    { segment: "New", revenue: summary.totalRevenue - summary.loyalRevenue - (summary.returning - summary.loyal) * summary.avgSpendPerCustomer },
                    { segment: "Returning", revenue: (summary.returning - summary.loyal) * summary.avgSpendPerCustomer },
                    { segment: "Loyal", revenue: summary.loyalRevenue },
                  ]}>
                    <XAxis dataKey="segment" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="revenue" radius={4} name="Revenue">
                      {[0, 1, 2].map((i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top Customers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            Top 10 Customers by Spend
          </CardTitle>
          <CardDescription className="text-xs">Highest-value customers in selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : top10.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No customer data yet — requires Presto customer ID tracking</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">Customer ID</TableHead>
                  <TableHead className="text-xs text-right">Orders</TableHead>
                  <TableHead className="text-xs text-right">Total Spend</TableHead>
                  <TableHead className="text-xs text-right">Avg Order</TableHead>
                  <TableHead className="text-xs">First Order</TableHead>
                  <TableHead className="text-xs">Last Order</TableHead>
                  <TableHead className="text-xs">Platform</TableHead>
                  <TableHead className="text-xs">Segment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top10.map((c, i) => {
                  const count = Number(c.orderCount)
                  const segment = count >= 5 ? "Loyal" : count >= 2 ? "Returning" : "New"
                  const segVariant = segment === "Loyal" ? "default" : segment === "Returning" ? "secondary" : "outline"
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {c.customerId ? `...${c.customerId.slice(-6)}` : "Anonymous"}
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium">{count}</TableCell>
                      <TableCell className="text-xs text-right font-semibold text-foreground">£{Number(c.totalSpend).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">£{Number(c.avgOrderValue).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.firstOrder}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.lastOrder}</TableCell>
                      <TableCell className="text-xs capitalize">{c.platform}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={segVariant} className="text-[10px]">{segment}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
