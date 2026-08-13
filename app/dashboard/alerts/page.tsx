"use client"

import { useState, useEffect } from "react"
import { getItemProfitability, getDailyRevenueTrend, getPlatformPerformance, getDeliveryKPIs } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { format, subDays } from "date-fns"
import { AlertTriangle, TrendingDown, TrendingUp, Zap, CheckCircle, Clock } from "lucide-react"

function num(v: unknown) { return Number(v ?? 0) }

type Severity = "critical" | "warning" | "info" | "ok"

interface Alert {
  id: string
  severity: Severity
  title: string
  detail: string
  channel?: string
  impact?: string
  action: string
  owner: string
}

const SEVERITY_STYLE: Record<Severity, { badge: string; icon: React.ReactNode; border: string }> = {
  critical: {
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    icon: <AlertTriangle className="size-3.5" />,
    border: "border-l-4 border-l-destructive",
  },
  warning: {
    badge: "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)] border-[oklch(0.38_0.1_75)]",
    icon: <TrendingDown className="size-3.5" />,
    border: "border-l-4 border-l-[oklch(0.55_0.18_75)]",
  },
  info: {
    badge: "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]",
    icon: <Zap className="size-3.5" />,
    border: "border-l-4 border-l-[oklch(0.55_0.15_220)]",
  },
  ok: {
    badge: "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]",
    icon: <CheckCircle className="size-3.5" />,
    border: "border-l-4 border-l-[oklch(0.55_0.15_150)]",
  },
}

