"use client"

import { useState, useEffect } from "react"
import { getItemProfitability, getPlatformPerformance, getDeliveryPerformance, getCategoryPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { format, subDays } from "date-fns"
import { Zap, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Target } from "lucide-react"

export default function ActionsPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 7), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [items, setItems] = useState<unknown[]>([])
  const [platforms, setPlatforms] = useState<unknown[]>([])
  const [drivers, setDrivers] = useState<unknown[]>([])
  const [categories, setCategories] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [i, p, d, c] = await Promise.all([
        getItemProfitability(f.startDate, f.endDate, f.location),
        getPlatformPerformance(f.startDate, f.endDate, f.location),
        getDeliveryPerformance(f.startDate, f.endDate),
        getCategoryPerformance(f.startDate, f.endDate, f.location),
      ])
      setItems(i)
      setPlatforms(p)
      setDrivers(d)
      setCategories(c)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  type ItemWithNumbers = { itemName: string; marginPercent: number; totalQty: number; totalRevenue: number; grossProfit: number; categoryName: string }
  type PlatformWithNumbers = { platform: string; totalRevenue: number; totalOrders: number; totalDiscount: number }
  type DriverWithNumbers = { driverName: string; successRate: number; avgDeliveryMinutes: number; totalDeliveries: number }
  type CategoryWithNumbers = { category: string; marginPercent: number; totalRevenue: number }

  const typedItems = items as ItemWithNumbers[]
  const typedPlatforms = platforms as PlatformWithNumbers[]
  const typedDrivers = drivers as DriverWithNumbers[]
  const typedCategories = categories as CategoryWithNumbers[]

  // Generate strategic actions from data
  const actions: { priority: "high" | "medium" | "low"; category: string; action: string; impact: string; icon: React.ReactNode }[] = []

  // Low margin high volume items
  const atRisk = typedItems.filter((i) => Number(i.marginPercent) < 35 && Number(i.totalQty) > 10)
  if (atRisk.length > 0) {
    actions.push({
      priority: "high",
      category: "Pricing",
      action: `Review pricing for ${atRisk.slice(0, 2).map((i) => i.itemName).join(", ")}${atRisk.length > 2 ? ` and ${atRisk.length - 2} more` : ""}`,
      impact: `Improve margin on items generating £${atRisk.reduce((s, i) => s + Number(i.totalRevenue), 0).toFixed(0)} revenue`,
      icon: <TrendingUp className="size-4" />,
    })
  }

  // Best platform to push
  const topPlatform = [...typedPlatforms].sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue))[0]
  if (topPlatform) {
    actions.push({
      priority: "medium",
      category: "Platform",
      action: `Double down on ${topPlatform.platform} — your top revenue channel`,
      impact: `£${Number(topPlatform.totalRevenue).toFixed(0)} revenue, push marketing here`,
      icon: <Target className="size-4" />,
    })
  }

  // High discount platforms
  const highDiscount = typedPlatforms.filter((p) => Number(p.totalDiscount) > Number(p.totalRevenue) * 0.08)
  if (highDiscount.length > 0) {
    actions.push({
      priority: "high",
      category: "Offers",
      action: `Reduce discounting on ${highDiscount.map((p) => p.platform).join(", ")}`,
      impact: `Discounts exceeding 8% of revenue — review offer strategy`,
      icon: <AlertTriangle className="size-4" />,
    })
  }

  // Slow drivers
  const slowDrivers = typedDrivers.filter((d) => Number(d.avgDeliveryMinutes) > 40)
  if (slowDrivers.length > 0) {
    actions.push({
      priority: "medium",
      category: "Delivery",
      action: `Address delivery times for ${slowDrivers.map((d) => d.driverName).join(", ")}`,
      impact: `Average delivery over 40 minutes — customer satisfaction at risk`,
      icon: <TrendingDown className="size-4" />,
    })
  }

  // Best category to promote
  const bestCat = [...typedCategories].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent))[0]
  if (bestCat && Number(bestCat.marginPercent) > 60) {
    actions.push({
      priority: "medium",
      category: "Menu",
      action: `Promote ${bestCat.category} — your highest margin category`,
      impact: `${Number(bestCat.marginPercent).toFixed(0)}% margin — feature it on platforms`,
      icon: <CheckCircle className="size-4" />,
    })
  }

  // Top performers to protect
  const topItems = [...typedItems].sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit)).slice(0, 3)
  if (topItems.length > 0) {
    actions.push({
      priority: "low",
      category: "Menu",
      action: `Protect availability of ${topItems.map((i) => i.itemName).slice(0, 2).join(", ")}`,
      impact: `Your top profit contributors — ensure consistent quality and stock`,
      icon: <CheckCircle className="size-4" />,
    })
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const sorted = actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Weekly Action Panel</h1>
        <p className="text-sm text-muted-foreground">Strategic priorities generated from your live data — review weekly</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* Action Count */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "High Priority", count: sorted.filter((a) => a.priority === "high").length, color: "text-destructive" },
          { label: "Medium Priority", count: sorted.filter((a) => a.priority === "medium").length, color: "text-[oklch(0.75_0.18_75)]" },
          { label: "Low Priority", count: sorted.filter((a) => a.priority === "low").length, color: "text-[oklch(0.6_0.15_200)]" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color} mt-1`}>{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions */}
      {loading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Zap className="size-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No actions generated yet</p>
            <p className="text-xs text-muted-foreground mt-1">Sync data from Presto, Shipday and Google Sheets to generate strategic actions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((action, i) => (
            <Card key={i} className={
              action.priority === "high" ? "border-l-2 border-l-destructive" :
              action.priority === "medium" ? "border-l-2 border-l-[oklch(0.75_0.18_75)]" :
              "border-l-2 border-l-[oklch(0.6_0.15_200)]"
            }>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 shrink-0 ${
                    action.priority === "high" ? "text-destructive" :
                    action.priority === "medium" ? "text-[oklch(0.75_0.18_75)]" :
                    "text-[oklch(0.6_0.15_200)]"
                  }`}>
                    {action.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant={action.priority === "high" ? "destructive" : "secondary"} className="text-[10px]">
                        {action.priority}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{action.category}</Badge>
                    </div>
                    <p className="text-sm font-semibold text-foreground">{action.action}</p>
                    <p className="text-xs text-muted-foreground mt-1">{action.impact}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Separator />

      {/* Strategic Framework */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Weekly Review Framework</CardTitle>
          <CardDescription className="text-xs">Recommended review cadence for strategic decisions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[
              {
                day: "Monday",
                tasks: ["Review last week revenue vs target", "Check platform performance", "Identify top & bottom items"],
              },
              {
                day: "Wednesday",
                tasks: ["Review delivery times & driver performance", "Check discount impact", "Adjust offers if needed"],
              },
              {
                day: "Friday",
                tasks: ["Update item costs in Google Sheet", "Review margin alerts", "Plan weekend promotions"],
              },
            ].map((r) => (
              <div key={r.day} className="p-3 rounded-lg bg-secondary">
                <p className="text-xs font-semibold text-primary mb-2">{r.day}</p>
                <ul className="flex flex-col gap-1">
                  {r.tasks.map((t, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle className="size-3 text-[oklch(0.7_0.15_150)] mt-0.5 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
