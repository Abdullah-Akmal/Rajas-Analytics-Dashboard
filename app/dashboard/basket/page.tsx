"use client"

import { useState, useEffect } from "react"
import { getBasketGrowth, type BasketGrowthResult } from "@/lib/operations/basket"
import { DateLocationFilter, DEFAULT_RANGE_DAYS } from "@/components/date-location-filter"
import { KpiCard } from "@/components/kpi-card"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { format, subDays } from "date-fns"
import { PoundSterling, ShoppingCart, PlusCircle, Receipt } from "lucide-react"

/**
 * Basket Growth / Add-on Opportunities (Operations corrections §6).
 *
 * Removed from the main page: Order Line Structure Validation (now in Settings →
 * Data Sync), Top Items by Order Frequency (Item Performance covers it) and the
 * Solo-to-Meal framing. The item frequency table sits behind View Details.
 */

const money = (n: number) => `£${n.toFixed(2)}`
const pct = (n: number | null) => (n === null ? "No cost" : `${(n * 100).toFixed(0)}%`)
const TONE: Record<string, string> = {
  good: "border-success bg-success-subtle",
  warning: "border-warning bg-warning-subtle",
  problem: "border-destructive bg-destructive/10",
  neutral: "border-border bg-secondary",
}
const ECON: Record<string, { label: string; cls: string }> = {
  good: { label: "Within target", cls: "text-success" },
  poor: { label: "Above target", cls: "text-destructive" },
  no_cost: { label: "No cost mapped", cls: "text-warning" },
}

