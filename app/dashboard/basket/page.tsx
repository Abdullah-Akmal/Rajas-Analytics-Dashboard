"use client"

import { useState, useEffect } from "react"
import { getBasketAnalysis, getOrderLineValidation, getBasketInsights } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts"
import { format, subDays } from "date-fns"
import { ShoppingCart, PoundSterling, Hash, TrendingUp, ShieldCheck, ShieldAlert, Link2, ArrowUpRight, Lightbulb } from "lucide-react"

type BasketData = Awaited<ReturnType<typeof getBasketAnalysis>>
type Validation = Awaited<ReturnType<typeof getOrderLineValidation>>
type Insights = Awaited<ReturnType<typeof getBasketInsights>>

const COLORS = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)",
]

const chartCfg = {
  orderCount: { label: "Orders", color: "var(--color-chart-1)" },
  orderFrequency: { label: "Order Frequency", color: "var(--color-chart-2)" },
  totalQty: { label: "Units Sold", color: "var(--color-chart-3)" },
}

function num(v: unknown) { return Number(v ?? 0) }

export default function BasketPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
  })
  const [data, setData] = useState<BasketData | null>(null)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [b, v, ins] = await Promise.all([
        getBasketAnalysis(f.startDate, f.endDate, f.location, f.channel),
        getOrderLineValidation(f.startDate, f.endDate, f.location, f.channel),
        getBasketInsights(f.startDate, f.endDate, f.location, f.channel),
      ])
      setData(b)
      setValidation(v)
      setInsights(ins)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const summary = data?.summary
  const distribution = data?.distribution ?? []
  const topItems = data?.topItems ?? []

  // ── Market-basket insights ──
  const affinity = insights?.affinity ?? []
  const attach = insights?.attach ?? null
  const groups = insights?.groups ?? []
  // Rank add-on groups by upside left on the table: £ lift × orders that didn't attach it
  const opportunities = attach
    ? ([
        { name: "Dessert", ...attach.dessert },
        { name: "Side", ...attach.side },
        { name: "Drink", ...attach.drink },
      ]).map((g) => ({
        ...g,
        uplift: g.aovWith - g.aovWithout,
        missedOrders: Math.round(attach.mainOrders * (1 - g.attachRate / 100)),
      })).sort((a, b) => b.uplift * b.missedOrders - a.uplift * a.missedOrders)
    : []
  const topOpp = opportunities[0]
  const topPair = affinity[0]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Basket & Upsell</h1>
        <p className="text-sm text-muted-foreground">What customers buy, how much they spend per order, and upsell opportunities</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Avg Items / Order", value: summary ? num(summary.avgItemsPerOrder).toFixed(1) : "—", icon: <ShoppingCart className="size-4" /> },
          { label: "Avg Basket Value", value: summary ? `£${num(summary.avgBasketValue).toFixed(2)}` : "—", icon: <PoundSterling className="size-4" /> },
          { label: "Total Orders Analysed", value: summary ? num(summary.totalOrders).toLocaleString() : "—", icon: <Hash className="size-4" /> },
          { label: "Unique Items Ordered", value: topItems.length.toLocaleString(), icon: <TrendingUp className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-20 mt-1" /> : <p className="text-lg font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Upsell opportunity — add-on attach rate + basket-value lift */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Upsell Opportunity — Add-on Attach Rate</CardTitle>
          <CardDescription className="text-xs">
            {attach ? `Of ${num(attach.mainOrders).toLocaleString()} orders containing a main, how many attach each add-on — and the basket-value lift when they do. Low attach + high lift = your biggest upsell target.` : "How often mains are paired with add-ons"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !attach ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[{ n: "Drink", g: attach.drink }, { n: "Side", g: attach.side }, { n: "Dessert", g: attach.dessert }].map(({ n, g }) => {
                const uplift = g.aovWith - g.aovWithout
                return (
                  <div key={n} className="p-3 rounded-lg bg-secondary flex flex-col gap-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium text-foreground">{n}</span>
                      <span className="text-lg font-bold text-foreground">{g.attachRate.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-background overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(g.attachRate, 100)}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Basket <span className="text-foreground font-medium">£{g.aovWith.toFixed(2)}</span> with vs <span className="text-foreground font-medium">£{g.aovWithout.toFixed(2)}</span> without
                      {uplift > 0 && <span className="text-[oklch(0.7_0.15_150)] font-medium"> · +£{uplift.toFixed(2)}</span>}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order line structure validation */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {validation && validation.healthScore >= 98
                ? <ShieldCheck className="size-4 text-[oklch(0.7_0.15_150)]" />
                : <ShieldAlert className="size-4 text-[oklch(0.75_0.18_75)]" />}
              <div>
                <CardTitle className="text-sm font-semibold">Order Line Structure Validation</CardTitle>
                <CardDescription className="text-xs">Data-quality checks on the basket lines feeding this report</CardDescription>
              </div>
            </div>
            {validation && !loading && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Health</span>
                <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${
                  validation.healthScore >= 98 ? "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]"
                  : validation.healthScore >= 90 ? "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)] border-[oklch(0.38_0.1_75)]"
                  : "bg-destructive/15 text-destructive border-destructive/30"
                }`}>{validation.healthScore}%</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading || !validation ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Total Lines", value: validation.totalLines, tone: "neutral" as const, hint: `${validation.distinctOrderIds} orders` },
                { label: "Orphan Lines", value: validation.orphanLines, tone: validation.orphanLines > 0 ? "error" : "ok" as const, hint: "no parent order" },
                { label: "Orders w/o Lines", value: validation.ordersNoLines, tone: validation.ordersNoLines > 0 ? "warn" : "ok" as const, hint: "empty baskets" },
                { label: "Zero/Neg Qty", value: validation.zeroQtyLines, tone: validation.zeroQtyLines > 0 ? "warn" : "ok" as const, hint: "qty ≤ 0" },
                { label: "Negative Amount", value: validation.negativeAmountLines, tone: validation.negativeAmountLines > 0 ? "warn" : "ok" as const, hint: "amount < 0" },
                { label: "Blank Names", value: validation.blankNameLines, tone: validation.blankNameLines > 0 ? "error" : "ok" as const, hint: "missing itemName" },
                { label: "Uncategorised", value: validation.uncategorisedLines, tone: validation.uncategorisedLines > 0 ? "warn" : "ok" as const, hint: "no category" },
              ].map((c) => (
                <div key={c.label} className="p-3 rounded-lg bg-secondary">
                  <p className="text-[10px] text-muted-foreground">{c.label}</p>
                  <p className={`text-lg font-bold ${
                    c.tone === "error" && c.value > 0 ? "text-destructive"
                    : c.tone === "warn" && c.value > 0 ? "text-[oklch(0.75_0.18_75)]"
                    : c.tone === "ok" || c.value === 0 ? "text-[oklch(0.7_0.15_150)]"
                    : "text-foreground"
                  }`}>{Number(c.value).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">{c.hint}</p>
                </div>
              ))}
            </div>
          )}
          {validation && !loading && validation.orphanLines === 0 && validation.blankNameLines === 0 && validation.zeroQtyLines === 0 && (
            <p className="text-xs text-muted-foreground mt-3">All basket lines are structurally valid — every line maps to a real order with a name and positive quantity.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Items per order distribution */}
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Items per Order Distribution</CardTitle>
            <CardDescription className="text-xs">Distinct products per order (excludes modifiers &amp; meal upgrades)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : distribution.length === 0 ? (
              <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ChartContainer config={chartCfg} className="h-44 w-full">
                <BarChart data={distribution} margin={{ left: 0 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={({ payload }) => payload?.[0] ? (
                    <div className="bg-popover border rounded p-2 text-xs">
                      <p>{payload[0].payload.bucket}: {payload[0].value} orders</p>
                    </div>
                  ) : null} />
                  <Bar dataKey="orderCount" radius={4} name="Orders">
                    {distribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
            {!loading && num(summary?.avgItemsPerOrder) > 0 && num(summary?.avgItemsPerOrder) < 2 && (
              <p className="text-xs text-muted-foreground mt-2">
                Average of {num(summary?.avgItemsPerOrder).toFixed(1)} items/order is low — upsell potential is high.
                Consider bundling sides, drinks, or desserts at checkout.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Orders by menu group */}
        <Card>
          <CardHeader className="pb-2 text-center">
            <CardTitle className="text-sm font-semibold">Orders by Menu Group</CardTitle>
            <CardDescription className="text-xs">How many orders include each group (meal upgrades counted as side + drink)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-44 w-full" /> : groups.length === 0 ? (
              <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
            ) : (
              <ChartContainer config={chartCfg} className="h-44 w-full">
                <BarChart data={groups} layout="vertical" margin={{ left: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} />
                  <ChartTooltip content={({ payload }) => payload?.[0] ? (
                    <div className="bg-popover border rounded p-2 text-xs">
                      <p>{payload[0].payload.name}: {payload[0].value} orders</p>
                    </div>
                  ) : null} />
                  <Bar dataKey="orders" radius={3} name="Orders">
                    {groups.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Frequently bought together — item affinity */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" />
            <div>
              <CardTitle className="text-sm font-semibold">Frequently Bought Together</CardTitle>
              <CardDescription className="text-xs">Item pairs in the same order — your bundle candidates. Lift &gt; 1 means bought together more often than chance; confidence = how often the second item joins the first.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : affinity.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">Not enough co-occurring items in this period to detect pairs.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Item pair</TableHead>
                  <TableHead className="text-xs text-right">In Orders</TableHead>
                  <TableHead className="text-xs text-right">Confidence</TableHead>
                  <TableHead className="text-xs text-right">Lift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affinity.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">
                      {p.itemA} <span className="text-muted-foreground">+</span> {p.itemB}
                    </TableCell>
                    <TableCell className="text-xs text-right">{p.pairOrders} <span className="text-muted-foreground">({p.supportPct}%)</span></TableCell>
                    <TableCell className="text-xs text-right">{p.confidence.toFixed(0)}%</TableCell>
                    <TableCell className="text-xs text-right">
                      <Badge variant="outline" className={`text-[10px] ${p.lift >= 3 ? "text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]" : ""}`}>{p.lift.toFixed(1)}×</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top items by order frequency */}
      <Card>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-sm font-semibold">Top Items by Order Frequency</CardTitle>
          <CardDescription className="text-xs">How often does each item appear in an order? These are your anchor items.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-52 w-full" /> : topItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No basket data yet — sync Presto data first</div>
          ) : (
            <ChartContainer config={chartCfg} className="h-52 w-full">
              <BarChart data={topItems.slice(0, 15)} layout="vertical" margin={{ left: 4 }}>
                <XAxis type="number" tick={{ fontSize: 9 }} />
                <YAxis type="category" dataKey="itemName" tick={{ fontSize: 9 }} width={130} tickFormatter={(v) => v.length > 18 ? v.substring(0, 18) + "…" : v} />
                <ChartTooltip content={({ payload }) => payload?.[0] ? (
                  <div className="bg-popover border rounded p-2 text-xs">
                    <p className="font-medium">{payload[0].payload.itemName}</p>
                    <p>In {payload[0].value} orders · {num(payload[0].payload.totalQty).toFixed(0)} units</p>
                    <p>Revenue: £{num(payload[0].payload.totalRevenue).toFixed(2)}</p>
                  </div>
                ) : null} />
                <Bar dataKey="orderFrequency" fill="var(--color-chart-2)" radius={3} name="Order Frequency" />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Detailed table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Item Frequency Table</CardTitle>
          <CardDescription className="text-xs">All items ordered in the period, by frequency</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs text-right">In Orders</TableHead>
                  <TableHead className="text-xs text-right">Units Sold</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">Order Penetration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topItems.map((item, i) => {
                  const totalOrd = num(summary?.totalOrders)
                  const penetration = totalOrd > 0 ? (num(item.orderFrequency) / totalOrd) * 100 : 0
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs font-medium">{item.itemName}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-[10px]">{item.categoryName}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right">{num(item.orderFrequency)}</TableCell>
                      <TableCell className="text-xs text-right">{num(item.totalQty).toFixed(0)}</TableCell>
                      <TableCell className="text-xs text-right">£{num(item.totalRevenue).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <span className="tabular-nums">{penetration.toFixed(1)}%</span>
                        {penetration > 15 && <Badge className="ml-2 text-[10px] bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)]">Anchor</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Data-driven upsell recommendations */}
      {!loading && (topPair || topOpp) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="size-4 text-[oklch(0.75_0.18_75)]" />
              <CardTitle className="text-sm font-semibold">What to do about it</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-xs">
              {topOpp && topOpp.uplift > 0 && (
                <div className="flex gap-2">
                  <Badge variant="destructive" className="text-[10px] shrink-0">Biggest gap</Badge>
                  <span>
                    Only <strong>{topOpp.attachRate.toFixed(1)}%</strong> of main orders include a <strong>{topOpp.name.toLowerCase()}</strong>, yet baskets that do are worth
                    <strong> £{topOpp.aovWith.toFixed(2)}</strong> vs £{topOpp.aovWithout.toFixed(2)} (+£{topOpp.uplift.toFixed(2)}). Prompt a {topOpp.name.toLowerCase()} at checkout — ~{topOpp.missedOrders.toLocaleString()} orders didn't attach one.
                  </span>
                </div>
              )}
              {topPair && (
                <div className="flex gap-2">
                  <Badge className="text-[10px] shrink-0 bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)]">Bundle</Badge>
                  <span>
                    <strong>{topPair.itemA}</strong> + <strong>{topPair.itemB}</strong> already sell together in {topPair.pairOrders} orders (lift {topPair.lift.toFixed(1)}×). Make it a named combo to lock in the pairing and lift margin.
                  </span>
                </div>
              )}
              {opportunities[1] && opportunities[1].uplift > 0 && (
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-[10px] shrink-0">Next</Badge>
                  <span>
                    {opportunities[1].name} attach is {opportunities[1].attachRate.toFixed(1)}% (+£{opportunities[1].uplift.toFixed(2)} per basket) — the second-largest upside after {topOpp?.name.toLowerCase()}.
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
