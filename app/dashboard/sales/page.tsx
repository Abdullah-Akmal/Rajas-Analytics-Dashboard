"use client"

import { useState, useEffect, useMemo } from "react"
import { getItemProfitability } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, ScatterChart, Scatter, ReferenceLine, ReferenceArea, CartesianGrid, Cell, LineChart, Line, ComposedChart, ZAxis } from "recharts"
import { format, subDays } from "date-fns"
import { Search, Star, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react"

type ItemRow = Awaited<ReturnType<typeof getItemProfitability>>[number]

const chartCfg = {
  totalRevenue: { label: "Revenue", color: "var(--color-chart-1)" },
  totalQty: { label: "Units Sold", color: "var(--color-chart-2)" },
  grossProfit: { label: "Gross Profit", color: "var(--color-chart-3)" },
}

// Hex values work in both CSS and SVG fill attributes (oklch can break in SVG on some browsers)
const QUAD_COLORS = {
  STAR:    "#22c55e", // green
  PROMOTE: "#3b82f6", // blue
  FIX:     "#f59e0b", // amber
  REMOVE:  "#ef4444", // red
}

function classifyItem(qty: number, margin: number, medianQty: number): "STAR" | "PROMOTE" | "FIX" | "REMOVE" {
  const highPop = qty >= medianQty
  const highMargin = margin >= 50
  if (highPop && highMargin) return "STAR"
  if (!highPop && highMargin) return "PROMOTE"
  if (highPop && !highMargin) return "FIX"
  return "REMOVE"
}

const QUAD_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  STAR: { label: "STAR", color: "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]", desc: "High popularity, high margin — push hard" },
  PROMOTE: { label: "PROMOTE", color: "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]", desc: "Low popularity, high margin — feature in offers" },
  FIX: { label: "FIX", color: "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)] border-[oklch(0.38_0.1_75)]", desc: "High popularity, low margin — reprice or rework" },
  REMOVE: { label: "REMOVE", color: "bg-destructive/20 text-destructive border-destructive/30", desc: "Low popularity, low margin — consider removing" },
}

const QUAD_ACTION: Record<string, string> = {
  STAR: "Keep available, feature prominently, protect quality",
  PROMOTE: "Push in offers & bundles to lift volume",
  FIX: "Raise price or rework recipe to improve margin",
  REMOVE: "Consider removing or replacing",
}

function num(v: unknown) { return Number(v ?? 0) }

