"use client"

import { useState, useEffect } from "react"
import {
  getItemProfitability, getPlatformPerformance, getDeliveryPerformance, getCategoryPerformance,
  getActionItems, createActionItem, updateActionItem, deleteActionItem,
} from "@/app/actions/dashboard"
import { DateLocationFilter } from "@/components/date-location-filter"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { format, subDays, differenceInDays, parseISO } from "date-fns"
import { Zap, TrendingDown, AlertTriangle, CheckCircle, Target, Package, ShoppingBag, DollarSign, Plus, Trash2, ClipboardList } from "lucide-react"

type ActionItem = Awaited<ReturnType<typeof getActionItems>>[number]

const STATUS_OPTS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
]
const PRIORITY_OPTS = ["high", "medium", "low"]
const CATEGORY_OPTS = ["Pricing", "Offers", "Platform", "Delivery", "Menu", "Staffing", "Other"]

function statusStyle(s: string) {
  if (s === "done") return "bg-[oklch(0.25_0.08_150)] text-[oklch(0.7_0.15_150)] border-[oklch(0.35_0.08_150)]"
  if (s === "in_progress") return "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]"
  return "bg-secondary text-muted-foreground border-border"
}
function priorityStyle(p: string) {
  if (p === "high") return "bg-destructive/15 text-destructive border-destructive/30"
  if (p === "medium") return "bg-[oklch(0.25_0.1_75)] text-[oklch(0.75_0.18_75)] border-[oklch(0.38_0.1_75)]"
  return "bg-[oklch(0.22_0.08_220)] text-[oklch(0.65_0.15_220)] border-[oklch(0.35_0.08_220)]"
}

