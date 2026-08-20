"use client"

import { useState, useEffect } from "react"
import { getDeliveryPerformance, getDeliveryKPIs, getDeliveryAreaAnalytics } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, CartesianGrid, Legend, Cell } from "recharts"
import { format, subDays } from "date-fns"
import { Truck, Clock, CheckCircle, PoundSterling, MapPin, TrendingUp, Star, Route, Layers, Gauge } from "lucide-react"

type DriverRow = Awaited<ReturnType<typeof getDeliveryPerformance>>[number]
type KPIs = Awaited<ReturnType<typeof getDeliveryKPIs>>
type Area = Awaited<ReturnType<typeof getDeliveryAreaAnalytics>>

const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

const chartCfg = {
  revenue: { label: "Revenue", color: "var(--color-chart-1)" },
  orders: { label: "Orders", color: "var(--color-chart-2)" },
  aov: { label: "AOV", color: "var(--color-chart-3)" },
  driverCost: { label: "Driver Cost", color: "var(--color-chart-5)" },
  avgDeliveryMinutes: { label: "Avg Time (min)", color: "var(--color-chart-2)" },
  avgDeliveryMin: { label: "Avg Time (min)", color: "var(--color-chart-2)" },
  onTimeRate: { label: "On-time %", color: "var(--color-chart-3)" },
  assignMin: { label: "Assignment", color: "var(--color-chart-1)" },
  pickupMin: { label: "Pickup/Prep", color: "var(--color-chart-4)" },
  roadMin: { label: "Road Time", color: "var(--color-chart-2)" },
}

function num(v: unknown) { return Number(v ?? 0) }

function OnTimeBadge({ rate }: { rate: number }) {
  const cls = rate >= 90 ? "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)]"
    : rate >= 70 ? "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)]"
    : "bg-destructive/20 text-destructive"
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{rate.toFixed(1)}%</span>
}