export default function SalesPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
    channel: "all",
    mode: "all",
    platform: "all",
  })
  const [items, setItems] = useState<ItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedClass, setSelectedClass] = useState<"all" | "STAR" | "PROMOTE" | "FIX" | "REMOVE">("all")
  const [xScale, setXScale] = useState<"linear" | "log">("log")

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      setItems(await getItemProfitability(f.startDate, f.endDate, f.location, f.channel, f.mode, f.platform) as ItemRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const filtered = items.filter((i) =>
    !search || i.itemName.toLowerCase().includes(search.toLowerCase()) ||
    (i.categoryName ?? "").toLowerCase().includes(search.toLowerCase())
  )

  // Menu engineering only considers items with a mapped cost. Uncosted items carry an
  // inflated 100% margin that would misplace them as STARs/PROMOTEs, so they're excluded
  // from the matrix and every classification table below (map them in Name Review first).
  const costed = useMemo(() => items.filter((i) => num(i.costPrice) > 0), [items])

  // Popularity threshold = median units among costed items.
  const medianQty = useMemo(() => {
    if (costed.length === 0) return 0
    const qtys = costed.map((i) => num(i.totalQty)).sort((a, b) => a - b)
    return qtys[Math.floor(qtys.length / 2)]
  }, [costed])

  const classified = useMemo(() =>
    costed.map((i) => ({ ...i, classification: classifyItem(num(i.totalQty), num(i.marginPercent), medianQty) })),
    [costed, medianQty]
  )

  const scatterData = classified.map((i) => ({
    x: num(i.totalQty),
    y: num(i.marginPercent),
    name: i.itemName,
    classification: i.classification,
    revenue: num(i.totalRevenue),
    orders: num(i.orderFrequency),
    category: i.categoryName ?? "Uncategorised",
  }))

  const byClass: Record<string, typeof classified> = { STAR: [], PROMOTE: [], FIX: [], REMOVE: [] }
  classified.forEach((i) => byClass[i.classification].push(i))

  // Largest units value (costed items) — drives the X-axis upper bound and right quadrants.
  const maxUnits = useMemo(() => Math.max(1, ...classified.map((i) => num(i.totalQty))), [classified])
  // Median can be 0 in sparse periods; log axis & quadrant boundaries need a positive split.
  const medianX = Math.max(medianQty, 1)
  // Explicit powers-of-10 ticks for the log axis. Recharts' auto log-tick generator
  // can emit two ticks with the same value, which collides React keys — supply our own.
  const logTicks = useMemo(() => {
    const ticks: number[] = []
    for (let t = 1; t <= maxUnits; t *= 10) ticks.push(t)
    return ticks
  }, [maxUnits])

  // Scatter scoped to the selected quadrant, sorted by popularity for readability.
  const scatterScoped = scatterData
    .filter((d) => selectedClass === "all" || d.classification === selectedClass)
    .slice()
    .sort((a, b) => b.x - a.x)

  const top10Revenue = [...items].sort((a, b) => num(b.totalRevenue) - num(a.totalRevenue)).slice(0, 10)
  const top10Units = [...items].sort((a, b) => num(b.totalQty) - num(a.totalQty)).slice(0, 10)

  // Pareto: cumulative revenue %
  const totalRev = items.reduce((s, i) => s + num(i.totalRevenue), 0)
  let cumulative = 0
  const pareto = [...items]
    .sort((a, b) => num(b.totalRevenue) - num(a.totalRevenue))
    .slice(0, 20)
    .map((i) => {
      cumulative += num(i.totalRevenue)
      return { name: i.itemName.substring(0, 18), revenue: num(i.totalRevenue), cumPct: totalRev > 0 ? Math.round((cumulative / totalRev) * 100) : 0 }
    })

  const totalOrders = items.reduce((s) => s + 1, 0)
  const totalQty = items.reduce((s, i) => s + num(i.totalQty), 0)
  const totalProfit = items.reduce((s, i) => s + num(i.grossProfit), 0)
  const avgMargin = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Item Performance</h1>
        <p className="text-sm text-muted-foreground">Menu engineering — identify stars, hidden gems, and items dragging down margin</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Unique Items", value: items.length.toLocaleString() },
          { label: "Total Units Sold", value: totalQty.toFixed(0) },
          { label: "Total Revenue", value: `£${totalRev.toFixed(2)}` },
          { label: "Avg Margin", value: `${avgMargin.toFixed(1)}%` },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              {loading ? <Skeleton className="h-7 w-24 mt-1" /> : <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Menu Engineering Summary */}
      {!loading && classified.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(["STAR", "PROMOTE", "FIX", "REMOVE"] as const).map((q) => (
            <Card key={q} className="border">
              <CardContent className="p-4">
                <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border ${QUAD_LABELS[q].color}`}>
                  {q === "STAR" && <Star className="size-3" />}
                  {q === "PROMOTE" && <TrendingUp className="size-3" />}
                  {q === "FIX" && <AlertTriangle className="size-3" />}
                  {q === "REMOVE" && <TrendingDown className="size-3" />}
                  {q}
                </div>
                <p className="text-2xl font-bold mt-2">{byClass[q].length}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{QUAD_LABELS[q].desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="matrix">
        <TabsList>
          <TabsTrigger value="matrix">Menu Engineering Matrix</TabsTrigger>
          <TabsTrigger value="ranked">Ranked Items</TabsTrigger>
          <TabsTrigger value="pareto">Pareto (80/20)</TabsTrigger>
          <TabsTrigger value="table">Full Table</TabsTrigger>
        </TabsList>

        {/* Menu Engineering Matrix */}
        <TabsContent value="matrix" className="mt-4">
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold">Popularity vs Margin — Menu Engineering Matrix</CardTitle>
              <CardDescription className="text-xs">Slice by quadrant to isolate STAR / PROMOTE / FIX items — points are positioned by popularity (units sold).</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Classification slicer */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button
                  onClick={() => setSelectedClass("all")}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all ${selectedClass === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  All items ({classified.length})
                </button>
                {(["STAR", "PROMOTE", "FIX", "REMOVE"] as const).map((q) => {
                  const active = selectedClass === q
                  return (
                    <button
                      key={q}
                      onClick={() => setSelectedClass(q)}
                      className="text-[11px] px-2.5 py-1 rounded-md border transition-all flex items-center gap-1.5"
                      style={active
                        ? { background: QUAD_COLORS[q], borderColor: QUAD_COLORS[q], color: "#fff" }
                        : { borderColor: "var(--border)" }}
                    >
                      <span className="size-2 rounded-full" style={{ background: active ? "#fff" : QUAD_COLORS[q] }} />
                      <span className={active ? "" : "text-muted-foreground"}>{q} ({byClass[q].length})</span>
                    </button>
                  )
                })}
              </div>

              {/* Chart controls */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Units axis:</span>
                  {(["log", "linear"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setXScale(s)}
                      className={`px-2 py-0.5 rounded border capitalize transition-all ${xScale === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {s}
                    </button>
                  ))}
                  <span className="text-muted-foreground/70">{xScale === "log" ? "(spreads out low-volume items)" : ""}</span>
                </div>
                <span className="text-muted-foreground ml-auto inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-muted-foreground/40" />
                  <span className="size-3 rounded-full bg-muted-foreground/40" />
                  bubble size = revenue
                </span>
              </div>

              {loading ? <Skeleton className="h-80 w-full" /> : scatterScoped.length === 0 ? (
                <div className="h-80 flex items-center justify-center text-muted-foreground text-sm">No {selectedClass === "all" ? "" : selectedClass + " "}items in this period</div>
              ) : (
                <ChartContainer config={chartCfg} className="h-80 w-full">
                  <ScatterChart margin={{ left: 8, right: 12, top: 12, bottom: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    {/* Quadrant background shading + corner labels (explicit siblings — Recharts
                        re-processes children, so a mapped array here breaks key reconciliation) */}
                    <ReferenceArea x1={xScale === "log" ? 1 : 0} x2={medianX} y1={50} y2={100} fill={QUAD_COLORS.PROMOTE} fillOpacity={0.07} stroke="none" label={{ value: "PROMOTE", position: "insideTopLeft", fill: QUAD_COLORS.PROMOTE, fontSize: 11, fontWeight: 700, opacity: 0.55 }} />
                    <ReferenceArea x1={medianX} x2={maxUnits} y1={50} y2={100} fill={QUAD_COLORS.STAR} fillOpacity={0.07} stroke="none" label={{ value: "STAR", position: "insideTopRight", fill: QUAD_COLORS.STAR, fontSize: 11, fontWeight: 700, opacity: 0.55 }} />
                    <ReferenceArea x1={xScale === "log" ? 1 : 0} x2={medianX} y1={0} y2={50} fill={QUAD_COLORS.REMOVE} fillOpacity={0.07} stroke="none" label={{ value: "REMOVE", position: "insideBottomLeft", fill: QUAD_COLORS.REMOVE, fontSize: 11, fontWeight: 700, opacity: 0.55 }} />
                    <ReferenceArea x1={medianX} x2={maxUnits} y1={0} y2={50} fill={QUAD_COLORS.FIX} fillOpacity={0.07} stroke="none" label={{ value: "FIX", position: "insideBottomRight", fill: QUAD_COLORS.FIX, fontSize: 11, fontWeight: 700, opacity: 0.55 }} />
                    <XAxis
                      type="number" dataKey="x" name="Units Sold"
                      scale={xScale} domain={xScale === "log" ? [1, maxUnits] : [0, maxUnits]} allowDataOverflow
                      ticks={xScale === "log" ? logTicks : undefined}
                      tick={{ fontSize: 10 }} label={{ value: "Units Sold (popularity)", position: "insideBottom", offset: -4, style: { fontSize: 10 } }}
                    />
                    <YAxis type="number" dataKey="y" name="Margin %" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} label={{ value: "Margin %", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                    <ZAxis type="number" dataKey="revenue" range={[40, 700]} name="Revenue" />
                    <ReferenceLine x={medianX} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: "Median units", position: "top", style: { fontSize: 9 } }} />
                    <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: "50% margin", position: "right", style: { fontSize: 9 } }} />
                    <ChartTooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const d = payload[0]?.payload as typeof scatterData[number]
                        return (
                          <div className="bg-popover border border-border rounded-lg p-2 text-xs shadow">
                            <p className="font-semibold truncate max-w-48">{d.name}</p>
                            <p className="text-muted-foreground">{d.category}</p>
                            <p className="text-muted-foreground">Units: {d.x} · Orders: {d.orders} · Margin: {d.y?.toFixed(1)}%</p>
                            <p className="text-muted-foreground">Revenue: £{d.revenue?.toFixed(2)}</p>
                            <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${QUAD_LABELS[d.classification]?.color}`}>{d.classification}</span>
                          </div>
                        )
                      }}
                    />
                    <Scatter data={scatterScoped} fillOpacity={0.7} stroke="var(--background)" strokeWidth={0.5}>
                      {scatterScoped.map((d, i) => (
                        <Cell key={i} fill={QUAD_COLORS[d.classification]} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ChartContainer>
              )}
              <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
                {(["STAR", "PROMOTE", "FIX", "REMOVE"] as const).map((q) => (
                  <div key={q} className="text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[11px]">
                      <span className="size-2.5 rounded-full" style={{ background: QUAD_COLORS[q] }} />
                      {q}
                    </span>
                    <p className="text-muted-foreground mt-0.5">{QUAD_LABELS[q].desc}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Note: uncosted items (no cost mapped) are excluded from this matrix and the tables below — map them in Name Review → Uncosted to include them.</p>

              {/* Matrix calculation explanation */}
              <div className="mt-4 p-3 rounded-lg bg-secondary/60 border border-border text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground text-[11px]">How the Menu Engineering Matrix is calculated</p>
                <p><strong>Popularity threshold</strong> — median units sold across all items in the period. Items at or above the median are "high popularity".</p>
                <p><strong>Margin threshold</strong> — 50% gross margin. Items at or above 50% are "high margin" (revenue − food cost) ÷ revenue.</p>
                <p><strong>STAR</strong> = high popularity ∩ high margin. Best performers — protect quality, keep visible. <strong>PROMOTE</strong> = low popularity ∩ high margin. Hidden gems — push via offers/bundles. <strong>FIX</strong> = high popularity ∩ low margin. Volume sellers hurting profit — reprice or rework recipe. <strong>REMOVE</strong> = low popularity ∩ low margin. Dead weight — consider removing or replacing.</p>
                <p>Margin = (Revenue − Cost) ÷ Revenue × 100. Items without a cost mapping show inflated margins — use Name Review to fix those first.</p>
              </div>
            </CardContent>
          </Card>

          {/* Top 10 per quadrant — ranked by order frequency */}
          {!loading && classified.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {(["STAR", "PROMOTE", "FIX", "REMOVE"] as const).map((q) => {
                const list = [...byClass[q]]
                  .sort((a, b) => num(b.orderFrequency) - num(a.orderFrequency))
                  .slice(0, 10)
                return (
                  <Card key={q} style={{ borderTopColor: QUAD_COLORS[q], borderTopWidth: 3 }}>
                    <CardHeader className="pb-2 text-center">
                      <CardTitle className="text-sm font-semibold flex items-center justify-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: QUAD_COLORS[q] }} />
                        {q} — Top 10 by Order Frequency
                      </CardTitle>
                      <CardDescription className="text-xs">{QUAD_LABELS[q].desc}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {list.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No {q} items in this period</p>
                      ) : (
                        <>
                          {/* Column headers */}
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pb-1 border-b border-border mb-1">
                            <span className="w-4" />
                            <span className="flex-1">Item</span>
                            <span className="w-14 text-right">Orders</span>
                            <span className="w-12 text-right">Units</span>
                            <span className="w-12 text-right">Margin</span>
                            <span className="w-14 text-right">Revenue</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {list.map((it, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                                <span className="text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
                                <span className="flex-1 truncate font-medium">{it.itemName}</span>
                                <span className="font-semibold w-14 text-right shrink-0" style={{ color: QUAD_COLORS[q] }}>
                                  {num(it.orderFrequency).toFixed(0)}
                                </span>
                                <span className="text-muted-foreground w-12 text-right shrink-0">{num(it.totalQty).toFixed(0)}</span>
                                <span className="text-muted-foreground w-12 text-right shrink-0">{num(it.marginPercent).toFixed(0)}%</span>
                                <span className="text-muted-foreground w-14 text-right shrink-0">£{num(it.totalRevenue).toFixed(0)}</span>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-2">{QUAD_ACTION[q]}</p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* Ranked Items */}
        <TabsContent value="ranked" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-sm font-semibold">Top 10 by Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-52 w-full" /> : (
                  <ChartContainer config={chartCfg} className="h-52 w-full">
                    <BarChart data={top10Revenue} layout="vertical" margin={{ left: 4 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `£${v}`} />
                      <YAxis type="category" dataKey="itemName" tick={{ fontSize: 9 }} width={110} tickFormatter={(v) => v.length > 16 ? v.substring(0, 16) + "…" : v} />
                      <ChartTooltip content={({ payload }) => payload?.[0] ? <div className="bg-popover border rounded p-2 text-xs"><p className="font-medium">{payload[0].payload.itemName}</p><p>£{num(payload[0].value).toFixed(2)}</p></div> : null} />
                      <Bar dataKey="totalRevenue" fill="var(--color-chart-1)" radius={3} name="Revenue" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 text-center">
                <CardTitle className="text-sm font-semibold">Top 10 by Units Sold</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-52 w-full" /> : (
                  <ChartContainer config={chartCfg} className="h-52 w-full">
                    <BarChart data={top10Units} layout="vertical" margin={{ left: 4 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="itemName" tick={{ fontSize: 9 }} width={110} tickFormatter={(v) => v.length > 16 ? v.substring(0, 16) + "…" : v} />
                      <ChartTooltip content={({ payload }) => payload?.[0] ? <div className="bg-popover border rounded p-2 text-xs"><p className="font-medium">{payload[0].payload.itemName}</p><p>{num(payload[0].value).toFixed(0)} units</p></div> : null} />
                      <Bar dataKey="totalQty" fill="var(--color-chart-2)" radius={3} name="Units" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Pareto */}
        <TabsContent value="pareto" className="mt-4">
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold">Pareto — Top 20 Items by Revenue Contribution</CardTitle>
              <CardDescription className="text-xs">Which items generate 80% of total revenue?</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-64 w-full" /> : (
                <ChartContainer config={{ ...chartCfg, cumPct: { label: "Cumulative %", color: "var(--color-chart-4)" } }} className="h-64 w-full">
                  <ComposedChart data={pareto} margin={{ left: 0, right: 24 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 8 }} angle={-35} textAnchor="end" height={50} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                    <ChartTooltip content={({ payload }) => payload?.[0] ? (
                      <div className="bg-popover border rounded p-2 text-xs">
                        <p className="font-medium">{payload[0].payload.name}</p>
                        <p>£{num(payload[0].payload.revenue).toFixed(2)}</p>
                        <p className="text-muted-foreground">Cumulative: {payload[0].payload.cumPct}%</p>
                      </div>
                    ) : null} />
                    <Bar yAxisId="left" dataKey="revenue" fill="var(--color-chart-1)" radius={3} name="Revenue" />
                    <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke="var(--color-chart-4)" dot={false} strokeWidth={2} name="Cumulative %" />
                  </ComposedChart>
                </ChartContainer>
              )}
              {!loading && pareto.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Top {pareto.findIndex((p) => p.cumPct >= 80) + 1} items generate 80%+ of revenue
                  ({pareto.find((p) => p.cumPct >= 80)?.cumPct}% at item #{pareto.findIndex((p) => p.cumPct >= 80) + 1})
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Full Table */}
        <TabsContent value="table" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-semibold">All Costed Items</CardTitle>
                <div className="relative w-52">
                  <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                  <Input placeholder="Search item or category..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs">Category</TableHead>
                      <TableHead className="text-xs">Class</TableHead>
                      <TableHead className="text-xs text-right">Units</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                      <TableHead className="text-xs text-right">Gross Profit</TableHead>
                      <TableHead className="text-xs text-right">Margin %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classified.filter((i) => !search || i.itemName.toLowerCase().includes(search.toLowerCase())).map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{item.itemName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.categoryName || "—"}</TableCell>
                        <TableCell className="text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${QUAD_LABELS[item.classification]?.color}`}>{item.classification}</span>
                        </TableCell>
                        <TableCell className="text-xs text-right">{num(item.totalQty).toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right">£{num(item.totalRevenue).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={num(item.grossProfit) >= 0 ? "text-[oklch(0.7_0.15_150)]" : "text-destructive"}>£{num(item.grossProfit).toFixed(2)}</span>
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          <span className={num(item.marginPercent) >= 60 ? "text-[oklch(0.7_0.15_150)]" : num(item.marginPercent) >= 40 ? "text-[oklch(0.75_0.18_75)]" : "text-destructive"}>
                            {num(item.marginPercent).toFixed(1)}%
                          </span>
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
