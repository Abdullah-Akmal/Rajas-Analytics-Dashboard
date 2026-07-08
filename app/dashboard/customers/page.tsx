"use client"

import { useState, useEffect } from "react"
import { getCustomerInsights, getWebCustomerItemsBySegment } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, Tooltip } from "recharts"
import { format, subDays } from "date-fns"
import { Users, Star, RefreshCw, PoundSterling, TrendingUp } from "lucide-react"

type Insights = Awaited<ReturnType<typeof getCustomerInsights>>
type CustomerRow = Insights["customers"][number]
type SegItems = Awaited<ReturnType<typeof getWebCustomerItemsBySegment>>

const COLORS = ["var(--color-chart-3)", "var(--color-chart-1)", "var(--color-chart-4)", "var(--color-destructive, #ef4444)"]

const chartCfg = {
  orderCount: { label: "Orders", color: "var(--color-chart-1)" },
  totalSpend: { label: "Spend", color: "var(--color-chart-2)" },
}

function num(v: unknown) { return Number(v ?? 0) }

// Frequency-based segments for identified web customers. No recency/value RFM here — the
// cohort is small and delivery orders are excluded, so honest frequency buckets are clearer.
function webSegment(orderCount: number): { label: string; color: string } {
  if (orderCount >= 3) return { label: "Regular", color: "bg-[oklch(0.25_0.1_50)] text-[oklch(0.8_0.2_50)] border-[oklch(0.4_0.1_50)]" }
  if (orderCount === 2) return { label: "Returning", color: "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]" }
  return { label: "New", color: "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]" }
}

