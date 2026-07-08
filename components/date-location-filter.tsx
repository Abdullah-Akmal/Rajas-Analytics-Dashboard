"use client"

import { useState, useEffect, useRef } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CalendarIcon } from "lucide-react"
import { format, subDays } from "date-fns"

interface DateLocationFilterProps {
  onFilterChange: (filters: { startDate: string; endDate: string; location: string }) => void
  defaultLocation?: string
}

export function DateLocationFilter({ onFilterChange, defaultLocation = "all" }: DateLocationFilterProps) {
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [location, setLocation] = useState(defaultLocation)

  // Persist the selected range so every dashboard page compares like-for-like. Two layers:
  //  • sessionStorage — survives navigation between pages (sidebar links don't carry query params)
  //  • URL (?start&end&loc) — makes the current view shareable/bookmarkable and survives refresh
  // On mount, hydrate from the URL first (a shared link wins), else sessionStorage, then push
  // the range up so the page loads with the shared filter instead of defaulting to today.
  const STORAGE_KEY = "dashboardFilters"
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    const p = new URLSearchParams(window.location.search)
    let s = p.get("start"), e = p.get("end"), l = p.get("loc")
    if (!s && !e && !l) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null")
        if (saved) { s = saved.startDate; e = saved.endDate; l = saved.location }
      } catch { /* ignore malformed storage */ }
    }
    if (s || e || l) {
      const ns = s || startDate, ne = e || endDate, nl = l || defaultLocation
      setStartDate(ns)
      setEndDate(ne)
      setLocation(nl)
      persist(ns, ne, nl)
      onFilterChange({ startDate: ns, endDate: ne, location: nl })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (s: string, e: string, l: string) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ startDate: s, endDate: e, location: l })) } catch { /* ignore */ }
    const p = new URLSearchParams(window.location.search)
    p.set("start", s)
    p.set("end", e)
    p.set("loc", l)
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
    persist(start, end, location)
    onFilterChange({ startDate: start, endDate: end, location })
  }

  const apply = () => {
    persist(startDate, endDate, location)
    onFilterChange({ startDate, endDate, location })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
      <Button size="sm" className="h-8 text-xs" onClick={apply}>
        Apply
      </Button>
    </div>
  )
}
