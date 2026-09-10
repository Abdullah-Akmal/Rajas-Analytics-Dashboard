"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getChannelPerformance, type ChannelPerformanceResult } from "@/lib/analytics/channel"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, ArrowRight } from "lucide-react"

const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Percent change, or an em-dash when there is no comparable baseline. */
function Delta({ value, unit = "%" }: { value: number | null | undefined; unit?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-xs text-muted-foreground">no baseline</span>
  }
  const up = value >= 0
  return (
    <span className={`text-xs ${up ? "text-success" : "text-destructive"}`}>
      {up ? "+" : ""}{value.toFixed(1)}{unit}
    </span>
  )
}

export function ChannelPerformancePanel({
  startDate, endDate, location, brand, productType, category,
}: {
  startDate: string; endDate: string; location: string
  brand?: string; productType?: string; category?: string
}) {
  const [data, setData] = useState<ChannelPerformanceResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getChannelPerformance(startDate, endDate, location, { brand, productType, category })
      .then((r) => { if (!cancelled) { setData(r); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, location, brand, productType, category])

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
  if (!data) return <p className="text-sm text-muted-foreground">No channel data.</p>

  const t = data.totals

  return (
    <div className="flex flex-col gap-4">
      {/* §9 headline KPIs: Revenue, Orders, AOV, Direct %, Third-party % */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Revenue", value: money(t.revenue), delta: t.revenueChangePct },
          { label: "Orders", value: t.orders.toLocaleString(), delta: t.ordersChangePct },
          { label: "AOV", value: money(t.aov), delta: t.aovChangePct },
          { label: "Direct Mix", value: `${t.directPct.toFixed(0)}%`, delta: t.directPctChangePts, unit: " pts" },
          { label: "Third Party", value: `${t.thirdPartyPct.toFixed(0)}%` },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className="text-3xl font-bold text-foreground mt-1">{k.value}</p>
              {"delta" in k && <Delta value={k.delta as number | null} unit={k.unit ?? "%"} />}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Channel comparison</CardTitle>
          <CardDescription className="text-sm">
            Contribution is revenue less Raja&apos;s-funded discount, food cost and platform
            commission. Commission comes from the editable Store × Channel settings — the
            column that shows which channels actually leave the most money.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-sm">Channel</TableHead>
                  <TableHead className="text-sm text-right">Revenue</TableHead>
                  <TableHead className="text-sm text-right">Orders</TableHead>
                  <TableHead className="text-sm text-right">AOV</TableHead>
                  <TableHead className="text-sm text-right">Mix</TableHead>
                  <TableHead className="text-sm text-right">Change</TableHead>
                  <TableHead className="text-sm text-right">Commission</TableHead>
                  <TableHead className="text-sm text-right">Contribution</TableHead>
                  <TableHead className="text-sm text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="text-sm font-medium">
                      {c.label}
                      <Badge variant="outline" className="ml-1.5 text-xs px-1 py-0">
                        {c.isDirect ? "direct" : "3rd party"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right">{money(c.revenue)}</TableCell>
                    <TableCell className="text-sm text-right">{c.orders.toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-right">{money(c.aov)}</TableCell>
                    <TableCell className="text-sm text-right">{c.mixPct.toFixed(1)}%</TableCell>
                    <TableCell className="text-sm text-right"><Delta value={c.changePct} /></TableCell>
                    <TableCell className="text-sm text-right">
                      {c.commissionPct > 0 ? (
                        <>
                          {money(c.commission)}
                          <span className="text-xs text-muted-foreground ml-1">
                            ({(c.commissionPct * 100).toFixed(0)}%)
                          </span>
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-right font-medium">{money(c.channelContribution)}</TableCell>
                    <TableCell className="text-sm text-right">{c.contributionMarginPct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* §9: "Detailed offer analysis — do not duplicate; link to Offers & Promotions" */}
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Discount and offer detail is not duplicated here.</span>
            <Link href="/dashboard/offers" className="inline-flex items-center gap-1 text-primary hover:underline">
              Offers &amp; Promotions <ArrowRight className="size-3" />
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Items 12-15: signals derived from contribution, margin, volume and trend —
          never from AOV or revenue share alone. */}
      {data.signals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Key Changes</CardTitle>
            <CardDescription className="text-sm">
              Based on contribution, margin, order volume and trend together.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border/50">
            {data.signals.map((sig) => {
              const tone =
                sig.tone === "good" ? "text-success"
                : sig.tone === "bad" ? "text-destructive"
                : sig.tone === "warning" ? "text-warning"
                : "text-muted-foreground"
              return (
                <div key={sig.headline} className="py-2 first:pt-0 last:pb-0">
                  <p className={`text-sm font-medium ${tone}`}>{sig.headline}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{sig.evidence}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {data.caveats.length > 0 && (
        <Card className="border-warning/40">
          <CardContent className="p-4 flex gap-2">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Contribution is incomplete</p>
              {data.caveats.map((c) => (
                <p key={c} className="text-sm text-muted-foreground">{c}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
