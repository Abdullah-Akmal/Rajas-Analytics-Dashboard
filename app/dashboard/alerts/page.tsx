"use client"

import { useState, useEffect } from "react"
import { getItemProfitability } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { format, subDays } from "date-fns"
import { AlertTriangle, TrendingDown, TrendingUp, Zap } from "lucide-react"

type ItemRow = {
  itemName: string
  categoryName: string
  totalQty: number
  totalRevenue: number
  grossProfit: number
  marginPercent: number
  costPrice: number
  totalDiscount: number
}

export default function AlertsPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 7), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const i = await getItemProfitability(f.startDate, f.endDate, f.location)
      setItems(i as ItemRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  // Generate alerts dynamically from data
  const lowMarginItems = items.filter((i) => Number(i.marginPercent) < 30 && Number(i.totalQty) > 5)
  const highDiscountItems = items.filter((i) => Number(i.totalDiscount) > Number(i.totalRevenue) * 0.1)
  const noCostItems = items.filter((i) => !i.costPrice || Number(i.costPrice) === 0)
  const highVolumeItems = items.filter((i) => Number(i.totalQty) > 50).sort((a, b) => Number(b.totalQty) - Number(a.totalQty)).slice(0, 5)

  const alerts = [
    ...lowMarginItems.map((i) => ({
      type: "danger" as const,
      title: `Low margin: ${i.itemName}`,
      description: `Margin is ${Number(i.marginPercent).toFixed(1)}% — below 30% threshold`,
      action: "Review cost price or increase selling price",
      icon: <TrendingDown className="size-4" />,
    })),
    ...highDiscountItems.map((i) => ({
      type: "warning" as const,
      title: `High discount rate: ${i.itemName}`,
      description: `Discounts are ${((Number(i.totalDiscount) / Number(i.totalRevenue)) * 100).toFixed(1)}% of revenue`,
      action: "Review offer rules for this item",
      icon: <AlertTriangle className="size-4" />,
    })),
    ...noCostItems.slice(0, 5).map((i) => ({
      type: "info" as const,
      title: `Missing cost price: ${i.itemName}`,
      description: `No cost price in Google Sheet — margin cannot be calculated`,
      action: "Add cost price to your Google Sheet",
      icon: <AlertTriangle className="size-4" />,
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Smart Alerts</h1>
        <p className="text-sm text-muted-foreground">Auto-generated alerts from your live data — act on these weekly</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* Alert Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Critical Alerts", count: lowMarginItems.length, color: "text-destructive", bg: "bg-destructive/10" },
          { label: "Warnings", count: highDiscountItems.length, color: "text-[oklch(0.75_0.18_75)]", bg: "bg-[oklch(0.75_0.18_75)]/10" },
          { label: "Info Notices", count: noCostItems.length, color: "text-[oklch(0.6_0.15_200)]", bg: "bg-[oklch(0.6_0.15_200)]/10" },
        ].map((a) => (
          <Card key={a.label} className={a.bg}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{a.label}</p>
              <p className={`text-3xl font-bold ${a.color} mt-1`}>{a.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <TrendingUp className="size-10 text-[oklch(0.7_0.15_150)] mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">All clear — no alerts this period</p>
            <p className="text-xs text-muted-foreground mt-1">Sync more data to generate automated alerts</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((alert, i) => (
            <Card key={i} className={
              alert.type === "danger" ? "border-destructive/30" :
              alert.type === "warning" ? "border-[oklch(0.75_0.18_75)]/30" :
              "border-[oklch(0.6_0.15_200)]/30"
            }>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 shrink-0 ${
                    alert.type === "danger" ? "text-destructive" :
                    alert.type === "warning" ? "text-[oklch(0.75_0.18_75)]" :
                    "text-[oklch(0.6_0.15_200)]"
                  }`}>
                    {alert.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                      <Badge
                        variant={alert.type === "danger" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {alert.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{alert.description}</p>
                    <div className="flex items-center gap-1.5 mt-2">
                      <Zap className="size-3 text-primary" />
                      <p className="text-xs text-primary font-medium">{alert.action}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* High Volume Items */}
      {highVolumeItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">High Volume Items — Strategic Focus</CardTitle>
            <CardDescription className="text-xs">These items drive the most volume — ensure pricing and cost are optimised</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {highVolumeItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <span className="text-xs font-medium">{item.itemName}</span>
                    <Badge variant="outline" className="text-[10px]">{item.categoryName || "—"}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{Number(item.totalQty).toFixed(0)} sold</span>
                    <span className="text-xs font-semibold text-primary">{Number(item.marginPercent).toFixed(1)}% margin</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
