"use client"

import { useState, useEffect } from "react"
import { getItemProfitability, getCategoryPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, Cell } from "recharts"
import { format, subDays } from "date-fns"
import { Search, TrendingUp, TrendingDown } from "lucide-react"

type ItemRow = {
  itemName: string
  categoryName: string
  itemType: string
  totalQty: number
  totalRevenue: number
  avgUnitPrice: number
  costPrice: number
  totalCost: number
  grossProfit: number
  marginPercent: number
  totalDiscount: number
}

const chartConfig = {
  grossProfit: { label: "Gross Profit", color: "var(--color-chart-1)" },
  marginPercent: { label: "Margin %", color: "var(--color-chart-3)" },
}

export default function CostingPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
  })
  const [items, setItems] = useState<ItemRow[]>([])
  const [categories, setCategories] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [i, c] = await Promise.all([
        getItemProfitability(f.startDate, f.endDate, f.location, f.channel),
        getCategoryPerformance(f.startDate, f.endDate, f.location, f.channel),
      ])
      setItems(i as ItemRow[])
      setCategories(c)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const handleFilterChange = (f: typeof filters) => {
    setFilters(f)
    fetchData(f)
  }

  // The action groups by (itemName, categoryName, itemType), so one real item shows
  // up as several rows when the POS labels it under different category spellings
  // ("BURGERS" vs "CLASSIC BURGERS", "PERI PERI" vs "PIRI PIRI") or with stray
  // leading/trailing spaces (" Meal " vs "Meal "). Collapse to one row per trimmed
  // item name so each item appears once with its true totals.
  const aggItems: (ItemRow & { categories: string[] })[] = (() => {
    const m = new Map<string, ItemRow & { categories: string[] }>()
    for (const r of items) {
      const key = (r.itemName ?? "").trim()
      const ex = m.get(key)
      const cat = r.categoryName?.trim()
      if (!ex) {
        m.set(key, { ...r, itemName: key, categories: cat ? [cat] : [] })
      } else {
        ex.totalQty = Number(ex.totalQty) + Number(r.totalQty)
        ex.totalRevenue = Number(ex.totalRevenue) + Number(r.totalRevenue)
        ex.totalCost = Number(ex.totalCost) + Number(r.totalCost)
        ex.grossProfit = Number(ex.grossProfit) + Number(r.grossProfit)
        ex.totalDiscount = Number(ex.totalDiscount) + Number(r.totalDiscount)
        if (cat && !ex.categories.includes(cat)) ex.categories.push(cat)
      }
    }
    const out = [...m.values()]
    for (const a of out) {
      const qty = Number(a.totalQty), rev = Number(a.totalRevenue), cost = Number(a.totalCost)
      a.costPrice = qty > 0 ? cost / qty : 0          // effective blended unit cost
      a.avgUnitPrice = qty > 0 ? rev / qty : 0        // revenue-weighted avg price
      a.marginPercent = rev > 0 ? (a.grossProfit / rev) * 100 : 0
      a.categoryName = a.categories[0] ?? ""
    }
    return out.sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue))
  })()

  const filtered = aggItems.filter((i) =>
    i.itemName.toLowerCase().includes(search.toLowerCase()) ||
    i.categories.some((c) => c.toLowerCase().includes(search.toLowerCase()))
  )

  const totalRevenue = aggItems.reduce((s, i) => s + Number(i.totalRevenue), 0)
  const totalProfit = aggItems.reduce((s, i) => s + Number(i.grossProfit), 0)
  const totalCost = aggItems.reduce((s, i) => s + Number(i.totalCost), 0)
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  const marginColor = (m: number) =>
    m >= 60 ? "text-[oklch(0.7_0.15_150)]" : m >= 40 ? "text-[oklch(0.75_0.18_75)]" : "text-destructive"

  const top10ByProfit = [...aggItems].sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit)).slice(0, 10)
  const top10ByMargin = [...aggItems].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent)).slice(0, 10)
  const bottom10 = [...aggItems].filter(i => Number(i.totalQty) > 5).sort((a, b) => Number(a.marginPercent) - Number(b.marginPercent)).slice(0, 10)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Item Profitability</h1>
        <p className="text-sm text-muted-foreground">Cost vs revenue analysis — powered by live Google Sheets pricing</p>
      </div>

      <DateLocationFilter onFilterChange={handleFilterChange} />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: `£${Number(totalRevenue).toFixed(2)}` },
          { label: "Total Cost", value: `£${Number(totalCost).toFixed(2)}` },
          { label: "Gross Profit", value: `£${Number(totalProfit).toFixed(2)}` },
          { label: "Avg Margin", value: `${avgMargin.toFixed(1)}%` },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Item Level</TabsTrigger>
          <TabsTrigger value="category">By Category</TabsTrigger>
          <TabsTrigger value="top">Top Performers</TabsTrigger>
          <TabsTrigger value="risk">At Risk</TabsTrigger>
        </TabsList>

        {/* Item Level Tab */}
        <TabsContent value="items" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-semibold">All Items — Cost vs Revenue</CardTitle>
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search item or category..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground text-sm">
                  No profitability data yet. Sync your Google Sheet and Presto data first.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs">Category</TableHead>
                      <TableHead className="text-xs text-right">Qty Sold</TableHead>
                      <TableHead className="text-xs text-right">Cost Price</TableHead>
                      <TableHead className="text-xs text-right">Avg Sale Price</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                      <TableHead className="text-xs text-right">Total Cost</TableHead>
                      <TableHead className="text-xs text-right">Gross Profit</TableHead>
                      <TableHead className="text-xs text-right">Margin %</TableHead>
                      <TableHead className="text-xs text-right">Discounts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{item.itemName}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="outline" className="text-[10px]">{item.categoryName || "—"}</Badge>
                          {item.categories.length > 1 && (
                            <span className="ml-1 text-[10px] text-muted-foreground" title={item.categories.join(", ")}>
                              +{item.categories.length - 1}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right">{Number(item.totalQty).toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right">
                          {item.costPrice ? `£${Number(item.costPrice).toFixed(2)}` : <span className="text-muted-foreground">No cost</span>}
                        </TableCell>
                        <TableCell className="text-xs text-right">£{Number(item.avgUnitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right font-medium">£{Number(item.totalRevenue).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">£{Number(item.totalCost).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          <span className={Number(item.grossProfit) >= 0 ? "text-[oklch(0.7_0.15_150)]" : "text-destructive"}>
                            £{Number(item.grossProfit).toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={marginColor(Number(item.marginPercent))}>
                            {Number(item.marginPercent).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">
                          £{Number(item.totalDiscount).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Category Tab */}
        <TabsContent value="category" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-sm font-semibold">Profit by Category</CardTitle>
                <CardDescription className="text-xs">Top 10 categories by gross profit</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-64 w-full" /> : (
                  <ChartContainer config={chartConfig} className="h-64 w-full">
                    <BarChart
                      data={[...(categories as Record<string, unknown>[])].sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit)).slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 8, right: 8 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={110} tickFormatter={(v) => v?.length > 16 ? v.slice(0, 16) + "…" : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="grossProfit" fill="var(--color-chart-3)" radius={4} name="Gross Profit" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-sm font-semibold">Margin % by Category</CardTitle>
                <CardDescription className="text-xs">Top 10 categories by margin</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-64 w-full" /> : (
                  <ChartContainer config={chartConfig} className="h-64 w-full">
                    <BarChart
                      data={[...(categories as Record<string, unknown>[])].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent)).slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 8, right: 8 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={110} tickFormatter={(v) => v?.length > 16 ? v.slice(0, 16) + "…" : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="marginPercent" radius={4} name="Margin %">
                        {[...(categories as Record<string, unknown>[])].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent)).slice(0, 10).map((c, i) => (
                          <Cell key={i} fill={Number(c.marginPercent) >= 60 ? "var(--color-chart-3)" : Number(c.marginPercent) >= 40 ? "var(--color-chart-5)" : "var(--color-destructive)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Top Performers */}
        <TabsContent value="top" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="size-4 text-[oklch(0.7_0.15_150)]" />
                  Top 10 by Gross Profit
                </CardTitle>
                <CardDescription className="text-xs">Highest absolute profit contributors</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-48 w-full" /> : top10ByProfit.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No data yet</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {top10ByProfit.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-5 text-right">{i + 1}</span>
                        <span className="flex-1 truncate font-medium">{item.itemName}</span>
                        <span className="text-[oklch(0.7_0.15_150)] font-semibold">£{Number(item.grossProfit).toFixed(2)}</span>
                        <span className="text-muted-foreground w-12 text-right">{Number(item.marginPercent).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  Top 10 by Margin %
                </CardTitle>
                <CardDescription className="text-xs">Highest margin items (min 5 sold)</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-48 w-full" /> : top10ByMargin.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No data yet</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {top10ByMargin.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-5 text-right">{i + 1}</span>
                        <span className="flex-1 truncate font-medium">{item.itemName}</span>
                        <span className="text-primary font-semibold">{Number(item.marginPercent).toFixed(1)}%</span>
                        <span className="text-muted-foreground w-16 text-right">{Number(item.totalQty).toFixed(0)} sold</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* At Risk */}
        <TabsContent value="risk" className="mt-4">
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="size-4 text-destructive" />
                At Risk Items — Low Margin (&lt;40%) with Sales Volume
              </CardTitle>
              <CardDescription className="text-xs">Items selling well but dragging down profitability</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-48 w-full" /> : bottom10.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground text-sm">No at-risk items found</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs">Category</TableHead>
                      <TableHead className="text-xs text-right">Qty Sold</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                      <TableHead className="text-xs text-right">Margin %</TableHead>
                      <TableHead className="text-xs">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bottom10.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{item.itemName}</TableCell>
                        <TableCell className="text-xs">{item.categoryName || "—"}</TableCell>
                        <TableCell className="text-xs text-right">{Number(item.totalQty).toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right">£{Number(item.totalRevenue).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <span className="text-destructive font-semibold">{Number(item.marginPercent).toFixed(1)}%</span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="destructive" className="text-[10px]">Review pricing</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
