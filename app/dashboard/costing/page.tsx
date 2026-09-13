"use client"

import { useState, useEffect } from "react"
import { getItemProfitability, getCategoryPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { ProductsRequiringAttention } from "@/components/analytics/products-requiring-attention"
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
  costStatus?: string
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
  grossProfit: { label: "Gross Profit", color: "var(--success)" },
  marginPercent: { label: "Margin %", color: "var(--series-1)" },
}

export default function CostingPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 7), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
    mode: "all",
    platform: "all",
    brand: "all",
    productType: "all",
    category: "all",
  })
  const [items, setItems] = useState<ItemRow[]>([])
  const [categories, setCategories] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [i, c] = await Promise.all([
        getItemProfitability(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform, { brand: f.brand, productType: f.productType, category: f.category }),
        getCategoryPerformance(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform, { brand: f.brand, productType: f.productType, category: f.category }),
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
        // Stays a modifier only while every contributing row is uncosted.
        if (r.costStatus === "costed") ex.costStatus = "costed"
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

  // Modifiers (lines with no resolvable cost) stay visible in the table below, but
  // are kept out of the margin maths — counting them at zero cost would report them
  // as 100% gross profit and inflate the headline margin.
  const costedItems = aggItems.filter((i) => i.costStatus !== "modifier")
  const modifierItems = aggItems.filter((i) => i.costStatus === "modifier")
  const modifierRevenue = modifierItems.reduce((s, i) => s + Number(i.totalRevenue), 0)

  const totalRevenue = costedItems.reduce((s, i) => s + Number(i.totalRevenue), 0)
  const totalProfit = costedItems.reduce((s, i) => s + Number(i.grossProfit), 0)
  const totalCost = costedItems.reduce((s, i) => s + Number(i.totalCost), 0)
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  const marginColor = (m: number) =>
    m >= 60 ? "text-success" : m >= 40 ? "text-warning" : "text-destructive"

  const top10ByProfit = [...costedItems].sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit)).slice(0, 10)
  const top10ByMargin = [...costedItems].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent)).slice(0, 10)
  const bottom10 = [...costedItems].filter(i => Number(i.totalQty) > 5).sort((a, b) => Number(a.marginPercent) - Number(b.marginPercent)).slice(0, 10)

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
          {
            label: "Avg Margin",
            value: `${avgMargin.toFixed(1)}%`,
            note: modifierItems.length
              ? `excludes ${modifierItems.length} uncosted (£${modifierRevenue.toFixed(0)})`
              : undefined,
          },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className="text-3xl font-bold text-foreground mt-1">{k.value}</p>
              {"note" in k && k.note && (
                <p className="text-xs text-muted-foreground mt-0.5">{k.note}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="attention">
        <TabsList>
          <TabsTrigger value="attention">Requiring Attention</TabsTrigger>
          <TabsTrigger value="items">View All Products</TabsTrigger>
          <TabsTrigger value="category">By Category</TabsTrigger>
          <TabsTrigger value="top">Top Performers</TabsTrigger>
          <TabsTrigger value="risk">At Risk</TabsTrigger>
        </TabsList>

        {/* Item Level Tab */}
        {/* §7: "Huge default item list — REMOVE. Products Requiring Attention — ADD.
            View All Products — ADD as drill-down." */}
        <TabsContent value="attention" className="mt-4">
          <ProductsRequiringAttention
            startDate={filters.startDate}
            endDate={filters.endDate}
            location={filters.location}
            brand={filters.brand}
            productType={filters.productType}
            category={filters.category}
          />
        </TabsContent>

        <TabsContent value="items" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-base font-semibold">All Items — Cost vs Revenue</CardTitle>
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
                      <TableHead className="text-sm">Item</TableHead>
                      <TableHead className="text-sm">Category</TableHead>
                      <TableHead className="text-sm text-right">Qty Sold</TableHead>
                      <TableHead className="text-sm text-right">Cost Price</TableHead>
                      <TableHead className="text-sm text-right">Avg Sale Price</TableHead>
                      <TableHead className="text-sm text-right">Revenue</TableHead>
                      <TableHead className="text-sm text-right">Total Cost</TableHead>
                      <TableHead className="text-sm text-right">Gross Profit</TableHead>
                      <TableHead className="text-sm text-right">Margin %</TableHead>
                      <TableHead className="text-sm text-right">Discounts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {item.itemName}
                            {item.costStatus === "modifier" && (
                              <Badge variant="secondary" className="text-xs px-1 py-0 font-normal">
                                modifier
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="outline" className="text-xs">{item.categoryName || "—"}</Badge>
                          {item.categories.length > 1 && (
                            <span className="ml-1 text-xs text-muted-foreground" title={item.categories.join(", ")}>
                              +{item.categories.length - 1}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-right">{Number(item.totalQty).toFixed(0)}</TableCell>
                        <TableCell className="text-sm text-right">
                          {item.costPrice ? `£${Number(item.costPrice).toFixed(2)}` : <span className="text-muted-foreground">No cost</span>}
                        </TableCell>
                        <TableCell className="text-sm text-right">£{Number(item.avgUnitPrice).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right font-medium">£{Number(item.totalRevenue).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right">£{Number(item.totalCost).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right font-medium">
                          <span className={Number(item.grossProfit) >= 0 ? "text-success" : "text-destructive"}>
                            £{Number(item.grossProfit).toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-right">
                          <span className={marginColor(Number(item.marginPercent))}>
                            {Number(item.marginPercent).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-right text-muted-foreground">
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
                <CardTitle className="text-base font-semibold">Profit by Category</CardTitle>
                <CardDescription className="text-sm">Top 10 categories by gross profit</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-64 w-full" /> : (
                  <ChartContainer config={chartConfig} className="h-64 w-full">
                    <BarChart
                      data={[...(categories as Record<string, unknown>[])].sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit)).slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 8, right: 8 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `£${v}`} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={110} tickFormatter={(v) => v?.length > 16 ? v.slice(0, 16) + "…" : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="grossProfit" fill="var(--success)" radius={4} name="Gross Profit" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-base font-semibold">Margin % by Category</CardTitle>
                <CardDescription className="text-sm">Top 10 categories by margin</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-64 w-full" /> : (
                  <ChartContainer config={chartConfig} className="h-64 w-full">
                    <BarChart
                      data={[...(categories as Record<string, unknown>[])].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent)).slice(0, 10)}
                      layout="vertical"
                      margin={{ left: 8, right: 8 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={110} tickFormatter={(v) => v?.length > 16 ? v.slice(0, 16) + "…" : v} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="marginPercent" radius={4} name="Margin %">
                        {[...(categories as Record<string, unknown>[])].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent)).slice(0, 10).map((c, i) => (
                          <Cell key={i} fill={Number(c.marginPercent) >= 60 ? "var(--success)" : Number(c.marginPercent) >= 40 ? "var(--warning)" : "var(--danger)"} />
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
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <TrendingUp className="size-4 text-success" />
                  Top 10 by Gross Profit
                </CardTitle>
                <CardDescription className="text-sm">Highest absolute profit contributors</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-48 w-full" /> : top10ByProfit.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {top10ByProfit.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-5 text-right">{i + 1}</span>
                        <span className="flex-1 truncate font-medium">{item.itemName}</span>
                        <span className="text-success font-semibold">£{Number(item.grossProfit).toFixed(2)}</span>
                        <span className="text-muted-foreground w-12 text-right">{Number(item.marginPercent).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  Top 10 by Margin %
                </CardTitle>
                <CardDescription className="text-sm">Highest margin items (min 5 sold)</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-48 w-full" /> : top10ByMargin.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No data yet</p>
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
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingDown className="size-4 text-destructive" />
                At Risk Items — Low Margin (&lt;40%) with Sales Volume
              </CardTitle>
              <CardDescription className="text-sm">Items selling well but dragging down profitability</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-48 w-full" /> : bottom10.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground text-sm">No at-risk items found</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-sm">Item</TableHead>
                      <TableHead className="text-sm">Category</TableHead>
                      <TableHead className="text-sm text-right">Qty Sold</TableHead>
                      <TableHead className="text-sm text-right">Revenue</TableHead>
                      <TableHead className="text-sm text-right">Margin %</TableHead>
                      <TableHead className="text-sm">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bottom10.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-medium">{item.itemName}</TableCell>
                        <TableCell className="text-sm">{item.categoryName || "—"}</TableCell>
                        <TableCell className="text-sm text-right">{Number(item.totalQty).toFixed(0)}</TableCell>
                        <TableCell className="text-sm text-right">£{Number(item.totalRevenue).toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-right">
                          <span className="text-destructive font-semibold">{Number(item.marginPercent).toFixed(1)}%</span>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="destructive" className="text-xs">Review pricing</Badge>
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
