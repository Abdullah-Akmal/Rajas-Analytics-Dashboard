"use client"

import { useEffect, useState } from "react"
import { getOfferAnalytics, type OfferAnalyticsResult } from "@/lib/analytics/offers"
import { OFFER_STATUS_LABEL, type OfferStatus } from "@/lib/analytics/offer-status"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle } from "lucide-react"

const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLE: Record<OfferStatus, string> = {
  SCALE: "text-[oklch(0.7_0.15_150)] border-[oklch(0.7_0.15_150)]",
  KEEP: "text-[oklch(0.7_0.15_200)] border-[oklch(0.7_0.15_200)]",
  MODIFY: "text-[oklch(0.75_0.18_75)] border-[oklch(0.75_0.18_75)]",
  STOP: "text-destructive border-destructive",
  INSUFFICIENT_DATA: "text-muted-foreground border-border",
}

/**
 * Offers & Promotions (spec §10) — the merge of the two former offer pages.
 * Top KPIs, one offer table with Scale/Keep/Modify/Stop, and discount exposure.
 */
export function OffersPromotionsPanel({
  startDate, endDate, location,
}: { startDate: string; endDate: string; location: string }) {
  const [data, setData] = useState<OfferAnalyticsResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getOfferAnalytics(startDate, endDate, location)
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, location])

  if (loading) return <Skeleton className="h-72 w-full" />
  if (!data) return <p className="text-sm text-muted-foreground">No offer data.</p>

  const t = data.totals

  return (
    <div className="flex flex-col gap-4">
      {/* §10 top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Offer Revenue", value: money(t.offerRevenue) },
          { label: "Offer Orders", value: t.offerOrders.toLocaleString() },
          { label: "Raja's Discount", value: money(t.rajasDiscount), note: "actual funded" },
          { label: "Contribution", value: money(t.contribution) },
          { label: "Est. Incremental", value: t.estIncremental === null ? "N/A" : money(t.estIncremental), note: "vs baseline" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>
              {k.note && <p className="text-[10px] text-muted-foreground">{k.note}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Offers</CardTitle>
          <CardDescription className="text-xs">
            {data.offersConfigured > 0
              ? `${data.offersConfigured} offer setup record(s) configured.`
              : "No offer setup records yet — offers are grouped by their POS category and every discount is attributed to Raja's in full."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Offer</TableHead>
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs text-right">Orders</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">Raja&apos;s Discount</TableHead>
                  <TableHead className="text-xs text-right">Contribution</TableHead>
                  <TableHead className="text-xs text-right">Est. Incremental</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.slice(0, 30).map((r) => (
                  <TableRow key={r.offerKey}>
                    <TableCell className="text-xs font-medium">
                      {r.name}
                      {!r.hasSetupRecord && (
                        <Badge variant="secondary" className="ml-1.5 text-[9px] px-1 py-0">no setup record</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs capitalize">{r.channel}</TableCell>
                    <TableCell className="text-xs text-right">{r.orders}</TableCell>
                    <TableCell className="text-xs text-right">{money(r.revenue)}</TableCell>
                    <TableCell className="text-xs text-right">{money(r.rajasDiscount)}</TableCell>
                    <TableCell className="text-xs text-right font-medium">{money(r.contribution)}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">
                      {r.estIncremental === null ? "N/A" : money(r.estIncremental)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[r.status]}`}>
                        {OFFER_STATUS_LABEL[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-xs text-muted-foreground text-center py-6">
                      No discounted or offer-category lines in this period.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Discount Exposure</CardTitle>
          <CardDescription className="text-xs">Discount as a share of each channel&apos;s revenue</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {data.exposure.map((e) => (
              <div key={e.channel} className="flex items-center gap-3">
                <span className="text-xs w-24 capitalize">{e.channel}</span>
                <div className="flex-1 h-2 rounded bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(e.discountPct * 5, 100)}%` }}
                  />
                </div>
                <span className="text-xs w-14 text-right">{e.discountPct.toFixed(1)}%</span>
                <span className="text-[10px] text-muted-foreground w-20 text-right">{money(e.discount)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* §10 incrementality warning — required wording, not optional. */}
      <Card className="border-[oklch(0.75_0.18_75)]/40">
        <CardContent className="p-4 flex gap-2">
          <AlertTriangle className="size-4 text-[oklch(0.75_0.18_75)] shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-foreground">Incrementality is estimated, not measured</p>
            <p className="text-[11px] text-muted-foreground">
              For V1, incremental orders and contribution are estimates using a comparable
              baseline unless a true control method exists.
            </p>
            {data.caveats.map((c) => (
              <p key={c} className="text-[11px] text-muted-foreground">{c}</p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
