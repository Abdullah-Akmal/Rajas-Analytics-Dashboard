"use client"

import { useState, useEffect } from "react"
import { getOfferAnalytics, getAvailableOffers } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, CartesianGrid } from "recharts"
import { format, subDays } from "date-fns"
import { Tag, PoundSterling, TrendingUp, Hash, Percent, Gauge, Sparkles } from "lucide-react"

type Analytics = Awaited<ReturnType<typeof getOfferAnalytics>>
type Catalogue = Awaited<ReturnType<typeof getAvailableOffers>>
type OfferRow = { offer: string; orders: number; units: number; offerRevenue: number; offerDiscount: number }

const chartCfg = {
  orders: { label: "Orders", color: "var(--color-chart-1)" },
  revenue: { label: "Revenue", color: "var(--color-chart-2)" },
}

function num(v: unknown) { return Number(v ?? 0) }

// Offer effectiveness: blends AOV uplift vs overall + margin retention into a label
function effectiveness(aovUpliftPct: number, marginPct: number, overallMarginPct: number) {
  const marginGap = marginPct - overallMarginPct
  if (aovUpliftPct >= 0 && marginGap >= -5) return { label: "Strong", color: "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]", note: "Higher-than-average baskets with healthy margin" }
  if (aovUpliftPct >= -10 && marginGap >= -12) return { label: "Moderate", color: "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)] border-[oklch(0.38_0.1_75)]", note: "Acceptable, but watch margin or basket size" }
  return { label: "Weak", color: "bg-destructive/15 text-destructive border-destructive/30", note: "Low baskets and/or eroded margin — review this offer" }
}

