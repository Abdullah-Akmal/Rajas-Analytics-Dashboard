"use client"

import { useState, useEffect } from "react"
import { getDeliveryOps, type DeliveryOpsResult } from "@/lib/operations/delivery"
import { DateLocationFilter, DEFAULT_RANGE_DAYS } from "@/components/date-location-filter"
import { KpiCard } from "@/components/kpi-card"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { format, subDays } from "date-fns"
import { Truck, Clock, Target, PoundSterling, Calculator, Wallet } from "lucide-react"

/**
 * Delivery & Driver Analytics (Operations corrections §5). Hyde Park only.
 * Removed: area revenue/orders/AOV charts, zone ranking and the per-area
 * "profitability" that used Shipday's own driver payment instead of Raja's
 * driver economics. Exceptions and compact tables replace them.
 */

type Ok = Extract<DeliveryOpsResult, { applicable: true }>
const money = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toFixed(2)}`
const fmtHour = (h: number) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`)
const TONE: Record<string, string> = {
  good: "border-success bg-success-subtle",
  warning: "border-warning bg-warning-subtle",
  problem: "border-destructive bg-destructive/10",
  neutral: "border-border bg-secondary",
}

export default function DeliveryPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), DEFAULT_RANGE_DAYS), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [data, setData] = useState<DeliveryOpsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDetail, setShowDetail] = useState(false)

  const fetchData = async (f: { startDate: string; endDate: string; location: string }) => {
    setLoading(true)
    try { setData(await getDeliveryOps(f.startDate, f.endDate, f.location)) } finally { setLoading(false) }
  }
  useEffect(() => { fetchData(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ok: Ok | null = data && data.applicable ? data : null
  const k = ok?.kpis

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Delivery &amp; Driver Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Hyde Park in-house deliveries from Shipday, costed with the driver rates in Settings.
        </p>
      </div>

      <DateLocationFilter showChannel={false} onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {!loading && data && !data.applicable && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground max-w-2xl mx-auto">{data.reason}</CardContent></Card>
      )}

      {(loading || ok) && (
        <>
          {filters.location === "all" && (
            <p className="text-sm text-muted-foreground -mt-2">
              Showing Hyde Park — Grand Arcade uses platform riders and has no in-house driver data.
            </p>
          )}

          {/* ── Headline KPIs (item 13) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            {loading || !k ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
              <>
                <KpiCard title="Deliveries" value={k.deliveries.toLocaleString()} subValue="Completed in Shipday" icon={<Truck className="size-4" />} />
                <KpiCard title="Avg Delivery Time" value={`${k.avgMinutes.toFixed(0)} min`} subValue="Placed → delivered" icon={<Clock className="size-4" />} />
                <KpiCard
                  title="Within Target"
                  value={`${k.withinTargetPct.toFixed(0)}%`}
                  subValue={`≤ ${ok!.settings.targetMinutes} min (Settings)`}
                  accent={k.withinTargetPct >= 85 ? "success" : k.withinTargetPct >= 70 ? "warning" : "danger"}
                  icon={<Target className="size-4" />}
                />
                <KpiCard
                  title="Driver Cost"
                  value={money(k.driverCost)}
                  subValue={ok!.costBreakdown.shiftHours === 0 ? "Hourly pay missing" : `${ok!.costBreakdown.shiftHours.toFixed(1)} shift hours`}
                  accent={ok!.costBreakdown.shiftHours === 0 ? "warning" : "default"}
                  icon={<Wallet className="size-4" />}
                />
                <KpiCard title="Driver Cost / Delivery" value={money(k.costPerDelivery)} icon={<Calculator className="size-4" />} />
                <KpiCard
                  title="Delivery Contribution"
                  value={money(k.contribution)}
                  subValue={k.contributionComplete ? `${money(k.contributionPerDelivery)} per delivery` : "Incomplete — see warnings"}
                  accent={k.contributionComplete ? (k.contribution >= 0 ? "success" : "danger") : "warning"}
                  icon={<PoundSterling className="size-4" />}
                />
              </>
            )}
          </div>

          {/* ── Exceptions & data warnings first (item 22) ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Exceptions &amp; Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {loading ? <Skeleton className="h-20 w-full" /> : (
                <>
                  {ok!.exceptions.map((e, i) => (
                    <p key={i} className={`text-sm rounded-md border-l-4 px-3 py-2 ${TONE[e.tone]}`}>{e.text}</p>
                  ))}
                  {ok!.incompleteReasons.length > 0 && (
                    <div className="mt-2 rounded-md border border-warning px-3 py-2">
                      <p className="text-sm font-semibold text-warning mb-1">Data warnings</p>
                      <ul className="list-disc pl-5 flex flex-col gap-1">
                        {ok!.incompleteReasons.map((r, i) => <li key={i} className="text-sm">{r}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Compact time bands (item 14) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Delivery Time Bands</CardTitle>
                <CardDescription className="text-sm">Placed to delivered</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {loading ? <Skeleton className="h-28 w-full" /> : ok!.timeBands.map((b, i) => (
                  <div key={b.band} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <span>{b.band}</span>
                      <span className="font-medium">{b.deliveries} ({b.pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div className={`h-full ${i === 0 ? "bg-success" : i === 1 ? "bg-warning" : "bg-destructive"}`} style={{ width: `${Math.min(b.pct, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Contribution (item 21) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Delivery Contribution</CardTitle>
                <CardDescription className="text-sm">
                  Revenue − commission − live food cost − Raja&apos;s discount − driver cost. {ok?.revenueLabel}{" "}
                  {ok ? `${ok.linkedPct.toFixed(0)}% of deliveries matched to their POS order.` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {loading ? <Skeleton className="h-28 w-full" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-sm">Orders</TableHead>
                        <TableHead className="text-sm text-right">Deliveries</TableHead>
                        <TableHead className="text-sm text-right">Revenue</TableHead>
                        <TableHead className="text-sm text-right">Costs</TableHead>
                        <TableHead className="text-sm text-right">Contribution</TableHead>
                        <TableHead className="text-sm text-right">Per delivery</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ok!.contribution.map((c) => (
                        <TableRow key={c.segment}>
                          <TableCell className="text-sm font-medium">{c.segment}</TableCell>
                          <TableCell className="text-sm text-right">{c.deliveries}</TableCell>
                          <TableCell className="text-sm text-right">{money(c.revenue)}</TableCell>
                          <TableCell className="text-sm text-right" title={`Commission ${money(c.commission)} · Food ${money(c.foodCost)} · Discount ${money(c.discount)} · Driver ${money(c.driverCost)}`}>
                            {money(c.commission + c.foodCost + c.discount + c.driverCost)}
                          </TableCell>
                          <TableCell className={`text-sm text-right font-medium ${c.contribution < 0 ? "text-destructive" : ""}`}>{money(c.contribution)}</TableCell>
                          <TableCell className="text-sm text-right">{money(c.perDelivery)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Driver table (item 18) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Drivers</CardTitle>
              <CardDescription className="text-sm">
                Hours come from the Driver Shift log; cost = hours × £{ok?.settings.hourlyRate.toFixed(2) ?? "…"} + £
                {ok?.settings.basePerDelivery.toFixed(2) ?? "…"} per delivery + £{ok?.settings.extraPerMile.toFixed(2) ?? "…"} per mile over{" "}
                {ok?.settings.includedMiles ?? "…"} miles.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? <Skeleton className="h-40 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-sm">Driver</TableHead>
                      <TableHead className="text-sm text-right">Hours</TableHead>
                      <TableHead className="text-sm text-right">Deliveries</TableHead>
                      <TableHead className="text-sm text-right">Avg time</TableHead>
                      <TableHead className="text-sm text-right">Within target</TableHead>
                      <TableHead className="text-sm text-right">Miles</TableHead>
                      <TableHead className="text-sm text-right">Cost</TableHead>
                      <TableHead className="text-sm text-right">Cost / delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ok!.drivers.map((d) => (
                      <TableRow key={d.driver}>
                        <TableCell className="text-sm font-medium">{d.driver}</TableCell>
                        <TableCell className={`text-sm text-right ${d.hours === null ? "text-warning" : ""}`}>{d.hours === null ? "Not logged" : d.hours.toFixed(1)}</TableCell>
                        <TableCell className="text-sm text-right">{d.deliveries}</TableCell>
                        <TableCell className="text-sm text-right">{d.deliveries ? `${d.avgMinutes.toFixed(0)} min` : "—"}</TableCell>
                        <TableCell className="text-sm text-right">{d.deliveries ? `${d.withinPct.toFixed(0)}%` : "—"}</TableCell>
                        <TableCell className="text-sm text-right">{d.miles.toFixed(1)}</TableCell>
                        <TableCell className="text-sm text-right">{money(d.cost)}</TableCell>
                        <TableCell className="text-sm text-right">{d.costPerDelivery === null ? "—" : money(d.costPerDelivery)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Utilisation and distance — behind View Details to keep the page short */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Hourly Utilisation &amp; Distance Bands</CardTitle>
                <CardDescription className="text-sm">
                  Where time is lost: dispatch {ok?.stages.dispatch.toFixed(0) ?? "…"} min · pick-up {ok?.stages.kitchen.toFixed(0) ?? "…"} min · road {ok?.stages.road.toFixed(0) ?? "…"} min
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowDetail((v) => !v)}>
                {showDetail ? "Hide details" : "View details"}
              </Button>
            </CardHeader>
            {showDetail && ok && (
              <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-sm">Hour</TableHead>
                      <TableHead className="text-sm text-right">Deliveries</TableHead>
                      <TableHead className="text-sm text-right">Drivers active</TableHead>
                      <TableHead className="text-sm text-right">Per driver</TableHead>
                      <TableHead className="text-sm text-right">Cost / delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ok.hourly.map((h) => (
                      <TableRow key={h.hour}>
                        <TableCell className="text-sm font-medium">{fmtHour(h.hour)}</TableCell>
                        <TableCell className="text-sm text-right">{h.deliveries}</TableCell>
                        <TableCell className="text-sm text-right">{h.driversActive.toFixed(1)}</TableCell>
                        <TableCell className="text-sm text-right">{h.perDriver.toFixed(1)}</TableCell>
                        <TableCell className="text-sm text-right">{h.costPerDelivery === null ? "Needs shifts" : money(h.costPerDelivery)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-sm">Distance</TableHead>
                      <TableHead className="text-sm text-right">Deliveries</TableHead>
                      <TableHead className="text-sm text-right">Avg time</TableHead>
                      <TableHead className="text-sm text-right">Cost / delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ok.distanceBands.map((b) => (
                      <TableRow key={b.band}>
                        <TableCell className="text-sm font-medium">{b.band}</TableCell>
                        <TableCell className="text-sm text-right">{b.deliveries}</TableCell>
                        <TableCell className="text-sm text-right">{b.deliveries ? `${b.avgMinutes.toFixed(0)} min` : "—"}</TableCell>
                        <TableCell className="text-sm text-right">{b.costPerDelivery === null ? (b.deliveries ? "Needs shifts" : "—") : money(b.costPerDelivery)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
