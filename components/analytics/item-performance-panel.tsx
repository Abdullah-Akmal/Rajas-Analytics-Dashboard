"use client"

import { useEffect, useState } from "react"
import { getItemPerformance, type ItemPerformanceResult } from "@/lib/analytics/item-performance"
import { STATUS_LABEL, STATUS_MEANING, type PerformanceStatus } from "@/lib/analytics/classification"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/** Status colours: green protect, red leaking, amber upside, muted for no-verdict. */
const STATUS_STYLE: Record<PerformanceStatus, string> = {
  STAR: "text-[oklch(0.7_0.15_150)] border-[oklch(0.7_0.15_150)]",
  FIX: "text-destructive border-destructive",
  PROMOTE: "text-[oklch(0.75_0.18_75)] border-[oklch(0.75_0.18_75)]",
  REVIEW: "text-[oklch(0.7_0.15_60)] border-[oklch(0.7_0.15_60)]",
  INSUFFICIENT_DATA: "text-muted-foreground border-border",
}

const ORDER: PerformanceStatus[] = ["STAR", "FIX", "PROMOTE", "REVIEW", "INSUFFICIENT_DATA"]

const money = (n: number) => `£${n.toFixed(2)}`
const pct = (n: number | null) => (n === null ? "N/A" : `${(n * 100).toFixed(0)}%`)

export function ItemPerformancePanel({
  startDate, endDate, location, brand,
}: { startDate: string; endDate: string; location: string; brand: string }) {
  const [data, setData] = useState<ItemPerformanceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<PerformanceStatus | "all">("all")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getItemPerformance(startDate, endDate, location, brand)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, location, brand])

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!data) return <p className="text-sm text-muted-foreground">No performance data.</p>

  const t = data.thresholds
  const rows = data.rows.filter(
    (r) => (filterStatus === "all" ? r.status !== "INSUFFICIENT_DATA" : r.status === filterStatus),
  )

  /** The "Why" column — states the rule that produced the verdict, in plain terms. */
  const why = (r: ItemPerformanceResult["rows"][number]) => {
    const demand = r.penetrationPct >= t.popularityCutoff ? "High demand" : "Low demand"
    if (r.status === "INSUFFICIENT_DATA") {
      return r.foodCostPct === null
        ? "No reliable cost — cannot judge economics"
        : `Only ${r.ordersWith} orders (needs ${t.minQualifyingOrders})`
    }
    return `${demand}; FC ${pct(r.foodCostPct)} vs target ${pct(t.targetFoodCostPct)}`
  }

  /** The commercial consequence, and for FIX the money on the table. */
  const impact = (r: ItemPerformanceResult["rows"][number]) => {
    if (r.status === "FIX") return `${money(r.theoreticalGpGap)} potential GP gap`
    if (r.status === "PROMOTE") return `${money(r.grossProfit)} GP at only ${r.ordersWith} orders`
    if (r.status === "STAR") return `${money(r.grossProfit)} GP — protect`
    if (r.status === "REVIEW") return `${money(r.revenue)} revenue, weak economics`
    return "—"
  }

  const action = (s: PerformanceStatus) =>
    s === "FIX" ? "Review Pricing / Cost"
      : s === "PROMOTE" ? "View Opportunity"
      : s === "REVIEW" ? "Commercial decision"
      : s === "STAR" ? "Protect" : "Wait for evidence"

  return (
    <div className="flex flex-col gap-4">
      {/* §8 wireframe: five status counts as the headline. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {ORDER.map((s) => (
          <Card
            key={s}
            className={`cursor-pointer transition-colors ${filterStatus === s ? "ring-1 ring-primary" : ""}`}
            onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
          >
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-foreground">{data.counts[s]}</p>
              <p className="text-xs font-medium text-foreground mt-1">{STATUS_LABEL[s]}</p>
              <p className="text-[10px] text-muted-foreground">{STATUS_MEANING[s]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">
                Priority {filterStatus !== "all" && `— ${STATUS_LABEL[filterStatus]}`}
              </CardTitle>
              <CardDescription className="text-xs">
                Ranked by commercial impact. Popularity is order penetration at the{" "}
                {t.popularityPercentile}th percentile ({t.popularityCutoff.toFixed(2)}%), minimum{" "}
                {t.minQualifyingOrders} orders; margin is judged against the{" "}
                {pct(t.targetFoodCostPct)} target food cost from Settings, not the menu median.
              </CardDescription>
            </div>
            {filterStatus !== "all" && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setFilterStatus("all")}>
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-8">#</TableHead>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Why</TableHead>
                  <TableHead className="text-xs">Commercial impact</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 40).map((r, i) => (
                  <TableRow key={r.productMasterId ?? r.productName}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs font-medium">
                      {r.productName}
                      {r.brand !== "Rajas" && (
                        <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0">{r.brand}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{why(r)}</TableCell>
                    <TableCell className="text-xs">{impact(r)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{action(r.status)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs text-muted-foreground text-center py-6">
                      No products in this status for the selected period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            GP gap is <strong>theoretical</strong> — the extra gross profit the same volume would
            produce at target economics. It is a potential, never guaranteed, figure.
            Based on {data.eligibleOrders.toLocaleString()} eligible orders.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
