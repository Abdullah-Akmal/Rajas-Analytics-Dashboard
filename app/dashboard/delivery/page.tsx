"use client"

import { useState, useEffect } from "react"
import { getDeliveryPerformance } from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis } from "recharts"
import { format, subDays } from "date-fns"
import { Truck, Clock, CheckCircle, PoundSterling } from "lucide-react"

type DriverRow = {
  driverName: string | null
  totalDeliveries: number
  successRate: number
  avgDeliveryMinutes: number
  avgDispatchMinutes: number
  totalRevenue: number
  totalDriverCost: number
  totalDistance: number
}

const chartConfig = {
  totalDeliveries: { label: "Deliveries", color: "var(--color-chart-1)" },
  avgDeliveryMinutes: { label: "Avg Time (min)", color: "var(--color-chart-2)" },
}

export default function DeliveryPage() {
  const [filters, setFilters] = useState({
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const d = await getDeliveryPerformance(f.startDate, f.endDate)
      setDrivers(d as DriverRow[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(filters) }, [])

  const totalDeliveries = drivers.reduce((s, d) => s + Number(d.totalDeliveries), 0)
  const avgDeliveryTime = drivers.length > 0 ? drivers.reduce((s, d) => s + Number(d.avgDeliveryMinutes), 0) / drivers.length : 0
  const avgSuccessRate = drivers.length > 0 ? drivers.reduce((s, d) => s + Number(d.successRate), 0) / drivers.length : 0
  const totalDriverCost = drivers.reduce((s, d) => s + Number(d.totalDriverCost), 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Delivery & Driver Analytics</h1>
        <p className="text-sm text-muted-foreground">Driver performance, delivery times, and cost analysis from Shipday</p>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Deliveries", value: totalDeliveries.toLocaleString(), icon: <Truck className="size-4" /> },
          { label: "Avg Delivery Time", value: `${avgDeliveryTime.toFixed(0)} min`, icon: <Clock className="size-4" /> },
          { label: "Success Rate", value: `${avgSuccessRate.toFixed(1)}%`, icon: <CheckCircle className="size-4" /> },
          { label: "Total Driver Cost", value: `£${totalDriverCost.toFixed(2)}`, icon: <PoundSterling className="size-4" /> },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-secondary flex items-center justify-center text-primary">{k.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-bold text-foreground">{k.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Deliveries by Driver</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48 w-full" /> : drivers.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No delivery data yet — sync Shipday first</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={drivers}>
                  <XAxis dataKey="driverName" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalDeliveries" fill="var(--color-chart-1)" radius={4} name="Deliveries" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Avg Delivery Time by Driver (min)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-48 w-full" /> : drivers.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No delivery data yet</div>
            ) : (
              <ChartContainer config={chartConfig} className="h-48 w-full">
                <BarChart data={drivers}>
                  <XAxis dataKey="driverName" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="avgDeliveryMinutes" fill="var(--color-chart-2)" radius={4} name="Avg Time (min)" />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Driver Performance Table</CardTitle>
          <CardDescription className="text-xs">Full breakdown per driver</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : drivers.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No delivery data yet — sync Shipday data first</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Driver</TableHead>
                  <TableHead className="text-xs text-right">Deliveries</TableHead>
                  <TableHead className="text-xs text-right">Success Rate</TableHead>
                  <TableHead className="text-xs text-right">Avg Dispatch</TableHead>
                  <TableHead className="text-xs text-right">Avg Delivery</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">Driver Cost</TableHead>
                  <TableHead className="text-xs text-right">Distance (km)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs font-medium">{d.driverName || "Unassigned"}</TableCell>
                    <TableCell className="text-xs text-right">{Number(d.totalDeliveries)}</TableCell>
                    <TableCell className="text-xs text-right">
                      <span className={Number(d.successRate) >= 90 ? "text-[oklch(0.7_0.15_150)]" : Number(d.successRate) >= 75 ? "text-[oklch(0.75_0.18_75)]" : "text-destructive"}>
                        {Number(d.successRate).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-right">{d.avgDispatchMinutes ? `${Number(d.avgDispatchMinutes).toFixed(0)} min` : "—"}</TableCell>
                    <TableCell className="text-xs text-right">{d.avgDeliveryMinutes ? `${Number(d.avgDeliveryMinutes).toFixed(0)} min` : "—"}</TableCell>
                    <TableCell className="text-xs text-right">£{Number(d.totalRevenue).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-right">£{Number(d.totalDriverCost).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-right">{Number(d.totalDistance).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Delivery Time Benchmarks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Dispatch Target", target: "< 3 min", desc: "Order assigned to driver" },
              { label: "Pickup Target", target: "< 15 min", desc: "Driver picks up food" },
              { label: "Delivery Target", target: "< 30 min", desc: "Food at customer door" },
            ].map((b) => (
              <div key={b.label} className="p-3 rounded-lg bg-secondary">
                <p className="text-xs text-muted-foreground">{b.label}</p>
                <p className="text-lg font-bold text-primary mt-1">{b.target}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{b.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
