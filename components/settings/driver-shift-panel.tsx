"use client"

import { useEffect, useState } from "react"
import { getDriverShifts, addDriverShift, deleteDriverShift } from "@/lib/analytics/driver-cost"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import { format } from "date-fns"

type Shift = {
  id: number; store: string; driverName: string; shiftDate: string
  startTime: string; finishTime: string; hours: string; notes: string | null
}

/**
 * Driver Shift Log (spec §9).
 *
 * "Driver hours must come from an available shift/time source. If none exists, create a
 *  minimal Driver Shift Log: Driver, Start Time, Finish Time."
 *
 * Shipday supplies delivery count and distance but never hours, so this is the only
 * source for the hourly-allocation half of driver cost.
 */
export function DriverShiftPanel() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    store: "Hyde Park",
    driverName: "",
    shiftDate: format(new Date(), "yyyy-MM-dd"),
    startTime: "17:00",
    finishTime: "23:00",
    notes: "",
  })

  const load = async () => {
    setLoading(true)
    const r = await getDriverShifts()
    setShifts(r as unknown as Shift[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const submit = async () => {
    setSaving(true); setError("")
    const res = await addDriverShift(form)
    setSaving(false)
    if (!res.success) { setError(res.error ?? "Could not save"); return }
    setForm((f) => ({ ...f, driverName: "", notes: "" }))
    load()
  }

  const remove = async (id: number) => {
    await deleteDriverShift(id)
    load()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Log a shift</CardTitle>
          <CardDescription className="text-xs">
            Hyde Park direct deliveries only. Hours drive the hourly-allocation part of
            driver cost; the rates themselves live in Analytics Settings. A finish time
            earlier than the start is treated as running past midnight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Store</span>
              <Select value={form.store} onValueChange={(v) => setForm((f) => ({ ...f, store: v ?? "Hyde Park" }))}>
                <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hyde Park">Hyde Park</SelectItem>
                  <SelectItem value="Grand Arcade">Grand Arcade</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Driver</span>
              <Input
                className="h-8 text-xs w-40" placeholder="Driver name"
                value={form.driverName}
                onChange={(e) => setForm((f) => ({ ...f, driverName: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Date</span>
              <Input type="date" className="h-8 text-xs w-36"
                value={form.shiftDate}
                onChange={(e) => setForm((f) => ({ ...f, shiftDate: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Start</span>
              <Input type="time" className="h-8 text-xs w-28"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Finish</span>
              <Input type="time" className="h-8 text-xs w-28"
                value={form.finishTime}
                onChange={(e) => setForm((f) => ({ ...f, finishTime: e.target.value }))} />
            </div>
            <Button size="sm" className="h-8" onClick={submit} disabled={saving || !form.driverName.trim()}>
              <Plus className="size-3.5 mr-1" />{saving ? "Saving…" : "Add shift"}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Logged shifts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : shifts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No shifts logged yet. Until shifts exist, driver cost is £0 and Hyde Park&apos;s
              channel contribution is overstated.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Store</TableHead>
                  <TableHead className="text-xs">Driver</TableHead>
                  <TableHead className="text-xs text-right">Hours</TableHead>
                  <TableHead className="text-xs" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{s.shiftDate}</TableCell>
                    <TableCell className="text-xs">{s.store}</TableCell>
                    <TableCell className="text-xs font-medium">{s.driverName}</TableCell>
                    <TableCell className="text-xs text-right">{Number(s.hours).toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => remove(s.id)}>
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