export default function ActionsPage() {
  const [filters, setFilters] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
    location: "all",
  })
  const [items, setItems] = useState<unknown[]>([])
  const [platforms, setPlatforms] = useState<unknown[]>([])
  const [drivers, setDrivers] = useState<unknown[]>([])
  const [categories, setCategories] = useState<unknown[]>([])
  const [loading, setLoading] = useState(true)

  // Execution tracker state
  const [tracker, setTracker] = useState<ActionItem[]>([])
  const [trackerLoading, setTrackerLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTask, setNewTask] = useState({ title: "", owner: "", deadline: "", priority: "medium", category: "Other" })

  const fetchData = async (f: typeof filters) => {
    setLoading(true)
    try {
      const [i, p, d, c] = await Promise.all([
        getItemProfitability(f.startDate, f.endDate, f.location),
        getPlatformPerformance(f.startDate, f.endDate, f.location),
        getDeliveryPerformance(f.startDate, f.endDate),
        getCategoryPerformance(f.startDate, f.endDate, f.location),
      ])
      setItems(i); setPlatforms(p); setDrivers(d); setCategories(c)
    } finally {
      setLoading(false)
    }
  }

  const fetchTracker = async () => {
    setTrackerLoading(true)
    try {
      setTracker(await getActionItems())
    } finally {
      setTrackerLoading(false)
    }
  }

  useEffect(() => { fetchData(filters); fetchTracker() }, [])

  // ── editing helpers ──
  const patchItem = async (id: number, patch: Record<string, unknown>) => {
    setSavingId(id)
    // optimistic
    setTracker((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } as ActionItem : t))
    await updateActionItem(id, patch as any)
    await fetchTracker()
    setSavingId(null)
  }
  const removeItem = async (id: number) => {
    setTracker((prev) => prev.filter((t) => t.id !== id))
    await deleteActionItem(id)
  }
  const addManual = async () => {
    if (!newTask.title.trim()) return
    setAdding(true)
    await createActionItem({ ...newTask, deadline: newTask.deadline || null })
    setNewTask({ title: "", owner: "", deadline: "", priority: "medium", category: "Other" })
    await fetchTracker()
    setAdding(false)
  }

  // ── auto-generated actions (same logic as before) ──
  type ItemN = { itemName: string; marginPercent: number; totalQty: number; totalRevenue: number; grossProfit: number; categoryName: string }
  type PlatN = { platform: string; totalRevenue: number; totalOrders: number; totalDiscount: number; avgOrderValue: number }
  type DriverN = { driverName: string; avgDeliveryMinutes: number; totalDeliveries: number }
  type CatN = { category: string; marginPercent: number; totalRevenue: number }

  const typedItems = items as ItemN[]
  const typedPlatforms = platforms as PlatN[]
  const typedDrivers = drivers as DriverN[]
  const typedCategories = categories as CatN[]

  const byPlatform = typedPlatforms.reduce((acc: Record<string, PlatN>, row) => {
    const key = row.platform
    if (!acc[key]) acc[key] = { platform: key, totalRevenue: 0, totalOrders: 0, totalDiscount: 0, avgOrderValue: 0 }
    acc[key].totalRevenue += Number(row.totalRevenue)
    acc[key].totalOrders += Number(row.totalOrders)
    acc[key].totalDiscount += Number(row.totalDiscount)
    return acc
  }, {})
  const platformList = Object.values(byPlatform).map((p) => ({
    ...p,
    avgOrderValue: p.totalOrders > 0 ? p.totalRevenue / p.totalOrders : 0,
    discountRate: p.totalRevenue > 0 ? (p.totalDiscount / p.totalRevenue) * 100 : 0,
  })).sort((a, b) => b.totalRevenue - a.totalRevenue)

  type Gen = { priority: "high" | "medium" | "low"; category: string; channel?: string; action: string; detail: string; impact: string; icon: React.ReactNode }
  const actions: Gen[] = []

  const atRisk = typedItems.filter((i) => Number(i.marginPercent) < 35 && Number(i.totalQty) > 10)
  if (atRisk.length > 0) {
    const topRisk = atRisk.slice(0, 3)
    const riskRevenue = atRisk.reduce((s, i) => s + Number(i.totalRevenue), 0)
    actions.push({
      priority: "high", category: "Pricing",
      action: `${atRisk.length} high-volume item${atRisk.length > 1 ? "s" : ""} with margin below 35%`,
      detail: topRisk.map((i) => `• ${i.itemName} — ${Number(i.marginPercent).toFixed(0)}% margin, ${Number(i.totalQty).toFixed(0)} sold`).join("\n"),
      impact: `These items generated £${riskRevenue.toFixed(0)} revenue but at low margin. Raise prices 5–10% or cut portion cost.`,
      icon: <TrendingDown className="size-4" />,
    })
  }
  platformList.filter((p) => p.discountRate > 8).forEach((p) => {
    actions.push({
      priority: "high", category: "Offers", channel: p.platform,
      action: `${p.platform} — discount rate at ${p.discountRate.toFixed(1)}% of channel revenue`,
      detail: `£${p.totalDiscount.toFixed(0)} discounted of £${p.totalRevenue.toFixed(0)} on ${p.platform} (${p.totalOrders} orders).`,
      impact: `Halving ${p.platform} discounts recovers ~£${(p.totalDiscount / 2).toFixed(0)} margin this period.`,
      icon: <AlertTriangle className="size-4" />,
    })
  })
  if (platformList.length >= 2) {
    const weakest = [...platformList].sort((a, b) => a.avgOrderValue - b.avgOrderValue)[0]
    const strongest = platformList[0]
    if (weakest.platform !== strongest.platform && weakest.avgOrderValue < strongest.avgOrderValue * 0.7) {
      actions.push({
        priority: "medium", category: "Platform", channel: weakest.platform,
        action: `${weakest.platform} has the lowest average order value (£${weakest.avgOrderValue.toFixed(2)})`,
        detail: `${strongest.platform} averages £${strongest.avgOrderValue.toFixed(2)} vs ${weakest.platform} at £${weakest.avgOrderValue.toFixed(2)}.`,
        impact: `Add upsell triggers on ${weakest.platform}. +£1 avg order = +£${weakest.totalOrders.toFixed(0)} revenue.`,
        icon: <ShoppingBag className="size-4" />,
      })
    }
  }
  if (platformList.length > 0) {
    const top = platformList[0]
    actions.push({
      priority: "medium", category: "Platform", channel: top.platform,
      action: `${top.platform} is your top revenue channel — protect and grow it`,
      detail: `£${top.totalRevenue.toFixed(0)} across ${top.totalOrders} orders (£${top.avgOrderValue.toFixed(2)} avg).`,
      impact: `Prioritise photos, descriptions and response times on ${top.platform}.`,
      icon: <Target className="size-4" />,
    })
  }
  const slowDrivers = typedDrivers.filter((d) => Number(d.avgDeliveryMinutes) > 40)
  if (slowDrivers.length > 0) {
    actions.push({
      priority: "medium", category: "Delivery",
      action: `${slowDrivers.length} driver${slowDrivers.length > 1 ? "s" : ""} averaging over 40 min delivery`,
      detail: slowDrivers.map((d) => `• ${d.driverName} — ${Number(d.avgDeliveryMinutes).toFixed(0)} min over ${d.totalDeliveries} deliveries`).join("\n"),
      impact: `Slow delivery hurts platform ratings. Brief drivers or adjust zones.`,
      icon: <TrendingDown className="size-4" />,
    })
  }
  const bestCat = [...typedCategories].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent))[0]
  if (bestCat && Number(bestCat.marginPercent) > 60) {
    actions.push({
      priority: "medium", category: "Menu",
      action: `${bestCat.category} is your highest-margin category — push it`,
      detail: `${Number(bestCat.marginPercent).toFixed(0)}% margin, £${Number(bestCat.totalRevenue).toFixed(0)} revenue.`,
      impact: `Feature in banners and bundles — higher-margin sales lift profit at no extra cost.`,
      icon: <DollarSign className="size-4" />,
    })
  }
  const topItems = [...typedItems].sort((a, b) => Number(b.grossProfit) - Number(a.grossProfit)).slice(0, 3)
  if (topItems.length > 0) {
    actions.push({
      priority: "low", category: "Menu",
      action: `Top 3 profit contributors — ensure consistent availability`,
      detail: topItems.map((i) => `• ${i.itemName} — £${Number(i.grossProfit).toFixed(0)} profit, ${Number(i.totalQty).toFixed(0)} sold`).join("\n"),
      impact: `Shortages here hit profit hardest. Check ingredient supply weekly.`,
      icon: <Package className="size-4" />,
    })
  }
  const poorCats = typedCategories.filter((c) => Number(c.marginPercent) < 20 && Number(c.totalRevenue) > 100)
  if (poorCats.length > 0) {
    actions.push({
      priority: "high", category: "Menu",
      action: `${poorCats.length} categor${poorCats.length > 1 ? "ies" : "y"} with margin under 20%`,
      detail: poorCats.map((c) => `• ${c.category} — ${Number(c.marginPercent).toFixed(0)}% margin, £${Number(c.totalRevenue).toFixed(0)} revenue`).join("\n"),
      impact: `Review supplier costs or pricing. Below 20% margin, volume hurts profit.`,
      icon: <AlertTriangle className="size-4" />,
    })
  }
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const sorted = actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  const trackedTitles = new Set(tracker.map((t) => t.title))
  const promote = async (g: Gen) => {
    await createActionItem({
      title: g.action,
      detail: g.detail,
      category: g.category,
      priority: g.priority,
      impact: g.impact,
    })
    await fetchTracker()
  }

  const openCount = tracker.filter((t) => t.status !== "done").length
  const doneCount = tracker.filter((t) => t.status === "done").length
  const overdue = tracker.filter((t) => t.status !== "done" && t.deadline && differenceInDays(new Date(), parseISO(t.deadline as unknown as string)) > 0).length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Weekly Action Panel</h1>
        <p className="text-sm text-muted-foreground">Auto-generated priorities plus a live execution tracker — assign, schedule and track to done</p>
      </div>

      {/* ─── EXECUTION TRACKER ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <ClipboardList className="size-4 text-primary" />
              <div>
                <CardTitle className="text-sm font-semibold">Execution Tracker</CardTitle>
                <CardDescription className="text-xs">Assigned tasks with owner, deadline and status — persisted across sessions</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Open: <strong className="text-foreground">{openCount}</strong></span>
              <span className="text-muted-foreground">Done: <strong className="text-[oklch(0.7_0.15_150)]">{doneCount}</strong></span>
              {overdue > 0 && <span className="text-destructive font-semibold">Overdue: {overdue}</span>}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* manual add row */}
          <div className="flex items-end gap-2 mb-4 flex-wrap">
            <div className="flex-1 min-w-48">
              <label className="text-[10px] text-muted-foreground">Action</label>
              <Input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="New task…" className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Owner</label>
              <Input value={newTask.owner} onChange={(e) => setNewTask({ ...newTask, owner: e.target.value })} placeholder="Name" className="h-8 text-xs w-28" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Deadline</label>
              <Input type="date" value={newTask.deadline} onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })} className="h-8 text-xs w-36" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block">Priority</label>
              <select value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })} className="h-8 text-xs rounded-md border border-border bg-background px-2">
                {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block">Category</label>
              <select value={newTask.category} onChange={(e) => setNewTask({ ...newTask, category: e.target.value })} className="h-8 text-xs rounded-md border border-border bg-background px-2">
                {CATEGORY_OPTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <Button size="sm" className="h-8" onClick={addManual} disabled={adding || !newTask.title.trim()}>
              <Plus className="size-3.5 mr-1" /> Add
            </Button>
          </div>

          {trackerLoading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : tracker.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-xs">
              No tracked tasks yet. Add one above, or click “Track” on a generated action below.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs w-24">Category</TableHead>
                  <TableHead className="text-xs w-20">Priority</TableHead>
                  <TableHead className="text-xs w-32">Owner</TableHead>
                  <TableHead className="text-xs w-36">Deadline</TableHead>
                  <TableHead className="text-xs w-32">Status</TableHead>
                  <TableHead className="text-xs w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracker.map((t) => {
                  const isOverdue = t.status !== "done" && t.deadline && differenceInDays(new Date(), parseISO(t.deadline as unknown as string)) > 0
                  return (
                    <TableRow key={t.id} className={savingId === t.id ? "opacity-60" : ""}>
                      <TableCell className="text-xs">
                        <p className={`font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                        {t.detail && <p className="text-[10px] text-muted-foreground whitespace-pre-line mt-0.5">{t.detail}</p>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{t.category}</Badge></TableCell>
                      <TableCell>
                        <select
                          value={t.priority}
                          onChange={(e) => patchItem(t.id, { priority: e.target.value })}
                          className={`text-[10px] rounded-full border px-1.5 py-0.5 ${priorityStyle(t.priority)}`}
                        >
                          {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </TableCell>
                      <TableCell>
                        <Input
                          defaultValue={t.owner ?? ""}
                          placeholder="Unassigned"
                          onBlur={(e) => { if (e.target.value !== (t.owner ?? "")) patchItem(t.id, { owner: e.target.value || null }) }}
                          className="h-7 text-xs"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          defaultValue={(t.deadline as unknown as string) ?? ""}
                          onChange={(e) => patchItem(t.id, { deadline: e.target.value || null })}
                          className={`h-7 text-xs ${isOverdue ? "border-destructive text-destructive" : ""}`}
                        />
                      </TableCell>
                      <TableCell>
                        <select
                          value={t.status}
                          onChange={(e) => patchItem(t.id, { status: e.target.value })}
                          className={`text-[11px] rounded-md border px-2 py-1 w-full ${statusStyle(t.status)}`}
                        >
                          {STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => removeItem(t.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="size-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* ─── AUTO-GENERATED ACTIONS ─── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Suggested Actions (live data)</h2>
          <p className="text-xs text-muted-foreground">Click “Track” to add any suggestion to the execution tracker above</p>
        </div>
      </div>

      <DateLocationFilter onFilterChange={(f) => { setFilters(f); fetchData(f) }} />

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "High Priority", count: sorted.filter((a) => a.priority === "high").length, color: "text-destructive" },
          { label: "Medium Priority", count: sorted.filter((a) => a.priority === "medium").length, color: "text-[oklch(0.75_0.18_75)]" },
          { label: "Low Priority", count: sorted.filter((a) => a.priority === "low").length, color: "text-[oklch(0.6_0.15_200)]" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color} mt-1`}>{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Zap className="size-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No actions generated yet</p>
            <p className="text-xs text-muted-foreground mt-1">Sync data from Presto, Shipday and Google Sheets to generate strategic actions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((action, i) => {
            const tracked = trackedTitles.has(action.action)
            return (
              <Card key={i} className={`border-l-2 ${action.priority === "high" ? "border-l-destructive" : action.priority === "medium" ? "border-l-[oklch(0.75_0.18_75)]" : "border-l-[oklch(0.6_0.15_200)]"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 shrink-0 ${action.priority === "high" ? "text-destructive" : action.priority === "medium" ? "text-[oklch(0.75_0.18_75)]" : "text-[oklch(0.6_0.15_200)]"}`}>
                      {action.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Badge variant={action.priority === "high" ? "destructive" : "secondary"} className="text-[10px]">{action.priority}</Badge>
                        <Badge variant="outline" className="text-[10px]">{action.category}</Badge>
                        {action.channel && <Badge variant="outline" className="text-[10px] font-semibold capitalize border-primary/40 text-primary">{action.channel}</Badge>}
                      </div>
                      <p className="text-sm font-semibold text-foreground">{action.action}</p>
                      {action.detail && (
                        <pre className="text-xs text-muted-foreground mt-1.5 whitespace-pre-wrap font-sans leading-relaxed bg-secondary/50 rounded p-2">{action.detail}</pre>
                      )}
                      <p className="text-xs text-muted-foreground mt-1.5 italic">{action.impact}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={tracked ? "secondary" : "outline"}
                      className="h-7 text-xs shrink-0"
                      disabled={tracked}
                      onClick={() => promote(action)}
                    >
                      {tracked ? <><CheckCircle className="size-3.5 mr-1" /> Tracked</> : <><Plus className="size-3.5 mr-1" /> Track</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Separator />

      {/* Weekly Review Framework */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Weekly Review Framework</CardTitle>
          <CardDescription className="text-xs">Recommended review cadence for strategic decisions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[
              { day: "Monday", tasks: ["Review last week revenue vs target", "Check per-platform performance & discount rates", "Identify top & bottom margin items by channel"] },
              { day: "Wednesday", tasks: ["Review delivery times & driver performance", "Check Uber Eats / Deliveroo / JustEat ratings", "Adjust offers if discount rate > 8% on any channel"] },
              { day: "Friday", tasks: ["Update item costs in Google Sheet", "Review margin alerts by category", "Plan weekend promotions on highest-AOV channel"] },
            ].map((r) => (
              <div key={r.day} className="p-3 rounded-lg bg-secondary">
                <p className="text-xs font-semibold text-primary mb-2">{r.day}</p>
                <ul className="flex flex-col gap-1">
                  {r.tasks.map((t, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle className="size-3 text-[oklch(0.7_0.15_150)] mt-0.5 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
