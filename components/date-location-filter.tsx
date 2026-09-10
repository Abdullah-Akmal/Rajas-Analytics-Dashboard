"use client"

import { useState, useEffect, useRef } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CalendarIcon } from "lucide-react"
import { format, subDays } from "date-fns"
import { getBrands, getProductTypes, getProductCategories } from "@/lib/product-master/actions"

/** Days the dashboard opens on when no range is in the URL or session. */
export const DEFAULT_RANGE_DAYS = 7

export interface DashboardFilters {
  startDate: string
  endDate: string
  location: string
  channel: string
  mode: string
  platform: string
  brand: string
  productType: string
  category: string
}

interface DateLocationFilterProps {
  onFilterChange: (filters: DashboardFilters) => void
  defaultLocation?: string
  defaultChannel?: string
  /** Hide the channel/mode/platform slicers on pages that are inherently single-channel
   *  (e.g. Delivery & Drivers, Customer Insights) where they'd be misleading. */
  showChannel?: boolean
}

// Small caption above each control so it's obvious what the dropdown is slicing by.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function DateLocationFilter({ onFilterChange, defaultLocation = "all", defaultChannel = "all", showChannel = true }: DateLocationFilterProps) {
  // Default to the last 7 days rather than today. Today's trading is always partial —
  // and if the overnight sync hasn't run, today has no rows at all, which made every
  // screen open empty and read as "the dashboard is broken". A week is the shortest
  // window that is always populated. Any other range is one click away.
  const [startDate, setStartDate] = useState(format(subDays(new Date(), DEFAULT_RANGE_DAYS), "yyyy-MM-dd"))
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [location, setLocation] = useState(defaultLocation)
  const [channel, setChannel] = useState(defaultChannel)
  const [mode, setMode] = useState("all")
  const [platform, setPlatform] = useState("all")
  // §11 dimensions sourced from the Product Master rather than hard-coded, so a new
  // brand or product type appears here as soon as it exists in the costing sheet.
  const [brand, setBrand] = useState("all")
  const [productType, setProductType] = useState("all")
  const [category, setCategory] = useState("all")
  const [brands, setBrands] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([getBrands(), getProductTypes(), getProductCategories()])
      .then(([b, t, c]) => {
        if (cancelled) return
        setBrands(b); setTypes(t); setCategories(c)
      })
      .catch(() => { /* filter falls back to "All" options */ })
    return () => { cancelled = true }
  }, [])

  // Persist the selected filters so every dashboard page compares like-for-like. Two layers:
  //  • sessionStorage — survives navigation between pages (sidebar links don't carry query params)
  //  • URL (?start&end&loc&ch&md&pf) — makes the view shareable/bookmarkable and survives refresh
  // On mount, hydrate from the URL first (a shared link wins), else sessionStorage, then push
  // the filters up so the page loads with them instead of defaulting to today.
  const STORAGE_KEY = "dashboardFilters"
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const p = new URLSearchParams(window.location.search)
    let s = p.get("start"), e = p.get("end"), l = p.get("loc"), c = p.get("ch"), m = p.get("md"), f = p.get("pf")
    if (!s && !e && !l && !c && !m && !f) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null")
        if (saved) { s = saved.startDate; e = saved.endDate; l = saved.location; c = saved.channel; m = saved.mode; f = saved.platform }
      } catch { /* ignore malformed storage */ }
    }
    if (s || e || l || c || m || f) {
      const ns = s || startDate, ne = e || endDate, nl = l || defaultLocation
      const nc = c || defaultChannel, nm = m || "all", nf = f || "all"
      setStartDate(ns)
      setEndDate(ne)
      setLocation(nl)
      setChannel(nc)
      setMode(nm)
      setPlatform(nf)
      persist(ns, ne, nl, nc, nm, nf)
      onFilterChange({ startDate: ns, endDate: ne, location: nl, channel: nc, mode: nm, platform: nf, brand: "all", productType: "all", category: "all" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (s: string, e: string, l: string, c: string, m: string, f: string,
                   b = brand, pt = productType, cat = category) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ startDate: s, endDate: e, location: l, channel: c, mode: m, platform: f, brand: b, productType: pt, category: cat })) } catch { /* ignore */ }
    const p = new URLSearchParams(window.location.search)
    p.set("start", s)
    p.set("end", e)
    p.set("loc", l)
    p.set("ch", c)
    p.set("md", m)
    p.set("pf", f)
    p.set("br", b)
    p.set("pt", pt)
    p.set("cat", cat)
    window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`)
  }

  const presets = [
    { label: "Today", days: 0 },
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ]

  const applyPreset = (days: number) => {
    const end = format(new Date(), "yyyy-MM-dd")
    const start = format(subDays(new Date(), days), "yyyy-MM-dd")
    setStartDate(start)
    setEndDate(end)
    persist(start, end, location, channel, mode, platform)
    onFilterChange({ startDate: start, endDate: end, location, channel, mode, platform, brand, productType, category })
  }

  const apply = () => {
    persist(startDate, endDate, location, channel, mode, platform)
    onFilterChange({ startDate, endDate, location, channel, mode, platform, brand, productType, category })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Quick range">
        <div className="flex items-center gap-1">
          {presets.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Date range">
        <div className="flex items-center gap-2">
          <CalendarIcon className="size-4 text-muted-foreground" />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 text-xs w-36"
          />
        </div>
      </Field>

      <Field label="Location">
        <Select value={location} onValueChange={(v) => setLocation(v ?? "all")}>
          <SelectTrigger className="h-8 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            <SelectItem value="Hyde Park">Hyde Park</SelectItem>
            <SelectItem value="Grand Arcade">Grand Arcade</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Brand">
        <Select value={brand} onValueChange={(v) => setBrand(v ?? "all")}>
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Brands</SelectItem>
            {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Product type">
        <Select value={productType} onValueChange={(v) => setProductType(v ?? "all")}>
          <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace(/_/g, " ").replace(/\w/g, (m) => m.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Category">
        <Select value={category} onValueChange={(v) => setCategory(v ?? "all")}>
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      {showChannel && (
        <>
          <Field label="Sales channel">
            <Select value={channel} onValueChange={(v) => setChannel(v ?? "all")}>
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="instore">In-store / Direct</SelectItem>
                <SelectItem value="website">Own Website</SelectItem>
                <SelectItem value="platforms">Delivery Platforms</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Fulfilment mode">
            <Select value={mode} onValueChange={(v) => setMode(v ?? "all")}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="walk_in">Walk In</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="dine_in">Dine In</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Order platform">
            <Select value={platform} onValueChange={(v) => setPlatform(v ?? "all")}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="walk_in">Walk In</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
                <SelectItem value="online">Online</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      <Button size="sm" className="h-8 text-xs" onClick={apply}>
        Apply
      </Button>
    </div>
  )
}