export default function DeliveryPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [area, setArea] = useState<Area | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [d, k, a] = await Promise.all([
        getDeliveryPerformance(f.startDate, f.endDate),
        getDeliveryKPIs(f.startDate, f.endDate),
        getDeliveryAreaAnalytics(f.startDate, f.endDate),
      ])
      setDrivers(d as DriverRow[]); setKpis(k); setArea(a)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const overall = kpis?.overall
  const totalDel = num(overall?.totalDeliveries)
  const onTimeRate = totalDel > 0 ? (num(overall?.onTimeCount) / totalDel) * 100 : 0

  const dailyTrend = (kpis?.dailyTrend ?? []).map((row) => ({
    ...row,
    onTimeRate: num(row.totalDeliveries) > 0 ? Math.round((num(row.onTimeCount) / num(row.totalDeliveries)) * 100) : 0,
  }))

  const driverRows = drivers.map((d) => ({
    ...d,
    onTimeRate: num(d.totalDeliveries) > 0 ? (num(d.onTimeCount) / num(d.totalDeliveries)) * 100 : 0,
  }))

  const byArea = (area?.byArea ?? []).filter((a) => a.area !== "Unknown")
  const distanceBands = area?.distanceBands ?? []
  const bottleneck = area?.bottleneckByArea ?? []
  const zones = area?.zoneRanking ?? []
  const noData = !loading && totalDel === 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Delivery & Driver Analytics</h1>
        <p className="text-sm text-muted-foreground">Area performance, delivery efficiency, radius, profitability and bottlenecks — from Shipday</p>
      </div>

      <DateLocationFilter showChannel={false} onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      {/* ── KEPT KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Total Deliveries", value: totalDel.toLocaleString(), icon: <Truck className="size-4" /> },
          { label: "Avg Delivery Time", value: `${num(overall?.avgDeliveryMinutes).toFixed(0)} min`, icon: <Clock className="size-4" /> },
          { label: "On-Time Rate", value: `${onTimeRate.toFixed(1)}%`, icon: <CheckCircle className="size-4" /> },
          { label: "Total Revenue", value: `£${num(overall?.totalRevenue).toFixed(2)}`, icon: <TrendingUp className="size-4" /> },
          { label: "Total Driver Cost", value: `£${num(overall?.totalDriverCost).toFixed(2)}`, icon: <PoundSterling className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                {loading ? <Skeleton className="h-6 w-16 mt-1" /> : <p className="text-lg font-bold text-foreground">{k.value}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {noData && (
        <Card><CardContent className="py-16 text-center text-muted-foreground text-sm">No delivery data in this range — sync Shipday from the Data Sync page.</CardContent></Card>
      )}

      {!noData && (
        <>
          {/* ── DELIVERY TIME TREND (kept) ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Clock className="size-4" /> Delivery Time Trend</CardTitle>
              <CardDescription className="text-xs">Daily average delivery time and on-time rate</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-52 w-full" /> : (
                <ChartContainer config={chartCfg} className="h-52 w-full">
                  <LineChart data={dailyTrend} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} unit=" min" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} unit="%" domain={[0, 100]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line yAxisId="left" type="monotone" dataKey="avgDeliveryMinutes" stroke="var(--color-chart-2)" name="Avg Time (min)" dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="onTimeRate" stroke="var(--color-chart-3)" name="On-time %" dot={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          {/* ── DRIVER PERFORMANCE TABLE (kept) ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Star className="size-4" /> Driver Performance</CardTitle>
              <CardDescription className="text-xs">Deliveries, speed, on-time, and cost per driver</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? <Skeleton className="h-44 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Driver</TableHead>
                      <TableHead className="text-xs text-right">Deliveries</TableHead>
                      <TableHead className="text-xs text-right">Avg Dispatch</TableHead>
                      <TableHead className="text-xs text-right">Avg Delivery</TableHead>
                      <TableHead className="text-xs text-right">On-Time %</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                      <TableHead className="text-xs text-right">Driver Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {driverRows.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{d.driverName || "Unassigned"}</TableCell>
                        <TableCell className="text-xs text-right">{num(d.totalDeliveries)}</TableCell>
                        <TableCell className="text-xs text-right">{num(d.avgDispatchMinutes) > 0 ? `${num(d.avgDispatchMinutes).toFixed(0)} min` : "—"}</TableCell>
                        <TableCell className="text-xs text-right">{num(d.avgDeliveryMinutes) > 0 ? `${num(d.avgDeliveryMinutes).toFixed(0)} min` : "—"}</TableCell>
                        <TableCell className="text-xs text-right"><OnTimeBadge rate={d.onTimeRate} /></TableCell>
                        <TableCell className="text-xs text-right">£{num(d.totalRevenue).toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">£{num(d.totalDriverCost).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ── AREA PERFORMANCE ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><MapPin className="size-4" /> Area Performance</CardTitle>
              <CardDescription className="text-xs">Revenue, orders and AOV by postcode district (extracted from delivery address)</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-52 w-full" /> : byArea.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">No postcode districts could be extracted from delivery addresses in this range.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Revenue by Area</p>
                    <ChartContainer config={chartCfg} className="h-44 w-full">
                      <BarChart data={byArea.slice(0, 10)} margin={{ left: 0 }}>
                        <XAxis dataKey="area" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `£${v}`} />
                        <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`£${num(v).toFixed(2)}`, "Revenue"]} />
                        <Bar dataKey="revenue" radius={4} name="Revenue">{byArea.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                      </BarChart>
                    </ChartContainer>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Orders by Area</p>
                    <ChartContainer config={chartCfg} className="h-44 w-full">
                      <BarChart data={byArea.slice(0, 10)} margin={{ left: 0 }}>
                        <XAxis dataKey="area" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [num(v).toFixed(0), "Orders"]} />
                        <Bar dataKey="orders" radius={4} name="Orders">{byArea.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                      </BarChart>
                    </ChartContainer>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Average Order Value by Area</p>
                    <ChartContainer config={chartCfg} className="h-44 w-full">
                      <BarChart data={byArea.slice(0, 10)} margin={{ left: 0 }}>
                        <XAxis dataKey="area" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `£${v}`} />
                        <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`£${num(v).toFixed(2)}`, "AOV"]} />
                        <Bar dataKey="aov" radius={4} name="AOV">{byArea.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                      </BarChart>
                    </ChartContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── DELIVERY EFFICIENCY BY AREA ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Gauge className="size-4" /> Delivery Efficiency by Area</CardTitle>
              <CardDescription className="text-xs">Delivery duration = deliveryTime − placementTime</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-52 w-full" /> : byArea.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">No area data.</p>
              ) : (
                <>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Average Delivery Time by Area</p>
                  <ChartContainer config={chartCfg} className="h-44 w-full">
                    <BarChart data={byArea.slice(0, 12)} margin={{ left: 0 }}>
                      <XAxis dataKey="area" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} unit=" min" />
                      <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`${num(v).toFixed(1)} min`, "Avg Delivery"]} />
                      <Bar dataKey="avgDeliveryMin" radius={4} name="Avg Delivery (min)">
                        {byArea.slice(0, 12).map((a, i) => <Cell key={i} fill={a.avgDeliveryMin > 45 ? "var(--color-destructive, #ef4444)" : a.avgDeliveryMin > 35 ? "var(--color-chart-5)" : "var(--color-chart-2)"} />)}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  <div className="overflow-x-auto mt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Area</TableHead>
                          <TableHead className="text-xs text-right">Orders</TableHead>
                          <TableHead className="text-xs text-right">Revenue</TableHead>
                          <TableHead className="text-xs text-right">AOV</TableHead>
                          <TableHead className="text-xs text-right">Avg Delivery Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {byArea.map((a, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs font-medium">{a.area}</TableCell>
                            <TableCell className="text-xs text-right">{a.orders}</TableCell>
                            <TableCell className="text-xs text-right">£{a.revenue.toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">£{a.aov.toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right">
                              <span className={a.avgDeliveryMin > 45 ? "text-destructive" : a.avgDeliveryMin > 35 ? "text-[oklch(0.75_0.18_75)]" : ""}>
                                {a.avgDeliveryMin > 0 ? `${a.avgDeliveryMin.toFixed(1)} min` : "—"}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── DELIVERY RADIUS ANALYSIS ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Route className="size-4" /> Delivery Radius Analysis</CardTitle>
              <CardDescription className="text-xs">Orders, revenue and driver cost by distance band</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-44 w-full" /> : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Orders by Distance Band</p>
                    <ChartContainer config={chartCfg} className="h-40 w-full">
                      <BarChart data={distanceBands} margin={{ left: 0 }}>
                        <XAxis dataKey="band" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [num(v).toFixed(0), "Orders"]} />
                        <Bar dataKey="orders" fill="var(--color-chart-2)" radius={4} name="Orders" />
                      </BarChart>
                    </ChartContainer>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Revenue by Distance Band</p>
                    <ChartContainer config={chartCfg} className="h-40 w-full">
                      <BarChart data={distanceBands} margin={{ left: 0 }}>
                        <XAxis dataKey="band" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `£${v}`} />
                        <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`£${num(v).toFixed(2)}`, "Revenue"]} />
                        <Bar dataKey="revenue" fill="var(--color-chart-1)" radius={4} name="Revenue" />
                      </BarChart>
                    </ChartContainer>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Driver Cost by Distance Band</p>
                    <ChartContainer config={chartCfg} className="h-40 w-full">
                      <BarChart data={distanceBands} margin={{ left: 0 }}>
                        <XAxis dataKey="band" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `£${v}`} />
                        <ChartTooltip content={<ChartTooltipContent />} formatter={(v) => [`£${num(v).toFixed(2)}`, "Driver Cost"]} />
                        <Bar dataKey="driverCost" fill="var(--color-chart-5)" radius={4} name="Driver Cost" />
                      </BarChart>
                    </ChartContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── DELIVERY PROFITABILITY BY AREA ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><PoundSterling className="size-4" /> Delivery Profitability by Area</CardTitle>
              <CardDescription className="text-xs">Contribution = Revenue − Driver Cost</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? <Skeleton className="h-44 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Area</TableHead>
                      <TableHead className="text-xs text-right">Orders</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                      <TableHead className="text-xs text-right">Driver Cost</TableHead>
                      <TableHead className="text-xs text-right">Contribution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byArea.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{a.area}</TableCell>
                        <TableCell className="text-xs text-right">{a.orders}</TableCell>
                        <TableCell className="text-xs text-right">£{a.revenue.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">£{a.driverCost.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          <span className={a.contribution >= 0 ? "text-[oklch(0.7_0.15_150)]" : "text-destructive"}>£{a.contribution.toFixed(2)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* ── DELIVERY BOTTLENECK ANALYSIS ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Layers className="size-4" /> Delivery Bottleneck Analysis</CardTitle>
              <CardDescription className="text-xs">Assignment (dispatch) · Pickup (kitchen prep) · Road (travel) — minutes, stacked by area</CardDescription>
            </CardHeader>
            <CardContent>
              {area?.bottleneckOverall && !loading && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: "Assignment Delay", value: area.bottleneckOverall.assignMin, hint: "placement → assigned (dispatch)" },
                    { label: "Pickup Delay", value: area.bottleneckOverall.pickupMin, hint: "assigned → picked up (kitchen)" },
                    { label: "Road Time", value: area.bottleneckOverall.roadMin, hint: "picked up → delivered (travel)" },
                  ].map((b) => (
                    <div key={b.label} className="p-3 rounded-lg bg-secondary">
                      <p className="text-[10px] text-muted-foreground">{b.label}</p>
                      <p className="text-lg font-bold text-foreground">{b.value.toFixed(1)} min</p>
                      <p className="text-[10px] text-muted-foreground">{b.hint}</p>
                    </div>
                  ))}
                </div>
              )}
              {loading ? <Skeleton className="h-52 w-full" /> : bottleneck.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No timing data.</p>
              ) : (
                <ChartContainer config={chartCfg} className="h-52 w-full">
                  <BarChart data={bottleneck} margin={{ left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="area" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 10 }} unit=" min" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="assignMin" stackId="a" fill="var(--color-chart-1)" name="Assignment" />
                    <Bar dataKey="pickupMin" stackId="a" fill="var(--color-chart-4)" name="Pickup/Prep" />
                    <Bar dataKey="roadMin" stackId="a" fill="var(--color-chart-2)" name="Road Time" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">Tall <span className="text-[oklch(0.65_0.15_220)]">assignment</span> bars point to a dispatch problem; tall <span className="text-[oklch(0.7_0.15_300)]">pickup</span> bars to kitchen prep; tall <span className="text-[oklch(0.7_0.15_150)]">road</span> bars to travel distance/traffic.</p>
            </CardContent>
          </Card>

          {/* ── DELIVERY ZONE RANKING ── */}
          <Card>
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Star className="size-4" /> Delivery Zone Ranking</CardTitle>
              <CardDescription className="text-xs">Score = Revenue 40% · Orders 30% · Delivery Time 20% · Driver Cost 10% — for operational decisions</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {loading ? <Skeleton className="h-44 w-full" /> : zones.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Not enough area data to rank zones.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Area</TableHead>
                      <TableHead className="text-xs text-right">Orders</TableHead>
                      <TableHead className="text-xs text-right">Revenue</TableHead>
                      <TableHead className="text-xs text-right">Avg Time</TableHead>
                      <TableHead className="text-xs text-right">Score</TableHead>
                      <TableHead className="text-xs">Recommendation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zones.map((z, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{z.area}</TableCell>
                        <TableCell className="text-xs text-right">{z.orders}</TableCell>
                        <TableCell className="text-xs text-right">£{z.revenue.toFixed(2)}</TableCell>
                        <TableCell className="text-xs text-right">{z.avgDeliveryMin > 0 ? `${z.avgDeliveryMin.toFixed(0)} min` : "—"}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{z.score}</TableCell>
                        <TableCell className="text-xs">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                            z.recommendation === "Grow" ? "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]"
                            : z.recommendation === "Maintain" ? "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]"
                            : "bg-destructive/15 text-destructive border-destructive/30"
                          }`}>{z.recommendation}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