export default function OfferPerformancePage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
    mode: "all",
    platform: "all",
  })
  const [offer, setOffer] = useState<string>("all")
  const [data, setData] = useState<Analytics | null>(null)
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters, off: string) => {
    setLoading(true)
    try {
      // The catalogue is deliberately NOT date-filtered — it answers "which offers are
      // live right now", so a running offer still appears when the selected period
      // predates it or contains no redemptions.
      const [analytics, cat] = await Promise.all([
        getOfferAnalytics(f.startDate, f.endDate, f.location, off, f.channel, f.mode, f.platform),
        getAvailableOffers(f.location, f.channel, f.mode, f.platform),
      ])
      setData(analytics)
      setCatalogue(cat)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters, offer) }, [])

  const offers = (data?.offers ?? []) as OfferRow[]
  const baseline = data?.baseline
  const sel = data?.selected

  const eff = sel ? effectiveness(sel.aovUpliftPct, sel.marginPct, baseline?.overallMarginPct ?? 0) : null

  // Merge the live catalogue with in-period usage: every known offer is listed, tagged
  // Live/Ended, and annotated with how much it was actually used in the selected range.
  // A Live offer with 0 in-period orders is itself a finding, so it must not be hidden.
  const usageByOffer = new Map(offers.map((o) => [o.offer, o]))
  const offerList = (catalogue?.offers ?? [])
    .map((c) => ({
      ...c,
      rangeOrders: usageByOffer.get(c.offer)?.orders ?? 0,
      rangeRevenue: usageByOffer.get(c.offer)?.offerRevenue ?? 0,
    }))
    .sort((a, b) => Number(b.available) - Number(a.available) || b.rangeOrders - a.rangeOrders)
  const liveOffers = offerList.filter((o) => o.available)

  const noOffers = !loading && offerList.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Offer Performance</h1>
        <p className="text-sm text-muted-foreground">Per-offer revenue, profitability, order uplift and effectiveness — offers come from the Presto “OFFERS” category</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f, offer) }} />

      {/* Currently available offers — the live promotion list, independent of the date filter */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="size-4" /> Currently Available Offers
            {!loading && <Badge variant="outline" className="ml-1 text-[10px]">{liveOffers.length} live</Badge>}
          </CardTitle>
          <CardDescription className="text-xs">
            Offers still being redeemed as of {catalogue?.asOf ?? "the latest sync"} — an offer counts as live if it was
            used within the last {catalogue?.windowDays ?? 14} days of synced sales
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-56" />)}</div>
          ) : liveOffers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No offers have been redeemed in the last {catalogue?.windowDays ?? 14} days of synced sales — every known offer looks retired.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {liveOffers.map((o) => (
                <div key={o.offer} className="rounded-lg border border-[oklch(0.35_0.08_150)] bg-[oklch(0.25_0.08_150)]/40 px-3 py-2 min-w-52">
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[oklch(0.7_0.15_150)]" />
                    <span className="text-xs font-semibold text-foreground">{o.offer}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {o.orders.toLocaleString()} redemptions all-time · £{o.revenue.toFixed(0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Running since {o.firstSeen} · last used {o.daysSince === 0 ? "today" : `${o.daysSince}d ago`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Offer name slicer */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-sm font-semibold flex items-center gap-2"><Tag className="size-4" /> Select Offer</CardTitle>
          <CardDescription className="text-xs">Choose which offer to analyse — live offers first, then retired ones. Counts shown are for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-40" />)}</div>
          ) : noOffers ? (
            <p className="text-xs text-muted-foreground py-2">No offers found. Offers appear here once Presto orders include items in the “OFFERS” category.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {offerList.map((o) => (
                <button
                  key={o.offer}
                  onClick={() => { setOffer(o.offer); fetchData(filters, o.offer) }}
                  className={`text-xs px-3 py-2 rounded-lg border text-left transition-all ${sel?.offer === o.offer ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/50"}`}
                >
                  <span className="font-semibold flex items-center gap-1.5">
                    {o.offer}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                      sel?.offer === o.offer
                        ? "border-primary-foreground/40 text-primary-foreground/90"
                        : o.available
                          ? "border-[oklch(0.35_0.08_150)] text-[oklch(0.7_0.15_150)]"
                          : "border-border text-muted-foreground"
                    }`}>{o.available ? "Live" : "Ended"}</span>
                  </span>
                  <span className={`text-[10px] block mt-0.5 ${sel?.offer === o.offer ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {o.rangeOrders > 0
                      ? `${o.rangeOrders} orders · £${o.rangeRevenue.toFixed(0)} in period`
                      : `Not used in this period · last ${o.lastSeen}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected offer metrics */}
      {!noOffers && (
        <>
          {/* The 5 required KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: "Offers Used", value: sel ? `${sel.ordersUsed}` : "—", sub: sel ? `${num(sel.units).toFixed(0)} units` : "", icon: <Hash className="size-4" /> },
              { label: "Revenue Generated", value: sel ? `£${sel.basketRevenue.toFixed(0)}` : "—", sub: sel ? `£${num(offers.find(o => o.offer === sel.offer)?.offerRevenue).toFixed(0)} from offer line` : "", icon: <PoundSterling className="size-4" /> },
              { label: "Est. Profit Impact", value: sel ? `£${sel.grossProfit.toFixed(0)}` : "—", sub: sel ? `${sel.marginPct.toFixed(1)}% margin` : "", icon: <TrendingUp className="size-4" /> },
              { label: "Order Uplift (AOV)", value: sel ? `${sel.aovUpliftPct >= 0 ? "+" : ""}${sel.aovUpliftPct.toFixed(1)}%` : "—", sub: sel ? `vs £${num(baseline?.overallAOV).toFixed(2)} avg` : "", icon: <Percent className="size-4" />, danger: sel ? sel.aovUpliftPct < 0 : false },
              { label: "Effectiveness", value: eff?.label ?? "—", sub: sel ? `${sel.penetration.toFixed(1)}% of orders` : "", icon: <Gauge className="size-4" />, badge: eff },
            ].map((k) => (
              <Card key={k.label} className={k.danger ? "border-destructive/40" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {k.icon}
                    <p className="text-xs">{k.label}</p>
                  </div>
                  {loading ? <Skeleton className="h-7 w-20 mt-2" /> : (
                    <>
                      {k.badge ? (
                        <span className={`inline-block mt-2 text-sm font-bold px-2 py-0.5 rounded-full border ${k.badge.color}`}>{k.value}</span>
                      ) : (
                        <p className={`text-xl font-bold mt-1.5 ${k.danger ? "text-destructive" : "text-foreground"}`}>{k.value}</p>
                      )}
                      {k.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</p>}
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Effectiveness explanation */}
          {sel && eff && !loading && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 text-xs">
                  <span className={`px-2 py-0.5 rounded-full border font-semibold shrink-0 ${eff.color}`}>{eff.label}</span>
                  <div className="text-muted-foreground">
                    <p>{eff.note}.</p>
                    <p className="mt-1">
                      <strong className="text-foreground">{sel.offer}</strong> was used in <strong className="text-foreground">{sel.basketOrders}</strong> baskets
                      ({sel.penetration.toFixed(1)}% of all orders), averaging <strong className="text-foreground">£{sel.basketAOV.toFixed(2)}</strong> per basket
                      vs the £{num(baseline?.overallAOV).toFixed(2)} overall average — an AOV uplift of {sel.aovUpliftPct >= 0 ? "+" : ""}{sel.aovUpliftPct.toFixed(1)}%.
                      Baskets generated <strong className="text-foreground">£{sel.grossProfit.toFixed(0)}</strong> gross profit at {sel.marginPct.toFixed(1)}% margin
                      (overall margin {num(baseline?.overallMarginPct).toFixed(1)}%), with £{sel.basketDiscount.toFixed(2)} of discount given.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Daily trend */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold">{sel?.offer ?? "Offer"} — Daily Usage</CardTitle>
              <CardDescription className="text-xs">Orders using this offer and offer-line revenue per day</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-52 w-full" /> : !sel || sel.dailyTrend.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No usage data for this offer in range</div>
              ) : (
                <ChartContainer config={chartCfg} className="h-52 w-full">
                  <LineChart data={sel.dailyTrend} margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                    <ChartTooltip content={({ payload }) => payload?.[0] ? (
                      <div className="bg-popover border rounded p-2 text-xs">
                        <p className="font-medium">{payload[0].payload.date}</p>
                        <p>{num(payload[0].payload.orders)} orders</p>
                        <p className="text-muted-foreground">£{num(payload[0].payload.revenue).toFixed(2)} offer revenue</p>
                      </div>
                    ) : null} />
                    <Line yAxisId="left" type="monotone" dataKey="orders" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} name="Orders" />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="var(--color-chart-2)" dot={false} strokeWidth={1.5} strokeDasharray="4 4" name="Revenue" />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* All offers comparison table */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold">All Offers — Comparison</CardTitle>
              <CardDescription className="text-xs">Side-by-side across every offer in the period</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Offer</TableHead>
                      <TableHead className="text-xs text-right">Orders</TableHead>
                      <TableHead className="text-xs text-right">Units</TableHead>
                      <TableHead className="text-xs text-right">Offer Revenue</TableHead>
                      <TableHead className="text-xs text-right">Discount Given</TableHead>
                      <TableHead className="text-xs text-right">Avg / Order</TableHead>
                      <TableHead className="text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {offers.map((o) => (
                      <TableRow key={o.offer} className={sel?.offer === o.offer ? "bg-secondary/40" : ""}>
                        <TableCell className="text-xs font-medium">{o.offer}</TableCell>
                        <TableCell className="text-xs text-right">{o.orders}</TableCell>
                        <TableCell className="text-xs text-right">{o.units.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right">£{o.offerRevenue.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">£{o.offerDiscount.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">£{o.orders > 0 ? (o.offerRevenue / o.orders).toFixed(2) : "0.00"}</TableCell>
                        <TableCell className="text-xs">
                          <button
                            onClick={() => { setOffer(o.offer); fetchData(filters, o.offer) }}
                            className="text-primary hover:underline text-[11px]"
                          >
                            {sel?.offer === o.offer ? "Viewing" : "View"}
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
