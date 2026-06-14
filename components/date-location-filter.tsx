"use client"

import { useState } from "react"
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
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"))
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [location, setLocation] = useState(defaultLocation)

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
    onFilterChange({ startDate: start, endDate: end, location })
  }

  const apply = () => onFilterChange({ startDate, endDate, location })

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
      <Select value={location} onValueChange={setLocation}>
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
