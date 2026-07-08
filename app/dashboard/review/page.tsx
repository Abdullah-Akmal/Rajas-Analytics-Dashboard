"use client"

import { useState, useEffect, useRef } from "react"
import { getReviewQueue, getAllCanonicals, confirmAlias, getCostingItemsWithAliasCounts, getUncostedItems } from "@/lib/normalise/actions"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle, XCircle, GitMerge, AlertTriangle, Search, List, ChevronsUpDown, PoundSterling } from "lucide-react"

type CanonicalOpt = { id: number; canonicalName: string; category: string | null }

// Searchable, larger dropdown for picking a canonical item from the full costing list.
function CanonicalCombobox({ value, options, onChange }: { value: string | null; options: CanonicalOpt[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  // Position the menu in viewport-fixed coordinates measured from the trigger, so
  // it can never be clipped by an ancestor's overflow or the viewport edge (the
  // old absolute + flip-upward heuristic clipped the search box off the top for
  // rows near the page edge). Pick whichever side has more room and cap the height.
  const computePosition = () => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const margin = 8
    const width = Math.max(rect.width, 320)
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow
    const maxHeight = Math.min(380, Math.max(180, openUp ? spaceAbove : spaceBelow))
    let left = rect.right - width // right-align to the trigger
    if (left < margin) left = margin
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    const style: React.CSSProperties = { position: "fixed", left, width, maxHeight }
    if (openUp) style.bottom = window.innerHeight - rect.top + 4
    else style.top = rect.bottom + 4
    setMenuStyle(style)
  }

  // Close on page scroll/resize — a fixed menu would otherwise detach from its
  // trigger. Capture-phase scroll also fires for the menu's OWN list scroll and
  // the autoFocus scroll-into-view, so ignore events originating inside the menu
  // (otherwise the menu closes the instant you try to interact with it).
  useEffect(() => {
    if (!open) return
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
  }, [open])

  const toggleOpen = () => {
    if (!open) computePosition()
    setOpen((o) => !o)
  }

  const selectedLabel = value === "NONE"
    ? "✗ No match / skip cost"
    : options.find((o) => String(o.id) === value)?.canonicalName ?? null
  const ql = q.toLowerCase()
  const filtered = ql
    ? options.filter((o) => o.canonicalName.toLowerCase().includes(ql) || (o.category ?? "").toLowerCase().includes(ql))
    : options

  const pick = (v: string) => { onChange(v); setOpen(false); setQ("") }

  return (
    <div className="relative w-full" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className="w-full h-9 text-xs text-left px-3 rounded-md border border-border bg-background flex items-center justify-between gap-2 hover:border-primary/50 transition-colors"
      >
        <span className={selectedLabel ? "truncate" : "text-muted-foreground truncate"}>{selectedLabel ?? "— select canonical item —"}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="z-50 rounded-md border border-border bg-popover shadow-xl flex flex-col overflow-hidden" style={menuStyle}>
          <div className="p-2 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or category…" className="h-9 text-xs pl-7" />
            </div>
          </div>
          <div className="overflow-y-auto py-1 min-h-0 flex-1">
            <button onClick={() => pick("NONE")} className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-secondary">
              ✗ No match / skip cost
            </button>
            {filtered.map((o) => (
              <button
                key={o.id}
                onClick={() => pick(String(o.id))}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-secondary flex items-center gap-1.5 ${value === String(o.id) ? "bg-secondary" : ""}`}
              >
                {value === String(o.id) && <CheckCircle className="size-3 text-primary shrink-0" />}
                <span className="flex-1 truncate">{o.canonicalName}</span>
                {o.category && <span className="text-muted-foreground text-[10px] shrink-0">[{o.category}]</span>}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground text-center">No items match “{q}”</p>}
          </div>
        </div>
      )}
    </div>
  )
}

type QueueRow = {
  id: number
  normalizedRaw: string
  canonicalId: number | null
  matchMethod: string | null
  confidence: string | null
  posCategoryName: string | null
  size: string | null
  variant: string | null
}

type Canonical = {
  id: number
  canonicalName: string
  category: string | null
}

type UncostedRow = {
  id: number
  normalizedRaw: string
  canonicalId: number | null
  revenue: number
  qty: number
  posCategoryName: string | null
  isModifier: boolean
  reviewed: boolean
  matchMethod: string | null
}

type CostingItem = {
  id: number
  canonicalName: string
  category: string | null
  itemType: string | null
  primaryCost: string | null
  cost8inch: string | null
  cost12inch: string | null
  cost16inch: string | null
  costSolo: string | null
  costMeal: string | null
  aliasCount: number
  matchedAliasCount: number
}

export default function ReviewPage() {
  const [queue, setQueue]           = useState<QueueRow[]>([])
  const [canonicals, setCanonicals] = useState<Canonical[]>([])
  const [allItems, setAllItems]     = useState<CostingItem[]>([])
  const [uncosted, setUncosted]     = useState<UncostedRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState<Record<number, boolean>>({})
  const [selections, setSelections] = useState<Record<number, string | null>>({})
  const [done, setDone]             = useState<Record<number, boolean>>({})
  const [activeTab, setActiveTab]   = useState<"queue" | "all" | "uncosted">("queue")
  const [search, setSearch]         = useState("")

  const refresh = async () => {
    setLoading(true)
    const [q, c, a, u] = await Promise.all([getReviewQueue(), getAllCanonicals(), getCostingItemsWithAliasCounts(), getUncostedItems()])
    setQueue(q as QueueRow[])
    setCanonicals(c as Canonical[])
    setAllItems(a as CostingItem[])
    setUncosted(u as UncostedRow[])
    const sel: Record<number, string> = {}
    for (const row of q) {
      if ((row as QueueRow).canonicalId) sel[(row as QueueRow).id] = String((row as QueueRow).canonicalId)
    }
    setSelections(sel)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const handleConfirm = async (row: { id: number }) => {
    const sel = selections[row.id]
    const canonicalId = sel === "NONE" || !sel ? null : parseInt(sel)
    setSaving((p) => ({ ...p, [row.id]: true }))
    await confirmAlias(row.id, canonicalId)
    setSaving((p) => ({ ...p, [row.id]: false }))
    setDone((p) => ({ ...p, [row.id]: true }))
  }

  const confidencePct = (c: string | null) =>
    c ? `${(parseFloat(c) * 100).toFixed(0)}%` : null

  const methodBadge = (m: string | null) => {
    if (!m) return null
    if (m === "unmatched" || m.startsWith("unmatched:"))
      return <Badge variant="destructive" className="text-[10px]">No match</Badge>
    if (m === "fuzzy")
      return <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Fuzzy</Badge>
    if (m === "manual")
      return <Badge variant="outline" className="text-[10px]">Manual</Badge>
    return <Badge variant="secondary" className="text-[10px]">{m}</Badge>
  }

  const fmtCost = (v: string | null) => v ? `£${parseFloat(v).toFixed(2)}` : null

  const pending = queue.filter((r) => !done[r.id])
  const uncostedPending = uncosted.filter((r) => !done[r.id])

  // Filter allItems by search
  const filteredItems = allItems.filter((item) => {
    const q = search.toLowerCase()
    return !q || item.canonicalName.toLowerCase().includes(q) || item.category?.toLowerCase().includes(q)
  })

  // Group by category for "all items" view
  const byCategory = filteredItems.reduce((acc: Record<string, CostingItem[]>, item) => {
    const cat = item.category || "Uncategorised"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Item Name Review</h1>
        <p className="text-sm text-muted-foreground">
          Review unmatched POS names, map uncosted items, or browse all {loading ? "…" : allItems.length} costing items to manually assign POS mappings.
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Pending Review", value: loading ? "…" : pending.length.toString() },
          { label: "Unmatched", value: loading ? "…" : pending.filter((r) => r.matchMethod === "unmatched" || r.matchMethod?.startsWith("unmatched:")).length.toString() },
          { label: "Fuzzy Matches", value: loading ? "…" : pending.filter((r) => r.matchMethod === "fuzzy").length.toString() },
          { label: "Resolved this session", value: Object.values(done).filter(Boolean).length.toString() },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 border-b border-border pb-0">
        <button
          onClick={() => setActiveTab("queue")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "queue"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <AlertTriangle className="size-3.5" />
          Review Queue
          {pending.length > 0 && (
            <Badge variant="destructive" className="text-[10px] ml-1 h-4 px-1">{pending.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("uncosted")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "uncosted"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <PoundSterling className="size-3.5" />
          Uncosted
          {uncostedPending.length > 0 && (
            <Badge variant="destructive" className="text-[10px] ml-1 h-4 px-1">{uncostedPending.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("all")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "all"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <List className="size-3.5" />
          All {loading ? "…" : allItems.length} Items
        </button>
      </div>

      {/* ── QUEUE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "queue" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <GitMerge className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Unresolved Aliases</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Unmatched rows appear first. Fuzzy rows have a suggested match — confirm if correct or reassign from the full costing list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : pending.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle className="size-8 text-[oklch(0.7_0.15_150)] mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">All clear — no items need review.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run "Normalise Item Names" from the Data Sync page after each Presto sync.
                </p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {pending.map((row) => {
                  const conf = confidencePct(row.confidence)
                  const isUnmatched = !row.canonicalId && row.matchMethod !== "fuzzy"
                  // Show cost breakdown for the currently suggested canonical match
                  const selectedId = selections[row.id]
                  const lookupId = selectedId && selectedId !== "NONE" ? parseInt(selectedId) : row.canonicalId
                  const matchedItem = lookupId ? allItems.find((a) => a.id === lookupId) : null
                  const matchedCostLabel = matchedItem ? (() => {
                    const itype = matchedItem.itemType?.trim()
                    if (itype === "pizza") return [
                      matchedItem.cost8inch  && `8"=${fmtCost(matchedItem.cost8inch)}`,
                      matchedItem.cost12inch && `12"=${fmtCost(matchedItem.cost12inch)}`,
                      matchedItem.cost16inch && `16"=${fmtCost(matchedItem.cost16inch)}`,
                    ].filter(Boolean).join(" · ")
                    if (itype === "solo_meal") return [
                      matchedItem.costSolo && `Solo=${fmtCost(matchedItem.costSolo)}`,
                      matchedItem.costMeal && `Meal=${fmtCost(matchedItem.costMeal)}`,
                    ].filter(Boolean).join(" · ")
                    return fmtCost(matchedItem.primaryCost)
                  })() : null
                  return (
                    <div key={row.id} className={`py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 ${done[row.id] ? "opacity-40" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-medium text-foreground truncate">
                            {row.normalizedRaw}
                          </span>
                          {row.size && <Badge variant="secondary" className="text-[10px]">{row.size}"</Badge>}
                          {row.variant && <Badge variant="secondary" className="text-[10px]">{row.variant}</Badge>}
                          {methodBadge(row.matchMethod)}
                          {conf && <span className="text-[10px] text-muted-foreground">{conf} confidence</span>}
                        </div>
                        {row.posCategoryName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">POS category: {row.posCategoryName}</p>
                        )}
                        {matchedCostLabel && (
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Cost: {matchedCostLabel}</p>
                        )}
                      </div>

                      <div className="w-full sm:w-96 shrink-0">
                        <CanonicalCombobox
                          value={selections[row.id] ?? (isUnmatched ? "NONE" : null)}
                          options={canonicals}
                          onChange={(v) => setSelections((p) => ({ ...p, [row.id]: v }))}
                        />
                      </div>

                      <Button
                        size="sm"
                        variant={isUnmatched && !selections[row.id] ? "outline" : "default"}
                        className="shrink-0 h-8 text-xs"
                        disabled={saving[row.id] || done[row.id]}
                        onClick={() => handleConfirm(row)}
                      >
                        {saving[row.id] ? (
                          <span className="animate-pulse">Saving…</span>
                        ) : done[row.id] ? (
                          <><CheckCircle className="size-3.5 mr-1" /> Done</>
                        ) : "Confirm"}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── UNCOSTED TAB ───────────────────────────────────────────────────── */}
      {activeTab === "uncosted" && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <PoundSterling className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Sold Items With No Cost</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Every POS item that has revenue but currently resolves to £0 cost — ordered by revenue. Pick the matching
              costing item to map it (drinks → "Soft Drinks", sides → "Naan"/"Spicy Rice", etc.), or leave it as "No match"
              if it's genuinely free. These include items the matcher tagged as modifiers, so they don't appear in the queue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : uncostedPending.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle className="size-8 text-[oklch(0.7_0.15_150)] mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">Every sold item has a cost.</p>
                <p className="text-xs text-muted-foreground mt-1">Nothing left to map here.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {uncostedPending.map((row) => {
                  const selectedId = selections[row.id]
                  const lookupId = selectedId && selectedId !== "NONE" ? parseInt(selectedId) : row.canonicalId
                  const matchedItem = lookupId ? allItems.find((a) => a.id === lookupId) : null
                  const matchedCostLabel = matchedItem ? (() => {
                    const itype = matchedItem.itemType?.trim()
                    if (itype === "pizza") return [
                      matchedItem.cost8inch  && `8"=${fmtCost(matchedItem.cost8inch)}`,
                      matchedItem.cost12inch && `12"=${fmtCost(matchedItem.cost12inch)}`,
                      matchedItem.cost16inch && `16"=${fmtCost(matchedItem.cost16inch)}`,
                    ].filter(Boolean).join(" · ")
                    if (itype === "solo_meal") return [
                      matchedItem.costSolo && `Solo=${fmtCost(matchedItem.costSolo)}`,
                      matchedItem.costMeal && `Meal=${fmtCost(matchedItem.costMeal)}`,
                    ].filter(Boolean).join(" · ")
                    return fmtCost(matchedItem.primaryCost)
                  })() : null
                  return (
                    <div key={row.id} className={`py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 ${done[row.id] ? "opacity-40" : ""}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-medium text-foreground truncate">{row.normalizedRaw}</span>
                          <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">£{row.revenue.toFixed(2)} uncosted</Badge>
                          <span className="text-[10px] text-muted-foreground">{row.qty} sold</span>
                          {row.isModifier && <Badge variant="secondary" className="text-[10px]">modifier</Badge>}
                        </div>
                        {row.posCategoryName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">POS category: {row.posCategoryName}</p>
                        )}
                        {matchedCostLabel && (
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">Cost: {matchedCostLabel}</p>
                        )}
                      </div>

                      <div className="w-full sm:w-96 shrink-0">
                        <CanonicalCombobox
                          value={selections[row.id] ?? null}
                          options={canonicals}
                          onChange={(v) => setSelections((p) => ({ ...p, [row.id]: v }))}
                        />
                      </div>

                      <Button
                        size="sm"
                        className="shrink-0 h-8 text-xs"
                        disabled={saving[row.id] || done[row.id] || !selections[row.id]}
                        onClick={() => handleConfirm(row)}
                      >
                        {saving[row.id] ? (
                          <span className="animate-pulse">Saving…</span>
                        ) : done[row.id] ? (
                          <><CheckCircle className="size-3.5 mr-1" /> Done</>
                        ) : "Confirm"}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── ALL ITEMS TAB ──────────────────────────────────────────────────── */}
      {activeTab === "all" && (
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-9 text-sm"
              placeholder="Search by item name or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            Object.entries(byCategory).map(([cat, items]) => (
              <Card key={cat}>
                <CardHeader className="pb-2 pt-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{cat}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">{items.length} items</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex flex-col divide-y divide-border">
                    {items.map((item) => {
                      const hasCost = item.primaryCost || item.cost8inch || item.cost12inch || item.cost16inch || item.costSolo || item.costMeal
                      const itype = item.itemType?.trim()
                      const costLabel = itype === "pizza"
                        ? [
                            item.cost8inch  && `8"=${fmtCost(item.cost8inch)}`,
                            item.cost12inch && `12"=${fmtCost(item.cost12inch)}`,
                            item.cost16inch && `16"=${fmtCost(item.cost16inch)}`,
                          ].filter(Boolean).join(" · ")
                        : itype === "solo_meal"
                        ? [
                            item.costSolo && `Solo=${fmtCost(item.costSolo)}`,
                            item.costMeal && `Meal=${fmtCost(item.costMeal)}`,
                          ].filter(Boolean).join(" · ")
                        : fmtCost(item.primaryCost)
                      return (
                        <div key={item.id} className="py-2.5 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-foreground">{item.canonicalName}</span>
                              {item.itemType && (
                                <Badge variant="secondary" className="text-[10px] capitalize">{item.itemType.replace("_", " ")}</Badge>
                              )}
                              {!hasCost && (
                                <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">No cost</Badge>
                              )}
                            </div>
                            {costLabel && <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{costLabel}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-right">
                            {Number(item.aliasCount) > 0 ? (
                              <div className="flex items-center gap-1">
                                <CheckCircle className="size-3 text-[oklch(0.7_0.15_150)]" />
                                <span className="text-[10px] text-muted-foreground">{Number(item.aliasCount)} POS name{Number(item.aliasCount) !== 1 ? "s" : ""}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <XCircle className="size-3 text-destructive/60" />
                                <span className="text-[10px] text-muted-foreground">No POS match</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Guidance */}
      <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-300 flex flex-col gap-1">
              <p className="font-semibold">How this works</p>
              <p><strong>Review Queue</strong> — POS names the algorithm couldn't match or matched with low confidence. Confirm or reassign once; they're remembered permanently in <code>item_alias</code>.</p>
              <p><strong>Uncosted</strong> — Every sold item that resolves to £0 cost (including ones tagged as modifiers). Map these to a costing item to pull their cost into the profit reports.</p>
              <p><strong>All Items</strong> — Browse every costing sheet item grouped by category. Items showing "No POS match" either haven't been ordered recently or need a manual alias. Use the Review Queue or Uncosted tab to create mappings.</p>
              <p className="mt-1">Selecting <strong>"No match / skip cost"</strong> marks the item as intentionally uncosted — it still appears in revenue but won't drag down profit calculations.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