export default function BasketPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), DEFAULT_RANGE_DAYS), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all", channel: "all", mode: "all", platform: "all",
    brand: "all", productType: "all", category: "all",
  })
  const [data, setData] = useState<BasketGrowthResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showItems, setShowItems] = useState(false)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      setData(await getBasketGrowth(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform,
        { brand: f.brand, productType: f.productType, category: f.category }))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { fetchData(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const k = data?.kpis

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Basket Growth &amp; Add-on Opportunities</h1>
        <p className="text-sm text-muted-foreground">
          Genuine extra items added on top of a customer&apos;s meal or order. Items already included in a
          meal (e.g. the fries and drink in a meal) are not counted as add-ons.
        </p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* ── Headline (item 24) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading || !k ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <KpiCard title="Average Order Value" value={money(k.aov)} subValue={`${k.orders.toLocaleString()} orders`} icon={<PoundSterling className="size-4" />} />
            <KpiCard title="Items / Order" value={k.itemsPerOrder.toFixed(2)} subValue="Paid products, meal components excluded" icon={<ShoppingCart className="size-4" />} />
            <KpiCard
              title="True Add-on Attach"
              value={`${k.addonAttachPct.toFixed(1)}%`}
              subValue={`${k.addonOrders.toLocaleString()} of ${k.mainOrders.toLocaleString()} main orders`}
              icon={<PlusCircle className="size-4" />}
            />
            <KpiCard
              title="Orders with a Main"
              value={k.mainOrders.toLocaleString()}
              subValue="The base for attach rates"
              icon={<Receipt className="size-4" />}
            />
          </>
        )}
      </div>

      {/* ── Basket Growth Actions — top 3-5, near the top (item 37) ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Basket Growth Actions</CardTitle>
          <CardDescription className="text-sm">
            Only add-ons with enough evidence and acceptable food cost are recommended. Basket differences
            are associations, not proven incremental revenue — test before scaling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-24 w-full" /> : (
            <ul className="flex flex-col gap-2">
              {(data?.actions ?? []).map((a, i) => (
                <li key={i} className={`text-sm rounded-md border-l-4 px-3 py-2 ${TONE[a.tone]}`}>
                  <span className="font-semibold mr-2">{a.label}:</span>{a.text}
                </li>
              ))}
            </ul>
          )}
          {!loading && (data?.caveats.length ?? 0) > 0 && (
            <p className="text-sm text-warning mt-3">{data!.caveats.join(" ")}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Add-on attach by group (item 27) ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Add-on Attach Rate</CardTitle>
          <CardDescription className="text-sm">
            Share of orders with a main that also bought a paid add-on of each type. Food cost is live from the
            costing chain. {data?.revenueLabel}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <Skeleton className="h-48 w-full" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-sm">Add-on</TableHead>
                  <TableHead className="text-sm text-right">Attach rate</TableHead>
                  <TableHead className="text-sm text-right">Orders</TableHead>
                  <TableHead className="text-sm text-right">AOV with</TableHead>
                  <TableHead className="text-sm text-right">AOV without</TableHead>
                  <TableHead className="text-sm text-right">Associated lift</TableHead>
                  <TableHead className="text-sm text-right">Food cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.groups ?? []).map((g) => (
                  <TableRow key={g.group}>
                    <TableCell className="text-sm font-medium">{g.group}</TableCell>
                    <TableCell className="text-sm text-right">{g.attachPct.toFixed(1)}%</TableCell>
                    <TableCell className="text-sm text-right">{g.attachedOrders.toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-right">{g.attachedOrders > 0 ? money(g.aovWith) : "—"}</TableCell>
                    <TableCell className="text-sm text-right">{money(g.aovWithout)}</TableCell>
                    <TableCell className="text-sm text-right">{g.attachedOrders > 0 ? `${g.associatedLift >= 0 ? "+" : ""}${money(g.associatedLift)}` : "—"}</TableCell>
                    <TableCell className="text-sm text-right">
                      {pct(g.foodCostPct)}
                      {g.foodCostPct !== null && g.costedPct < 80 && (
                        <span className="text-warning"> ({g.costedPct.toFixed(0)}% costed)</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Compact items-per-order distribution (item 30) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Items per Order</CardTitle>
            <CardDescription className="text-sm">Paid products per order</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {loading ? <Skeleton className="h-28 w-full" /> : (data?.distribution ?? []).map((d) => (
              <div key={d.bucket} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span>{d.bucket}</span>
                  <span className="font-medium">{d.orders.toLocaleString()} ({d.pct.toFixed(0)}%)</span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(d.pct, 100)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Frequently bought together (items 33-34) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Frequently Bought Together</CardTitle>
            <CardDescription className="text-sm">
              Paid products in the same order. Meal components and cross-brand pairs are excluded. Pairs under{" "}
              {data?.minPairOrders ?? "…"} orders (Settings → Basket Growth) are Insufficient Data.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? <Skeleton className="h-40 w-full" /> : (data?.pairs.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No repeated combinations in this selection.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-sm">Pair</TableHead>
                    <TableHead className="text-sm">Type</TableHead>
                    <TableHead className="text-sm text-right">Orders</TableHead>
                    <TableHead className="text-sm text-right">Lift</TableHead>
                    <TableHead className="text-sm">Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.pairs.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-medium">{p.itemA} + {p.itemB}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.kind}</TableCell>
                      <TableCell className="text-sm text-right">{p.pairOrders}</TableCell>
                      <TableCell className="text-sm text-right">{p.lift.toFixed(1)}×</TableCell>
                      <TableCell className={`text-sm ${p.status === "ok" ? "text-success" : "text-warning"}`}>
                        {p.status === "ok" ? "Sufficient" : "Insufficient Data"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add-on item detail behind View Details (item 32) */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Add-on Item Detail</CardTitle>
            <CardDescription className="text-sm">Top add-on items with live food cost and gross profit per unit</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowItems((v) => !v)}>
            {showItems ? "Hide details" : "View details"}
          </Button>
        </CardHeader>
        {showItems && (
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-sm">Item</TableHead>
                  <TableHead className="text-sm">Type</TableHead>
                  <TableHead className="text-sm text-right">Main orders with it</TableHead>
                  <TableHead className="text-sm text-right">Revenue</TableHead>
                  <TableHead className="text-sm text-right">Food cost</TableHead>
                  <TableHead className="text-sm text-right">Target</TableHead>
                  <TableHead className="text-sm text-right">GP / unit</TableHead>
                  <TableHead className="text-sm">Economics</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.addonItems ?? []).map((i) => (
                  <TableRow key={i.item}>
                    <TableCell className="text-sm font-medium">{i.item}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{i.group}</TableCell>
                    <TableCell className="text-sm text-right">{i.attachedOrders} ({i.attachPct.toFixed(1)}%)</TableCell>
                    <TableCell className="text-sm text-right">{money(i.revenue)}</TableCell>
                    <TableCell className="text-sm text-right">{pct(i.foodCostPct)}</TableCell>
                    <TableCell className="text-sm text-right">{(i.target * 100).toFixed(0)}%</TableCell>
                    <TableCell className="text-sm text-right">{i.gpPerUnit === null ? "—" : money(i.gpPerUnit)}</TableCell>
                    <TableCell className={`text-sm ${ECON[i.economics].cls}`}>{ECON[i.economics].label}</TableCell>
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