export default function CustomersPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [data, setData] = useState<Insights | null>(null)
  const [segItems, setSegItems] = useState<SegItems | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [ins, seg] = await Promise.all([
        getCustomerInsights(f.startDate, f.endDate, f.location),
        getWebCustomerItemsBySegment(f.startDate, f.endDate, f.location),
      ])
      setData(ins)
      setSegItems(seg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const summary = data?.summary
  const coverage = data?.coverage
  const customers = data?.customers ?? []

  const segmentCounts = customers.reduce<Record<string, number>>((acc, c) => {
    const seg = webSegment(num(c.orderCount)).label
    acc[seg] = (acc[seg] ?? 0) + 1
    return acc
  }, {})

  const segmentPie = Object.entries(segmentCounts).map(([name, value]) => ({ name, value }))

  // Order frequency distribution (identified web customers rarely exceed a handful of orders)
  const freqBuckets = [
    { label: "1 order", count: customers.filter((c) => num(c.orderCount) === 1).length },
    { label: "2 orders", count: customers.filter((c) => num(c.orderCount) === 2).length },
    { label: "3 orders", count: customers.filter((c) => num(c.orderCount) === 3).length },
    { label: "4+", count: customers.filter((c) => num(c.orderCount) >= 4).length },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Web Customer Behaviour</h1>
        <p className="text-sm text-muted-foreground">Repeat &amp; new-customer analysis for identified website (Wix) customers</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* Data-coverage notice — customer identity only exists for own-website orders */}
      {!loading && coverage && (
        <div className="rounded-lg border border-[oklch(0.38_0.1_75)] bg-[oklch(0.25_0.1_75)/0.15] px-4 py-3 text-xs text-[oklch(0.8_0.14_75)]">
          <span className="font-semibold">Identified web customers only.</span>{" "}
          {coverage.identifiedOrders.toLocaleString()} of {coverage.totalOrders.toLocaleString()} orders ({coverage.identifiedPct.toFixed(1)}%) come from logged-in website customers.
          Delivery-platform orders (Uber Eats, Deliveroo, Just Eat) use an anonymous per-order reference and can't be tracked as customers, so they're excluded from this report.
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Identified Customers", value: summary?.identifiedCustomers.toLocaleString() ?? "—", icon: <Users className="size-4" /> },
          { label: "New (1 order)", value: summary?.newCustomers.toLocaleString() ?? "—", icon: <RefreshCw className="size-4" /> },
          { label: "Returning (2+)", value: summary?.returning.toLocaleString() ?? "—", icon: <TrendingUp className="size-4" /> },
          { label: "Repeat Rate", value: summary ? `${num(summary.repeatRatePct).toFixed(1)}%` : "—", icon: <Star className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-16 mt-1" /> : <p className="text-lg font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Avg Orders / Customer", value: summary ? num(summary.avgOrdersPerCustomer).toFixed(1) : "—", icon: <RefreshCw className="size-4" /> },
          { label: "Avg Spend / Customer", value: summary ? `£${num(summary.avgSpendPerCustomer).toFixed(2)}` : "—", icon: <PoundSterling className="size-4" /> },
          { label: "Returning Revenue", value: summary ? `£${num(summary.returningRevenue).toFixed(2)}` : "—", icon: <PoundSterling className="size-4" /> },
          { label: "Returning Rev. Share", value: summary && num(summary.totalRevenue) > 0 ? `${((num(summary.returningRevenue) / num(summary.totalRevenue)) * 100).toFixed(1)}%` : "—", icon: <TrendingUp className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-16 mt-1" /> : <p className="text-lg font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Segment distribution pie */}
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Customer Segments</CardTitle>
            <CardDescription className="text-xs">By order frequency — New (1) · Returning (2) · Regular (3+)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {loading ? <Skeleton className="size-40 rounded-full" /> : (
              <>
                <PieChart width={180} height={180}>
                  <Pie data={segmentPie} dataKey="value" nameKey="name" cx={90} cy={90} outerRadius={80} innerRadius={50} paddingAngle={2}>
                    {segmentPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${Number(value)} customers · ${customers.length > 0 ? ((Number(value) / customers.length) * 100).toFixed(0) : 0}%`, name]}
                    contentStyle={{ fontSize: 11, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }}
                    labelStyle={{ display: "none" }}
                  />
                </PieChart>
                <div className="flex flex-col gap-1 w-full mt-1">
                  {segmentPie.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className="size-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="flex-1">{s.name}</span>
                      <span className="font-semibold">{s.value} ({customers.length > 0 ? ((s.value / customers.length) * 100).toFixed(0) : 0}%)</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Order frequency distribution */}
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Order Frequency Distribution</CardTitle>
            <CardDescription className="text-xs">How many orders does each customer place?</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : (
              <ChartContainer config={chartCfg} className="h-44 w-full">
                <BarChart data={freqBuckets} margin={{ left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={({ payload }) => payload?.[0] ? <div className="bg-popover border rounded p-2 text-xs"><p>{payload[0].payload.label}: {payload[0].value} customers</p></div> : null} />
                  <Bar dataKey="count" radius={4} name="Customers">
                    {freqBuckets.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* What each segment buys */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">What Each Segment Buys</CardTitle>
          <CardDescription className="text-xs">Top products by units for New (1 order), Returning (2) and Regular (3+) web customers — modifiers &amp; meal upgrades excluded</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {([["New", segItems?.newCustomers ?? []], ["Returning", segItems?.returning ?? []], ["Regular", segItems?.regular ?? []]] as const).map(([label, items]) => (
                <div key={label} className="flex flex-col">
                  <p className="text-xs font-semibold text-center mb-1">{label}</p>
                  {items.length === 0 ? (
                    <div className="h-44 flex items-center justify-center text-muted-foreground text-xs">No items yet</div>
                  ) : (
                    <ChartContainer config={chartCfg} className="h-44 w-full">
                      <BarChart data={items.slice(0, 6)} layout="vertical" margin={{ left: 4 }}>
                        <XAxis type="number" tick={{ fontSize: 9 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="item" tick={{ fontSize: 9 }} width={104} tickFormatter={(v) => v.length > 15 ? v.slice(0, 15) + "…" : v} />
                        <ChartTooltip content={({ payload }) => payload?.[0] ? (
                          <div className="bg-popover border rounded p-2 text-xs">
                            <p className="font-medium">{payload[0].payload.item}</p>
                            <p>{num(payload[0].payload.qty)} units · £{num(payload[0].payload.revenue).toFixed(2)}</p>
                          </div>
                        ) : null} />
                        <Bar dataKey="qty" radius={3} name="Units">
                          {items.slice(0, 6).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top customers table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Top Web Customers by Spend</CardTitle>
          <CardDescription className="text-xs">Top 50 identified website customers in the period · account IDs only (no PII stored)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : customers.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No customer data yet — sync Presto data first</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">Customer ID</TableHead>
                  <TableHead className="text-xs">Segment</TableHead>
                  <TableHead className="text-xs text-right">Orders</TableHead>
                  <TableHead className="text-xs text-right">Total Spend</TableHead>
                  <TableHead className="text-xs text-right">Avg Order</TableHead>
                  <TableHead className="text-xs">First Order</TableHead>
                  <TableHead className="text-xs">Last Order</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c, i) => {
                  const seg = webSegment(num(c.orderCount))
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs font-mono text-xs">{c.customerId?.substring(0, 12) ?? "—"}…</TableCell>
                      <TableCell className="text-xs">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${seg.color}`}>{seg.label}</span>
                      </TableCell>
                      <TableCell className="text-xs text-right">{num(c.orderCount)}</TableCell>
                      <TableCell className="text-xs text-right font-medium">£{num(c.totalSpend).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">£{num(c.avgOrderValue).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.firstOrder}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.lastOrder}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.platform}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {!loading && summary && coverage && (
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Retention Opportunities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-xs">
              {summary.newCustomers > 0 && (
                <div className="flex gap-2">
                  <Badge variant="outline" className="shrink-0 text-[10px]">Convert New</Badge>
                  <span>{summary.newCustomers} first-time web customers this period — a follow-up offer (emailed discount on their next website order) is the highest-ROI way to create repeat customers.</span>
                </div>
              )}
              <div className="flex gap-2">
                <Badge className="shrink-0 text-[10px] bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)]">Repeat Rate</Badge>
                <span>Only {num(summary.repeatRatePct).toFixed(1)}% of identified web customers return ({summary.returning} of {summary.identifiedCustomers}). A reorder prompt or simple loyalty scheme on the website is the lever to raise this.</span>
              </div>
              {summary.regular > 0 && (
                <div className="flex gap-2">
                  <Badge className="shrink-0 text-[10px] bg-[oklch(0.25_0.1_50)] text-[oklch(0.8_0.2_50)]">Reward Regulars</Badge>
                  <span>{summary.regular} regulars (3+ orders) already reorder — protect them with exclusives; returning customers drive £{num(summary.returningRevenue).toFixed(0)} of web revenue.</span>
                </div>
              )}
              <div className="flex gap-2">
                <Badge variant="destructive" className="shrink-0 text-[10px]">Grow First-Party Data</Badge>
                <span>Only {coverage.identifiedPct.toFixed(1)}% of orders carry a customer identity — the rest come via delivery apps that hide the customer. Driving orders to your own website is the only way to build a customer base you can remarket to.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
