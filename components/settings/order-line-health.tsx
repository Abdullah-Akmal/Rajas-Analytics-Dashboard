"use client"

import { useEffect, useState } from "react"
import { getOrderLineValidation } from "@/app/actions/dashboard"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { format, subDays } from "date-fns"
import { ShieldCheck, ShieldAlert } from "lucide-react"

type Validation = Awaited<ReturnType<typeof getOrderLineValidation>>

/**
 * Order Line Structure Validation — moved here from the Basket page (Operations
 * corrections item 29). It is a data-health check on the POS lines, not a business
 * metric, so it belongs next to the syncs that produce those lines.
 */
export function OrderLineHealth() {
  const [start, setStart] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"))
  const [end, setEnd] = useState(format(new Date(), "yyyy-MM-dd"))
  const [data, setData] = useState<Validation | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try { setData(await getOrderLineValidation(start, end)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cells = data ? [
    { label: "Total lines", value: data.totalLines, bad: false, hint: `${data.distinctOrderIds.toLocaleString()} orders` },
    { label: "Orphan lines", value: data.orphanLines, bad: data.orphanLines > 0, hint: "No parent order" },
    { label: "Orders without lines", value: data.ordersNoLines, bad: data.ordersNoLines > 0, hint: "Empty baskets" },
    { label: "Zero / negative qty", value: data.zeroQtyLines, bad: data.zeroQtyLines > 0, hint: "qty ≤ 0" },
    { label: "Negative amount", value: data.negativeAmountLines, bad: data.negativeAmountLines > 0, hint: "amount < 0" },
    { label: "Blank names", value: data.blankNameLines, bad: data.blankNameLines > 0, hint: "Missing item name" },
    { label: "Uncategorised", value: data.uncategorisedLines, bad: data.uncategorisedLines > 0, hint: "No POS category" },
  ] : []

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {data && data.healthScore >= 98 ? <ShieldCheck className="size-4 text-success" /> : <ShieldAlert className="size-4 text-warning" />}
            <div>
              <CardTitle className="text-base">Order Line Health</CardTitle>
              <CardDescription className="text-sm">Structural checks on the Presto order lines feeding every report</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-36 text-sm" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-36 text-sm" />
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>Check</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading || !data ? <Skeleton className="h-20 w-full" /> : (
          <>
            <p className={`text-sm font-semibold mb-3 ${data.healthScore >= 98 ? "text-success" : data.healthScore >= 90 ? "text-warning" : "text-destructive"}`}>
              Health score {data.healthScore}%
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {cells.map((c) => (
                <div key={c.label} className="rounded-md border border-border p-3">
                  <p className="text-sm text-muted-foreground">{c.label}</p>
                  <p className={`text-xl font-bold ${c.bad ? "text-warning" : "text-foreground"}`}>{c.value.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{c.hint}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