export default function AlertsPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
    mode: "all",
    platform: "all",
  })
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilterSev] = useState<Severity | "all">("all")

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [items, trend, platforms, delivery] = await Promise.all([
        getItemProfitability(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform),
        getDailyRevenueTrend(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform),
        getPlatformPerformance(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform),
        getDeliveryKPIs(f.startDate, f.endDate),
      ])

      const generated: Alert[] = []

      // Revenue trend alert
      if (trend.length >= 4) {
        const recent = trend.slice(-3).map((d) => num(d.totalRevenue))
        const earlier = trend.slice(0, Math.max(1, trend.length - 3)).map((d) => num(d.totalRevenue))
        const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length
        const earlierAvg = earlier.reduce((s, v) => s + v, 0) / earlier.length
        const changePct = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : 0
        if (changePct < -15) {
          generated.push({
            id: "rev-down",
            severity: "critical",
            title: "Revenue declining",
            detail: `Last 3 days average £${recentAvg.toFixed(0)}/day vs £${earlierAvg.toFixed(0)}/day earlier in the period — a ${Math.abs(changePct).toFixed(1)}% drop.`,
            impact: `£${Math.abs((recentAvg - earlierAvg) * 3).toFixed(0)} estimated shortfall over 3 days`,
            action: "Investigate cause — platform issue, weather, or menu change? Run targeted promotion.",
            owner: "Manager",
          })
        } else if (changePct > 15) {
          generated.push({
            id: "rev-up",
            severity: "ok",
            title: "Revenue trending up",
            detail: `Last 3 days averaging £${recentAvg.toFixed(0)}/day — ${changePct.toFixed(1)}% above the earlier period.`,
            action: "Identify what's driving the growth and double down.",
            owner: "Manager",
          })
        }
      }

      // Low margin items with high volume
      const highVolLowMargin = items
        .filter((i) => num(i.totalQty) >= 10 && num(i.marginPercent) < 30)
        .sort((a, b) => num(b.totalQty) - num(a.totalQty))
        .slice(0, 3)
      if (highVolLowMargin.length > 0) {
        generated.push({
          id: "low-margin",
          severity: "warning",
          title: `${highVolLowMargin.length} high-volume item(s) below 30% margin`,
          detail: highVolLowMargin.map((i) => `• ${i.itemName} — ${num(i.totalQty).toFixed(0)} sold, ${num(i.marginPercent).toFixed(1)}% margin`).join("\n"),
          impact: `These items generate £${highVolLowMargin.reduce((s, i) => s + num(i.totalRevenue), 0).toFixed(0)} revenue but are destroying margin`,
          action: "Review recipe costs or raise price by 5-10%.",
          owner: "Operations",
        })
      }

      // Negative gross profit items
      const negProfit = items.filter((i) => num(i.grossProfit) < 0 && num(i.totalQty) > 0)
      if (negProfit.length > 0) {
        generated.push({
          id: "neg-profit",
          severity: "critical",
          title: `${negProfit.length} item(s) selling below cost`,
          detail: negProfit.slice(0, 5).map((i) => `• ${i.itemName} — selling at £${num(i.avgUnitPrice).toFixed(2)}, cost £${num(i.costPrice).toFixed(2)}`).join("\n"),
          impact: `Total loss: £${Math.abs(negProfit.reduce((s, i) => s + num(i.grossProfit), 0)).toFixed(2)}`,
          action: "Immediately raise prices or remove from menu.",
          owner: "Manager",
        })
      }

      // Per-platform breakdown alerts — one alert per platform with full numbers
      const byPlatform = Object.values(
        platforms.reduce<Record<string, { platform: string; revenue: number; discount: number; orders: number; aov: number }>>(
          (acc, row) => {
            const k = row.platform
            if (!acc[k]) acc[k] = { platform: k, revenue: 0, discount: 0, orders: 0, aov: 0 }
            acc[k].revenue += num(row.totalRevenue)
            acc[k].discount += num(row.totalDiscount)
            acc[k].orders += num(row.totalOrders)
            return acc
          }, {}
        )
      ).map((p) => ({ ...p, aov: p.orders > 0 ? p.revenue / p.orders : 0, discountRate: p.revenue > 0 ? (p.discount / p.revenue) * 100 : 0 }))
        .sort((a, b) => b.revenue - a.revenue)

      const overallRevenue = byPlatform.reduce((s, p) => s + p.revenue, 0)
      const overallAOV = byPlatform.reduce((s, p) => s + p.orders, 0) > 0
        ? overallRevenue / byPlatform.reduce((s, p) => s + p.orders, 0)
        : 0

      if (byPlatform.length > 0) {
        // Summary alert listing all platforms
        const summaryLines = byPlatform.map((p) =>
          `• ${p.platform}: £${p.revenue.toFixed(0)} rev · ${p.orders} orders · AOV £${p.aov.toFixed(2)} · discount ${p.discountRate.toFixed(1)}%`
        ).join("\n")
        generated.push({
          id: "platform-summary",
          severity: "info",
          title: `Platform breakdown — ${byPlatform.length} channel${byPlatform.length > 1 ? "s" : ""} active`,
          detail: summaryLines,
          impact: `Total revenue £${overallRevenue.toFixed(0)} across ${byPlatform.reduce((s, p) => s + p.orders, 0)} orders · overall AOV £${overallAOV.toFixed(2)}`,
          action: "Use platform revenue share to prioritise promotional spend and operational capacity.",
          owner: "Manager",
        })

        // Individual platform alerts for problems
        for (const p of byPlatform) {
          if (p.revenue === 0) continue
          const share = overallRevenue > 0 ? (p.revenue / overallRevenue) * 100 : 0
          const aovVsAvg = overallAOV > 0 ? ((p.aov - overallAOV) / overallAOV) * 100 : 0

          if (p.discountRate > 20) {
            generated.push({
              id: `platform-discount-${p.platform}`,
              severity: "warning",
              title: `High discount rate on ${p.platform}`,
              detail: `${p.platform} — discount rate ${p.discountRate.toFixed(1)}% (above 20% threshold).\n• Revenue: £${p.revenue.toFixed(0)} (${share.toFixed(1)}% of total)\n• Orders: ${p.orders} · AOV: £${p.aov.toFixed(2)}\n• Total discounts given: £${p.discount.toFixed(2)}`,
              channel: p.platform,
              impact: `£${p.discount.toFixed(2)} in discounts is eroding ${p.platform} margin by ${p.discountRate.toFixed(1)} percentage points`,
              action: `Review active promotions on ${p.platform}. Consider reducing offer frequency or tightening eligibility.`,
              owner: "Marketing",
            })
          }

          if (aovVsAvg < -15 && p.orders >= 5) {
            generated.push({
              id: `platform-low-aov-${p.platform}`,
              severity: "warning",
              title: `${p.platform} AOV ${Math.abs(aovVsAvg).toFixed(0)}% below average`,
              detail: `${p.platform} average order value is £${p.aov.toFixed(2)} vs overall AOV of £${overallAOV.toFixed(2)}.\n• Revenue: £${p.revenue.toFixed(0)} from ${p.orders} orders\n• Gap vs average: £${(overallAOV - p.aov).toFixed(2)} per order`,
              channel: p.platform,
              impact: `If ${p.platform} matched the overall AOV, additional revenue would be ~£${((overallAOV - p.aov) * p.orders).toFixed(0)}`,
              action: `Push upsells and bundles on ${p.platform}. Review minimum order thresholds.`,
              owner: "Operations",
            })
          }

          if (aovVsAvg > 20 && p.orders >= 5) {
            generated.push({
              id: `platform-high-aov-${p.platform}`,
              severity: "ok",
              title: `${p.platform} AOV ${aovVsAvg.toFixed(0)}% above average`,
              detail: `${p.platform} average order value is £${p.aov.toFixed(2)} vs overall AOV of £${overallAOV.toFixed(2)}.\n• Revenue: £${p.revenue.toFixed(0)} from ${p.orders} orders`,
              channel: p.platform,
              action: `Identify what drives high AOV on ${p.platform} and replicate on other channels.`,
              owner: "Manager",
            })
          }
        }
      }

      // Delivery on-time alert
      const overallDel = delivery.overall
      if (overallDel && num(overallDel.totalDeliveries) >= 5) {
        const onTimeRate = num(overallDel.totalDeliveries) > 0
          ? (num(overallDel.onTimeCount) / num(overallDel.totalDeliveries)) * 100
          : 0
        if (onTimeRate < 70) {
          generated.push({
            id: "delivery-late",
            severity: "critical",
            title: "Delivery on-time rate below 70%",
            detail: `${onTimeRate.toFixed(1)}% on-time rate across ${num(overallDel.totalDeliveries)} deliveries. Average delivery time: ${num(overallDel.avgDeliveryMinutes).toFixed(0)} min.`,
            impact: "Late deliveries reduce customer satisfaction and repeat order rate.",
            action: "Check driver dispatch delays and kitchen prep time. Add driver capacity during peak.",
            owner: "Operations",
          })
        } else if (onTimeRate >= 90) {
          generated.push({
            id: "delivery-ok",
            severity: "ok",
            title: "Delivery on-time rate strong",
            detail: `${onTimeRate.toFixed(1)}% on-time across ${num(overallDel.totalDeliveries)} deliveries.`,
            action: "Maintain current dispatch and prep standards.",
            owner: "Operations",
          })
        }
      }

      // Avg delivery time alert
      if (overallDel && num(overallDel.avgDeliveryMinutes) > 45 && num(overallDel.totalDeliveries) >= 5) {
        generated.push({
          id: "delivery-slow",
          severity: "warning",
          title: `Average delivery time ${num(overallDel.avgDeliveryMinutes).toFixed(0)} min — above 45 min target`,
          detail: `Dispatch time averages ${num(overallDel.avgDispatchMinutes).toFixed(0)} min. Total end-to-end: ${num(overallDel.avgDeliveryMinutes).toFixed(0)} min.`,
          action: "Investigate kitchen prep delays or driver availability during peak hours.",
          owner: "Operations",
        })
      }

      // No data alert
      if (items.length === 0) {
        generated.push({
          id: "no-data",
          severity: "info",
          title: "No sales data in selected range",
          detail: "Sync Presto POS data for this date range to generate alerts.",
          action: "Go to Data Sync and sync the required dates.",
          owner: "Admin",
        })
      }

      setAlerts(generated)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const visible = filter === "all" ? alerts : alerts.filter((a) => a.severity === filter)
  const counts = alerts.reduce<Record<Severity, number>>((acc, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc }, { critical: 0, warning: 0, info: 0, ok: 0 })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Alert System</h1>
        <p className="text-sm text-muted-foreground">Rule-based alerts on revenue, margin, discounts, and delivery — refreshed on every page load</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* Severity summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(["critical", "warning", "info", "ok"] as Severity[]).map((s) => (
          <Card
            key={s}
            className={`cursor-pointer transition-all ${filter === s ? "ring-2 ring-primary" : ""}`}
            onClick={() => setFilterSev((prev) => prev === s ? "all" : s)}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`size-9 rounded-lg flex items-center justify-center border ${SEVERITY_STYLE[s].badge}`}>{SEVERITY_STYLE[s].icon}</div>
              <div>
                <p className="text-xs text-muted-foreground capitalize">{s}</p>
                {loading ? <Skeleton className="h-6 w-8 mt-1" /> : <p className="text-xl font-bold">{counts[s] ?? 0}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filter !== "all" && (
        <button onClick={() => setFilterSev("all")} className="text-xs text-muted-foreground hover:text-foreground text-left underline underline-offset-2 w-fit">
          ← Show all alerts
        </button>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground text-sm">
            {filter === "all" ? "No alerts generated — sync data and try again" : `No ${filter} alerts in this period`}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((alert) => {
            const style = SEVERITY_STYLE[alert.severity]
            return (
              <Card key={alert.id} className={style.border}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.badge}`}>
                        {style.icon}
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                        {alert.channel && <Badge variant="outline" className="text-[10px]">{alert.channel}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{alert.detail}</p>
                      {alert.impact && (
                        <p className="text-xs font-medium text-foreground mt-1.5">Impact: {alert.impact}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Zap className="size-3" />
                          {alert.action}
                        </span>
                        <span className="text-muted-foreground">Owner: <strong>{alert.owner}</strong></span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
