"use client"

import { useState, useEffect, useMemo } from "react"
import { getHourlyBreakdown, getItemProfitability, getBasketAnalysis } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, Cell, CartesianGrid } from "recharts"
import { format } from "date-fns"
import { Moon, Sun, Sunrise, Tag, Clock, Package, Layers, Info } from "lucide-react"

type Item = Awaited<ReturnType<typeof getItemProfitability>>[number]
type Basket = Awaited<ReturnType<typeof getBasketAnalysis>>

function num(v: unknown) { return Number(v ?? 0) }
function fmt12h(h: number) { const am = h < 12; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${am ? "am" : "pm"}` }
// chronological trading order — hours after midnight (0–4) belong to the previous trading day
function tradingPos(h: number) { return h < 5 ? h + 24 : h }

// group consecutive (in trading order) hours into "12pm–2pm" style ranges
function hourRanges(hours: number[]): string {
  if (hours.length === 0) return "—"
  const sorted = [...hours].sort((a, b) => tradingPos(a) - tradingPos(b))
  const ranges: string[] = []
  let start = sorted[0], prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && tradingPos(sorted[i]) === tradingPos(prev) + 1) { prev = sorted[i]; continue }
    ranges.push(start === prev ? `${fmt12h(start)}–${fmt12h((start + 1) % 24)}` : `${fmt12h(start)}–${fmt12h((prev + 1) % 24)}`)
    if (i < sorted.length) { start = sorted[i]; prev = sorted[i] }
  }
  return ranges.join(", ")
}

// ── Business trading hours per location (UK local) ──
// Hours after midnight belong to the previous trading day.
// Grand Arcade: 10:30am – 4:00am next day · Hyde Park: 11:00am – 1:00am next day
const GRAND_ARCADE_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3]
const HYDE_PARK_HOURS = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0]
function openHoursFor(loc: string): number[] {
  if (loc === "Hyde Park") return HYDE_PARK_HOURS
  if (loc === "Grand Arcade") return GRAND_ARCADE_HOURS
  return GRAND_ARCADE_HOURS // "all" — use the widest window
}
const HOURS_LABEL: Record<string, string> = {
  "Hyde Park": "Hyde Park trades 11:00am–1:00am",
  "Grand Arcade": "Grand Arcade trades 10:30am–4:00am",
  all: "Grand Arcade 10:30am–4:00am · Hyde Park 11:00am–1:00am",
}

const PERIOD_COLOR = {
  quiet: "oklch(0.65 0.15 220)",
  mid: "oklch(0.7 0.15 150)",
  peak: "oklch(0.8 0.2 50)",
} as const

export default function RecommendationsPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [hourly, setHourly] = useState<{ hour: number; totalOrders: number; totalRevenue: number; avgOrderValue: number }[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [basket, setBasket] = useState<Basket | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [h, i, b] = await Promise.all([
        getHourlyBreakdown(f.startDate, f.endDate, f.location),
        getItemProfitability(f.startDate, f.endDate, f.location),
        getBasketAnalysis(f.startDate, f.endDate, f.location),
      ])
      setHourly(h as any)
      setItems(i as Item[])
      setBasket(b)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  // ── classify OPEN hours into quiet / mid / peak by order volume ──
  // Open hours are defined by each location's real trading window (not guessed from data),
  // so an offer is never recommended at a time the shop isn't actually open. Within that
  // window, hours are ranked relative to the busiest hour: ≥66% = peak, ≤33% = quiet, else mid.
  const periods = useMemo(() => {
    const open = openHoursFor(filters.location)
    const byHour = new Map<number, { orders: number; revenue: number }>()
    hourly.forEach((h) => byHour.set(num(h.hour), { orders: num(h.totalOrders), revenue: num(h.totalRevenue) }))
    const rows = open
      .map((h) => ({ hour: h, orders: byHour.get(h)?.orders ?? 0, revenue: byHour.get(h)?.revenue ?? 0 }))
      .sort((a, b) => tradingPos(a.hour) - tradingPos(b.hour))
    const maxOrders = Math.max(1, ...rows.map((r) => r.orders))
    const classify = (orders: number): "quiet" | "mid" | "peak" => {
      const ratio = orders / maxOrders
      if (ratio >= 0.66) return "peak"
      if (ratio <= 0.33) return "quiet"
      return "mid"
    }
    const chart = rows.map((r) => ({ ...r, label: fmt12h(r.hour), period: classify(r.orders) }))

    const totalOrders = rows.reduce((s, r) => s + r.orders, 0)
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
    const agg = (key: "quiet" | "mid" | "peak") => {
      const inP = chart.filter((r) => r.period === key)
      const orders = inP.reduce((s, r) => s + r.orders, 0)
      const revenue = inP.reduce((s, r) => s + r.revenue, 0)
      return {
        hours: inP.map((r) => r.hour),
        orders,
        revenue,
        aov: orders > 0 ? revenue / orders : 0,
        orderShare: totalOrders > 0 ? (orders / totalOrders) * 100 : 0,
        revShare: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
      }
    }
    return { chart, totalOrders, totalRevenue, quiet: agg("quiet"), mid: agg("mid"), peak: agg("peak") }
  }, [hourly, filters.location])

  // ── menu engineering buckets ──
  const { stars, promote } = useMemo(() => {
    if (items.length === 0) return { stars: [] as Item[], promote: [] as Item[] }
    const qtys = items.map((i) => num(i.totalQty)).sort((a, b) => a - b)
    const medianQty = qtys[Math.floor(qtys.length / 2)] || 0
    const stars = items.filter((i) => num(i.marginPercent) >= 50 && num(i.totalQty) >= medianQty).sort((a, b) => num(b.grossProfit) - num(a.grossProfit))
    const promote = items.filter((i) => num(i.marginPercent) >= 50 && num(i.totalQty) < medianQty).sort((a, b) => num(b.marginPercent) - num(a.marginPercent))
    return { stars, promote }
  }, [items])

  // ── high-margin bundle opportunities: pair a popular anchor with a high-margin item ──
  const bundles = useMemo(() => {
    const anchors = (basket?.topItems ?? []).slice(0, 4)
    const highMargin = [...items].filter((i) => num(i.marginPercent) >= 55 && num(i.totalQty) > 2).sort((a, b) => num(b.marginPercent) - num(a.marginPercent))
    const out: { anchor: string; addon: string; addonMargin: number; standalone: number; comboPrice: number }[] = []
    anchors.forEach((a, idx) => {
      const addon = highMargin[idx]
      if (!addon) return
      const anchorItem = items.find((i) => i.itemName === a.itemName)
      const anchorPrice = num(anchorItem?.avgUnitPrice)
      const addonPrice = num(addon.avgUnitPrice)
      const standalone = +(anchorPrice + addonPrice).toFixed(2)
      const comboPrice = +(standalone * 0.9).toFixed(2) // 10% bundle saving
      out.push({
        anchor: a.itemName,
        addon: addon.itemName,
        addonMargin: num(addon.marginPercent),
        standalone,
        comboPrice,
      })
    })
    return out
  }, [basket, items])

  const periodCards = [
    {
      key: "quiet", title: "Quiet Periods", icon: <Moon className="size-4" />,
      accent: "border-l-[oklch(0.55_0.15_220)]", chip: "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]",
      data: periods.quiet,
      push: promote.slice(0, 4),
      offers: ["Time-boxed % discount (e.g. 20% off) to pull demand forward", "“Quiet-hour” meal deal on high-margin items", "Free side with any main to drive footfall"],
      strategy: "Spare kitchen capacity — extra orders are almost pure contribution, so discounts pay off here. Aim offers at the promote-list items below to fill the gap profitably.",
    },
    {
      key: "mid", title: "Mid-Demand Periods", icon: <Sunrise className="size-4" />,
      accent: "border-l-[oklch(0.6_0.15_150)]", chip: "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]",
      data: periods.mid,
      push: stars.slice(0, 4),
      offers: ["Bundle deals (main + side + drink) to lift average order value", "Upsell prompts at checkout", "Loyalty points double-up"],
      strategy: "Demand is healthy but not maxed — grow basket size, not order count. Bundles and upsells lift AOV without discounting away margin.",
    },
    {
      key: "peak", title: "Peak Periods", icon: <Sun className="size-4" />,
      accent: "border-l-[oklch(0.65_0.18_50)]", chip: "bg-[oklch(0.25_0.1_50)] text-[oklch(0.8_0.2_50)] border-[oklch(0.4_0.1_50)]",
      data: periods.peak,
      push: stars.slice(0, 4),
      offers: ["Avoid discounts — demand is already high", "Premium add-ons & combo upgrades", "Push fastest-to-make high-margin items to protect throughput"],
      strategy: "Demand is inelastic — protect margin and kitchen speed. No discounts; a small uplift on best-sellers and quick high-margin items maximises profit per order.",
    },
  ] as const

  const chartConfig = { orders: { label: "Orders", color: "var(--chart-1)" } }

  const noData = !loading && hourly.length === 0 && items.length === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Offer Recommendation</h1>
        <p className="text-sm text-muted-foreground">Data-backed offer strategy by demand period — what to push, which offers to run, when, and how to price</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="size-3" /> {HOURS_LABEL[filters.location] ?? HOURS_LABEL.all}</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {noData ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground text-sm">No data yet — sync Presto orders to generate recommendations.</CardContent></Card>
      ) : (
        <>
          {/* Sales by trading hour, coloured by demand period */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 justify-center"><Clock className="size-4" /> Sales Across the Trading Day</CardTitle>
              <CardDescription className="text-xs">Orders per hour within opening hours, coloured by demand period — this is the sales signal the offer periods are built from</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-56 w-full" /> : (
                <>
                  <ChartContainer config={chartConfig} className="h-56 w-full">
                    <BarChart data={periods.chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-40} textAnchor="end" height={44} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="orders" radius={3}>
                        {periods.chart.map((r, i) => <Cell key={i} fill={PERIOD_COLOR[r.period]} />)}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  <div className="flex flex-wrap items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: PERIOD_COLOR.quiet }} /> Quiet</span>
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: PERIOD_COLOR.mid }} /> Mid-demand</span>
                    <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: PERIOD_COLOR.peak }} /> Peak</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Period recommendation cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {periodCards.map((p) => (
              <Card key={p.key} className={`border-l-4 ${p.accent}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`size-8 rounded-lg flex items-center justify-center border ${p.chip}`}>{p.icon}</span>
                    <div>
                      <CardTitle className="text-sm font-semibold">{p.title}</CardTitle>
                      <CardDescription className="text-xs flex items-center gap-1">
                        <Clock className="size-3" /> {loading ? "…" : hourRanges(p.data.hours)}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {loading ? <Skeleton className="h-52 w-full" /> : (
                    <>
                      {/* data-backed stats */}
                      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-secondary/40 p-2 text-center">
                        <div>
                          <p className="text-sm font-bold text-foreground">{p.data.orders.toLocaleString()}</p>
                          <p className="text-[9px] text-muted-foreground leading-tight">orders<br />({p.data.orderShare.toFixed(0)}% of day)</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">£{p.data.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                          <p className="text-[9px] text-muted-foreground leading-tight">revenue<br />({p.data.revShare.toFixed(0)}% of day)</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">£{p.data.aov.toFixed(2)}</p>
                          <p className="text-[9px] text-muted-foreground leading-tight">avg order<br />value</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-foreground flex items-center gap-1 mb-1"><Package className="size-3" /> Items to push</p>
                        <div className="flex flex-wrap gap-1">
                          {p.push.length === 0 ? <span className="text-[10px] text-muted-foreground">No qualifying items</span> :
                            p.push.map((it, i) => (
                              <span key={i} className="text-[10px] bg-secondary rounded px-1.5 py-0.5">
                                {it.itemName} <span className="text-muted-foreground">({num(it.marginPercent).toFixed(0)}%)</span>
                              </span>
                            ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-foreground flex items-center gap-1 mb-1"><Tag className="size-3" /> Offers to run</p>
                        <ul className="flex flex-col gap-0.5">
                          {p.offers.map((o, i) => <li key={i} className="text-[10px] text-muted-foreground flex gap-1"><span className="text-primary">•</span>{o}</li>)}
                        </ul>
                      </div>
                      <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
                        <span className="font-semibold text-foreground">Strategy: </span>{p.strategy}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* High-margin bundle opportunities */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Layers className="size-4" /> High-Profit Bundle Opportunities</CardTitle>
              <CardDescription className="text-xs">Pair a high-traffic anchor with a high-margin add-on to lift basket value without eroding profit</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* how it works + strategic impact */}
              <div className="rounded-lg border border-border bg-secondary/40 p-3 text-[11px] text-muted-foreground flex flex-col gap-2">
                <p className="flex items-center gap-1 text-foreground font-semibold"><Info className="size-3.5" /> How this table is built &amp; why it matters</p>
                <p><span className="font-medium text-foreground">How it works:</span> the <span className="font-medium">anchor</span> is one of your most-ordered items (pulled from basket analysis) — it already brings customers in on its own. Each anchor is paired with a distinct <span className="font-medium">high-margin add-on</span> (≥55% margin, proven to sell). The suggested combo price is the two items’ standalone total minus a 10% saving to make the deal attractive.</p>
                <p><span className="font-medium text-foreground">Strategic impact:</span> the discount is funded by the add-on’s margin headroom, so profit per order still <span className="font-medium">rises</span> even after the 10% off. You use a popular item as free traffic to move a profitable-but-under-exposed item — this grows average order value, shifts your product mix toward high-margin lines, and trains customers to buy in bundles rather than single items. Run these as the “bundle deals” referenced in the mid-demand and quiet-period plans above.</p>
              </div>
              {loading ? <Skeleton className="h-32 w-full" /> : bundles.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Not enough data to suggest bundles</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Anchor (high traffic)</TableHead>
                      <TableHead className="text-xs">+ High-Margin Add-on</TableHead>
                      <TableHead className="text-xs text-right">Add-on Margin</TableHead>
                      <TableHead className="text-xs text-right">Standalone</TableHead>
                      <TableHead className="text-xs text-right">Suggested Combo</TableHead>
                      <TableHead className="text-xs text-right">Customer Saves</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundles.map((b, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{b.anchor}</TableCell>
                        <TableCell className="text-xs">{b.addon}</TableCell>
                        <TableCell className="text-xs text-right text-[oklch(0.7_0.15_150)]">{b.addonMargin.toFixed(0)}%</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">£{b.standalone.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">£{b.comboPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right text-[oklch(0.7_0.15_150)]">£{(b.standalone - b.comboPrice).toFixed(2)}</TableCell>
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
