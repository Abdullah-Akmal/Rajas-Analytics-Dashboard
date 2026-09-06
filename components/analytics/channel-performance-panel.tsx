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
    return <span className="text-[10px] text-muted-foreground">no baseline</span>
  }
  const up = value >= 0
  return (
    <span className={`text-[10px] ${up ? "text-[oklch(0.7_0.15_150)]" : "text-destructive"}`}>
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
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>
              {"delta" in k && <Delta value={k.delta as number | null} unit={k.unit ?? "%"} />}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Channel comparison</CardTitle>
          <CardDescription className="text-xs">
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
                  <TableHead className="text-xs">Channel</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">Orders</TableHead>
                  <TableHead className="text-xs text-right">AOV</TableHead>
                  <TableHead className="text-xs text-right">Mix</TableHead>
                  <TableHead className="text-xs text-right">Change</TableHead>
                  <TableHead className="text-xs text-right">Commission</TableHead>
                  <TableHead className="text-xs text-right">Contribution</TableHead>
                  <TableHead className="text-xs text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((c) => (
                  <TableRow key={c.channel}>
                    <TableCell className="text-xs font-medium">
                      {c.label}
                      <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0">
                        {c.isDirect ? "direct" : "3rd party"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right">{money(c.revenue)}</TableCell>
                    <TableCell className="text-xs text-right">{c.orders.toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-right">{money(c.aov)}</TableCell>
                    <TableCell className="text-xs text-right">{c.mixPct.toFixed(1)}%</TableCell>
                    <TableCell className="text-xs text-right"><Delta value={c.changePct} /></TableCell>
                    <TableCell className="text-xs text-right">
                      {c.commissionPct > 0 ? (
                        <>
                          {money(c.commission)}
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({(c.commissionPct * 100).toFixed(0)}%)
                          </span>
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-right font-medium">{money(c.channelContribution)}</TableCell>
                    <TableCell className="text-xs text-right">{c.contributionMarginPct.toFixed(1)}%</TableCell>
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

      {data.caveats.length > 0 && (
        <Card className="border-[oklch(0.75_0.18_75)]/40">
          <CardContent className="p-4 flex gap-2">
            <AlertTriangle className="size-4 text-[oklch(0.75_0.18_75)] shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-foreground">Contribution is incomplete</p>
              {data.caveats.map((c) => (
                <p key={c} className="text-[11px] text-muted-foreground">{c}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
