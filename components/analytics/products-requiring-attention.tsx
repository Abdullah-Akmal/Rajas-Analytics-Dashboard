"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getItemPerformance, type ItemPerformanceResult } from "@/lib/analytics/item-performance"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ExternalLink } from "lucide-react"

/**
 * Products Requiring Attention (spec §7 — an ADD on the Item Profitability wireframe).
 *
 * The spec removes the "huge default item list" and replaces it with the short list of
 * products that actually need a decision, each carrying a margin status:
 *
 *   Margin Problem  economics materially past target
 *   Review          drifting, worth a look
 *   Cost Missing    no reliable cost — cannot be judged (§4)
 *
 * §7 is also explicit that Analytics must NOT duplicate the pricing engine: the actions
 * link out to the Pricing and Cost Analysis systems rather than recomputing a price here.
 */

type Row = ItemPerformanceResult["rows"][number]

const money = (n: number) => `£${n.toFixed(2)}`
const pct = (n: number | null) => (n === null ? "N/A" : `${(n * 100).toFixed(0)}%`)

/** Margin status per §7, derived from food cost against the commercial target. */
function marginStatus(r: Row, target: number, amber: number): {
  label: string; tone: string
} {
  if (r.foodCostPct === null) return { label: "Cost Missing", tone: "text-muted-foreground border-border" }
  if (r.foodCostPct > target + amber * 2) return { label: "Margin Problem", tone: "text-destructive border-destructive" }
  if (r.foodCostPct > target + amber) return { label: "Review", tone: "text-warning border-warning" }
  return { label: "On Target", tone: "text-success border-success" }
}

export function ProductsRequiringAttention({
  startDate, endDate, location, brand, productType, category,
}: {
  startDate: string; endDate: string; location: string; brand: string
  productType?: string; category?: string
}) {
  const [data, setData] = useState<ItemPerformanceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getItemPerformance(startDate, endDate, location, brand, productType, category)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, location, brand, productType, category])

  if (loading) return <Skeleton className="h-64 w-full" />
  if (!data) return <p className="text-sm text-muted-foreground">No data.</p>

  const { targetFoodCostPct: target, amberTolerancePct: amber } = data.thresholds

  // Attention = economics past target, or no reliable cost. Sorted by money at stake so
  // the top of the list is where the most profit is recoverable.
  const attention = data.rows
    .filter((r) => {
      const s = marginStatus(r, target, amber).label
      return s === "Margin Problem" || s === "Review" || (s === "Cost Missing" && r.revenue > 0)
    })
    .sort((a, b) => (b.theoreticalGpGap || b.revenue) - (a.theoreticalGpGap || a.revenue))

  const shown = showAll ? attention : attention.slice(0, 12)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Products Requiring Attention</CardTitle>
        <CardDescription className="text-sm">
          Products whose economics are past the {pct(target)} target food cost, or that
          cannot be judged because no cost is mapped. Ranked by profit at stake.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-sm">Product</TableHead>
                <TableHead className="text-sm">Type</TableHead>
                <TableHead className="text-sm text-right">Units</TableHead>
                <TableHead className="text-sm text-right">Revenue</TableHead>
                <TableHead className="text-sm text-right">FC%</TableHead>
                <TableHead className="text-sm text-right">GP</TableHead>
                <TableHead className="text-sm">Status</TableHead>
                <TableHead className="text-sm">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => {
                const st = marginStatus(r, target, amber)
                const missing = r.foodCostPct === null
                return (
                  <TableRow key={r.productMasterId ?? r.productName}>
                    <TableCell className="text-sm font-medium">
                      {r.productName}
                      {r.brand !== "Rajas" && (
                        <Badge variant="secondary" className="ml-1.5 text-xs px-1 py-0">{r.brand}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground capitalize">
                      {r.productType.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-sm text-right">{r.units.toFixed(0)}</TableCell>
                    <TableCell className="text-sm text-right">{money(r.revenue)}</TableCell>
                    {/* §4: a missing cost shows N/A — never a zero that reads as free. */}
                    <TableCell className="text-sm text-right">{pct(r.foodCostPct)}</TableCell>
                    <TableCell className="text-sm text-right">{missing ? "N/A" : money(r.grossProfit)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${st.tone}`}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {/* §7: link OUT — Analytics identifies the problem, it does not
                          maintain a second pricing engine. */}
                      {missing ? (
                        <Link href="/dashboard/settings" className="text-primary hover:underline inline-flex items-center gap-1">
                          Map cost <ExternalLink className="size-3" />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Review Pricing / Cost</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {attention.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-sm text-muted-foreground text-center py-6">
                    No products past target for this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {attention.length > 12 && (
          <Button
            size="sm" variant="outline" className="mt-3 h-7 text-xs"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show top 12" : `View all ${attention.length} products requiring attention`}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
