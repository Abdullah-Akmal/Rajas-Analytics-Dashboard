"use client"

import { useState, useEffect } from "react"
import { getRetention, type RetentionResult, type Segment } from "@/lib/operations/retention"
import { DateLocationFilter, DEFAULT_RANGE_DAYS } from "@/components/date-location-filter"
import { KpiCard } from "@/components/kpi-card"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis } from "recharts"
import { format, subDays } from "date-fns"
import { Users, UserPlus, Repeat, PoundSterling, Fingerprint } from "lucide-react"

/**
 * Direct Customer & Retention (Operations corrections §7) — formerly "Web Customer
 * Behaviour". Identified direct customers only; marketplace customers are excluded
 * because they are not identifiable at customer level.
 */

const money = (n: number) => `£${n.toFixed(2)}`
const SEG_CLS: Record<Segment, string> = {
  New: "text-foreground",
  Returning: "text-success",
  Regular: "text-success",
  "At Risk": "text-warning",
  Lapsed: "text-destructive",
}
const TONE: Record<string, string> = {
  good: "border-success bg-success-subtle",
  warning: "border-warning bg-warning-subtle",
  problem: "border-destructive bg-destructive/10",
  neutral: "border-border bg-secondary",
}
const CHANNEL_LABEL: Record<string, string> = { wix: "EPOS (phone / collection / delivery)", eatpresto: "Own website" }

