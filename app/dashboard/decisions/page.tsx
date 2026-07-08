"use client"

import { useState, useEffect } from "react"
import {
  getOverviewKPIs, getDailyRevenueTrend, getPlatformPerformance,
  getItemProfitability, getCategoryPerformance, getDeliveryKPIs, getBasketAnalysis,
} from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { format, subDays } from "date-fns"
import { ClipboardCheck, Lightbulb, Settings, Sparkles, CircleDot } from "lucide-react"

function num(v: unknown) { return Number(v ?? 0) }

type Insight = { text: string; tone: "good" | "warn" | "bad" | "info"; tag?: string }

const toneStyle: Record<Insight["tone"], string> = {
  good: "text-[oklch(0.7_0.15_150)]",
  warn: "text-[oklch(0.75_0.18_75)]",
  bad: "text-destructive",
  info: "text-[oklch(0.65_0.15_220)]",
}

export default function DecisionsPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [loading, setLoading] = useState(true)
  const [decisions, setDecisions] = useState<Insight[]>([])
  const [actions, setActions] = useState<Insight[]>([])
  const [operational, setOperational] = useState<Insight[]>([])
  const [opportunities, setOpportunities] = useState<Insight[]>([])
  const [headline, setHeadline] = useState<{ revenue: number; orders: number; aov: number; margin: number } | null>(null)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [kpis, trend, platforms, items, cats, delivery, basket] = await Promise.all([
        getOverviewKPIs(f.startDate, f.endDate, f.location),
        getDailyRevenueTrend(f.startDate, f.endDate, f.location),
        getPlatformPerformance(f.startDate, f.endDate, f.location),
        getItemProfitability(f.startDate, f.endDate, f.location),
        getCategoryPerformance(f.startDate, f.endDate, f.location),
        getDeliveryKPIs(f.startDate, f.endDate),
        getBasketAnalysis(f.startDate, f.endDate, f.location),
      ])

      const totalRevenue = num(kpis.totalRevenue)
      const totalProfit = num((kpis as any).totalRevenue) - num((kpis as any).totalCost)
      const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
      setHeadline({ revenue: totalRevenue, orders: num(kpis.totalOrders), aov: num(kpis.avgOrderValue), margin: marginPct })

      const D: Insight[] = [], A: Insight[] = [], O: Insight[] = [], OPP: Insight[] = []

      // ── revenue trend (recent 3 days vs earlier) ──
      if (trend.length >= 4) {
        const rev = trend.map((d: any) => num(d.totalRevenue))
        const recent = rev.slice(-3); const earlier = rev.slice(0, -3)
        const ra = recent.reduce((s, v) => s + v, 0) / recent.length
        const ea = earlier.reduce((s, v) => s + v, 0) / Math.max(earlier.length, 1)
        const chg = ea > 0 ? ((ra - ea) / ea) * 100 : 0
        if (chg < -10) D.push({ text: `Revenue is down ${Math.abs(chg).toFixed(0)}% in the last 3 days (£${ra.toFixed(0)}/day vs £${ea.toFixed(0)}/day). Decide on a corrective promotion this week.`, tone: "bad", tag: "Revenue" })
        else if (chg > 10) D.push({ text: `Revenue is up ${chg.toFixed(0)}% in the last 3 days. Decide where to reinvest the momentum (staffing, marketing).`, tone: "good", tag: "Revenue" })
        else D.push({ text: `Revenue is stable (${chg >= 0 ? "+" : ""}${chg.toFixed(0)}% recent vs earlier). Hold current strategy and focus on margin.`, tone: "info", tag: "Revenue" })
      }

      // ── platform decisions ──
      const byPlat = Object.values(platforms.reduce((acc: Record<string, any>, r: any) => {
        const k = r.platform; if (!acc[k]) acc[k] = { platform: k, revenue: 0, orders: 0, discount: 0 }
        acc[k].revenue += num(r.totalRevenue); acc[k].orders += num(r.totalOrders); acc[k].discount += num(r.totalDiscount); return acc
      }, {})) as any[]
      byPlat.sort((a, b) => b.revenue - a.revenue)
      if (byPlat[0]) D.push({ text: `${byPlat[0].platform} is the top channel (£${byPlat[0].revenue.toFixed(0)}). Decide its weekly promo & ensure listings are best-in-class.`, tone: "info", tag: "Platform" })
      const highDisc = byPlat.find((p) => p.revenue > 0 && p.discount / p.revenue > 0.15)
      if (highDisc) A.push({ text: `Cut discounting on ${highDisc.platform} — ${((highDisc.discount / highDisc.revenue) * 100).toFixed(0)}% of its revenue is given away (£${highDisc.discount.toFixed(0)}).`, tone: "bad", tag: "Offers" })

      // ── item actions ──
      const lowMargin = items.filter((i: any) => num(i.marginPercent) < 30 && num(i.totalQty) >= 10)
      if (lowMargin.length) A.push({ text: `Reprice or rework ${lowMargin.length} high-volume item${lowMargin.length > 1 ? "s" : ""} under 30% margin (e.g. ${lowMargin.slice(0, 2).map((i: any) => i.itemName).join(", ")}).`, tone: "warn", tag: "Pricing" })
      const negative = items.filter((i: any) => num(i.grossProfit) < 0 && num(i.totalQty) > 0)
      if (negative.length) A.push({ text: `${negative.length} item${negative.length > 1 ? "s are" : " is"} selling below cost — fix pricing immediately (loss £${Math.abs(negative.reduce((s: number, i: any) => s + num(i.grossProfit), 0)).toFixed(0)}).`, tone: "bad", tag: "Pricing" })

      // ── operational insights ──
      const o = delivery.overall
      if (o && num(o.totalDeliveries) >= 5) {
        const onTime = num(o.totalDeliveries) > 0 ? (num(o.onTimeCount) / num(o.totalDeliveries)) * 100 : 0
        O.push({ text: `Delivery on-time rate is ${onTime.toFixed(0)}% with ${num(o.avgDeliveryMinutes).toFixed(0)} min average.`, tone: onTime >= 85 ? "good" : onTime >= 70 ? "warn" : "bad", tag: "Delivery" })
        if (num(o.avgDispatchMinutes) > 8) O.push({ text: `Dispatch averages ${num(o.avgDispatchMinutes).toFixed(0)} min — kitchen-to-driver handoff is slow at peak.`, tone: "warn", tag: "Delivery" })
      }
      if (basket?.summary) {
        const avgItems = num(basket.summary.avgItemsPerOrder)
        O.push({ text: `Average basket is ${avgItems.toFixed(1)} items / £${num(basket.summary.avgBasketValue).toFixed(2)}.`, tone: avgItems < 2 ? "warn" : "good", tag: "Basket" })
      }

      // ── opportunities ──
      const sortedCats = [...cats].sort((a: any, b: any) => num(b.marginPercent) - num(a.marginPercent))
      if (sortedCats[0] && num(sortedCats[0].marginPercent) > 55) OPP.push({ text: `Push ${sortedCats[0].category} (${num(sortedCats[0].marginPercent).toFixed(0)}% margin) — feature it in banners & bundles to lift profit at no extra cost.`, tone: "good", tag: "Menu" })
      const promote = items.filter((i: any) => num(i.marginPercent) >= 55 && num(i.totalQty) < 8).sort((a: any, b: any) => num(b.marginPercent) - num(a.marginPercent))
      if (promote[0]) OPP.push({ text: `Promote hidden gem "${promote[0].itemName}" (${num(promote[0].marginPercent).toFixed(0)}% margin, only ${num(promote[0].totalQty).toFixed(0)} sold) — high margin but under-ordered.`, tone: "info", tag: "Menu" })
      if (basket?.summary && num(basket.summary.avgItemsPerOrder) < 2) OPP.push({ text: `Add checkout upsells (sides/drinks) — baskets average under 2 items, so even +0.5 items/order is meaningful revenue.`, tone: "info", tag: "Upsell" })
      if (byPlat.length >= 2) {
        const weak = [...byPlat].sort((a, b) => (a.revenue / Math.max(a.orders, 1)) - (b.revenue / Math.max(b.orders, 1)))[0]
        OPP.push({ text: `Lift AOV on ${weak.platform} (lowest at £${(weak.revenue / Math.max(weak.orders, 1)).toFixed(2)}/order) with combo deals.`, tone: "info", tag: "Platform" })
      }

      setDecisions(D); setActions(A); setOperational(O); setOpportunities(OPP)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const sections = [
    { title: "Key Weekly Decisions", icon: <ClipboardCheck className="size-4" />, items: decisions, desc: "The handful of choices management needs to make this week" },
    { title: "Recommended Actions", icon: <Sparkles className="size-4" />, items: actions, desc: "Concrete actions with the biggest profit impact" },
    { title: "Operational Insights", icon: <Settings className="size-4" />, items: operational, desc: "How the operation is running right now" },
    { title: "Suggested Opportunities", icon: <Lightbulb className="size-4" />, items: opportunities, desc: "Upside to capture next" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Decision Support</h1>
        <p className="text-sm text-muted-foreground">A clear, rule-based weekly summary — the decisions, actions, insights and opportunities that matter, straight from your data</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* Headline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Revenue", value: headline ? `£${headline.revenue.toFixed(0)}` : "—" },
          { label: "Orders", value: headline ? headline.orders.toLocaleString() : "—" },
          { label: "Avg Order Value", value: headline ? `£${headline.aov.toFixed(2)}` : "—" },
          { label: "Gross Margin", value: headline ? `${headline.margin.toFixed(1)}%` : "—" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              {loading ? <Skeleton className="h-7 w-20 mt-1" /> : <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">{s.icon} {s.title}</CardTitle>
              <CardDescription className="text-xs">{s.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : s.items.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nothing flagged in this period — all clear.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {s.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <CircleDot className={`size-3.5 mt-0.5 shrink-0 ${toneStyle[it.tone]}`} />
                      <div>
                        {it.tag && <Badge variant="outline" className="text-[9px] mr-1.5 align-middle">{it.tag}</Badge>}
                        <span className="text-foreground leading-relaxed">{it.text}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">How this works:</strong> this is a transparent rule-based layer — every line is derived directly from your synced Presto, Shipday and Google Sheets data using fixed thresholds (e.g. margin &lt; 30%, discount &gt; 15% of revenue, on-time &lt; 85%). No black-box AI; you can trace every recommendation back to a number on another page.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