export default function CustomersPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), DEFAULT_RANGE_DAYS), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [data, setData] = useState<RetentionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showList, setShowList] = useState(false)

  const fetchData = async (f: { startDate: string; endDate: string; location: string }) => {
    setLoading(true)
    try {
      setData(await getRetention(f.startDate, f.endDate, f.location))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { fetchData(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const k = data?.kpis
  const facts = (data?.actions ?? []).filter((a) => a.kind === "fact")
  const suggestions = (data?.actions ?? []).filter((a) => a.kind === "suggestion")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Direct Customer &amp; Retention</h1>
        <p className="text-sm text-muted-foreground">
          Identified direct customers only — orders on Raja&apos;s own channels that carry a customer ID.
        </p>
      </div>

      <DateLocationFilter showChannel={false} onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      <div className="rounded-md border-l-4 border-warning bg-warning-subtle px-4 py-2 text-sm">
        Uber Eats, Deliveroo and Just Eat customers are excluded: the platforms give a new reference on every
        order, so the same customer cannot be recognised twice.
      </div>

      {/* ── Main KPIs (item 40) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {loading || !k ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <KpiCard title="Identified Customers" value={k.identifiedCustomers.toLocaleString()} subValue="Ordered in this period" icon={<Users className="size-4" />} />
            <KpiCard title="New Customers" value={k.newCustomers.toLocaleString()} subValue="First-ever order in period" icon={<UserPlus className="size-4" />} />
            <KpiCard title="Repeat Rate" value={`${k.repeatRatePct.toFixed(1)}%`} subValue="Active customers with 2+ orders" icon={<Repeat className="size-4" />} />
            <KpiCard title="Returning Revenue" value={money(k.returningRevenue)} subValue="From repeat orders" icon={<PoundSterling className="size-4" />} />
            <KpiCard
              title="Identified Direct Order %"
              value={`${k.identifiedDirectOrderPct.toFixed(1)}%`}
              subValue={`${k.identifiedOrders.toLocaleString()} of ${k.totalOrders.toLocaleString()} orders`}
              icon={<Fingerprint className="size-4" />}
            />
          </>
        )}
      </div>

      {/* ── Retention actions near the top; facts kept apart from suggestions (items 47-48) ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Customer Actions</CardTitle>
          <CardDescription className="text-sm">
            Measured facts first. Suggestions are tests to run — none has a measured return yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loading ? <Skeleton className="h-24 w-full lg:col-span-2" /> : (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">What the data shows</p>
                {facts.map((a, i) => <p key={i} className={`text-sm rounded-md border-l-4 px-3 py-2 ${TONE[a.tone]}`}>{a.text}</p>)}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">Suggested tests</p>
                {suggestions.length === 0
                  ? <p className="text-sm text-muted-foreground">Nothing to suggest for this selection.</p>
                  : suggestions.map((a, i) => <p key={i} className={`text-sm rounded-md border-l-4 px-3 py-2 ${TONE[a.tone]}`}>{a.text}</p>)}
              </div>
            </>
          )}
          {!loading && (data?.caveats.length ?? 0) > 0 && (
            <div className="lg:col-span-2 flex flex-col gap-1">
              {data!.caveats.map((c, i) => <p key={i} className="text-sm text-warning">{c}</p>)}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Segments with recency (item 42) — a compact table instead of pie + bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer Segments</CardTitle>
            <CardDescription className="text-sm">
              All identified customers as of the period end. At Risk after {data?.settings.atRiskDays ?? "…"} days,
              Lapsed after {data?.settings.lapsedDays ?? "…"} days without an order (Settings → Retention).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">Segment</TableHead>
                    <TableHead className="text-sm">Rule</TableHead>
                    <TableHead className="text-sm text-right">Customers</TableHead>
                    <TableHead className="text-sm text-right">Period revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.segments ?? []).map((s) => (
                    <TableRow key={s.segment}>
                      <TableCell className={`text-sm font-medium ${SEG_CLS[s.segment]}`}>{s.segment}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.segment === "New" ? "1 order" : s.segment === "Returning" ? "2 orders" : s.segment === "Regular" ? "3+ orders"
                          : s.segment === "At Risk" ? `> ${data?.settings.atRiskDays} days since last` : `> ${data?.settings.lapsedDays} days since last`}
                      </TableCell>
                      <TableCell className="text-sm text-right">{s.customers.toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-right">{money(s.periodRevenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Cohort repeat (item 44) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New Customer Cohorts</CardTitle>
            <CardDescription className="text-sm">
              Customers by week of first order, and the share who ordered again within {data?.settings.cohortWindowDays ?? "…"} days.
              Only customers whose window has passed are counted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : (data?.cohorts.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No new customers in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">Week starting</TableHead>
                    <TableHead className="text-sm text-right">New</TableHead>
                    <TableHead className="text-sm text-right">Window passed</TableHead>
                    <TableHead className="text-sm text-right">Repeated</TableHead>
                    <TableHead className="text-sm text-right">Repeat %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.cohorts.map((c) => (
                    <TableRow key={c.week}>
                      <TableCell className="text-sm font-medium">{c.week}</TableCell>
                      <TableCell className="text-sm text-right">{c.newCustomers}</TableCell>
                      <TableCell className="text-sm text-right">{c.matured}</TableCell>
                      <TableCell className="text-sm text-right">{c.repeated}</TableCell>
                      <TableCell className="text-sm text-right">{c.repeatPct === null ? "Too early" : `${c.repeatPct.toFixed(0)}%`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Identified Direct Order % over time (item 49) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Identified Direct Order % over time</CardTitle>
          <CardDescription className="text-sm">
            Orders on Raja&apos;s own channels with a customer ID ÷ all orders (every channel). Sources:{" "}
            {(data?.sources ?? []).map((s) => `${CHANNEL_LABEL[s.channel] ?? s.channel} ${s.customers} customers`).join(" · ") || "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <ChartContainer config={{ identifiedPct: { label: "Identified %", color: "var(--color-chart-1)" } }} className="h-48 w-full">
              <LineChart data={data?.trend ?? []}>
                <XAxis dataKey="period" tick={{ fontSize: 12 }} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis tick={{ fontSize: 12 }} unit="%" domain={[0, "auto"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="identifiedPct" name="Identified %" stroke="var(--color-chart-1)" strokeWidth={2} dot />
              </LineChart>
            </ChartContainer>
          )}
          {!loading && k && (
            <p className="text-sm text-muted-foreground mt-2">
              Secondary: {k.avgOrdersPerCustomer.toFixed(1)} orders and {money(k.avgSpendPerCustomer)} spend per active customer this period.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Customer list behind a drill-down (item 46) */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Customer List</CardTitle>
            <CardDescription className="text-sm">Top 50 active customers by spend · account IDs only, no personal data</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowList((v) => !v)}>
            {showList ? "Hide list" : "View customer list"}
          </Button>
        </CardHeader>
        {showList && (
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-sm">Customer ID</TableHead>
                  <TableHead className="text-sm">Segment</TableHead>
                  <TableHead className="text-sm text-right">Orders (period)</TableHead>
                  <TableHead className="text-sm text-right">Orders (all)</TableHead>
                  <TableHead className="text-sm text-right">Spend (period)</TableHead>
                  <TableHead className="text-sm">First order</TableHead>
                  <TableHead className="text-sm">Last order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.customers ?? []).map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell className="text-sm font-mono">{c.customerId.slice(0, 12)}…</TableCell>
                    <TableCell className={`text-sm font-medium ${SEG_CLS[c.segment]}`}>{c.segment}</TableCell>
                    <TableCell className="text-sm text-right">{c.periodOrders}</TableCell>
                    <TableCell className="text-sm text-right">{c.lifetimeOrders}</TableCell>
                    <TableCell className="text-sm text-right">{money(c.periodSpend)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.firstOrder}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.lastOrder}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
