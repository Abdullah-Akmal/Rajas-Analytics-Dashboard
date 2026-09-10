"use client"

import { useEffect, useRef, useState } from "react"
import { getRangeCoverage, fillRangeGaps } from "@/app/actions/dashboard"
import { Button } from "@/components/ui/button"
import { RefreshCw, AlertTriangle, CheckCircle } from "lucide-react"

/**
 * Keeps the DATA in step with the selected range.
 *
 * The daily cron keeps the last 7 days current, so the default view never needs this.
 * But reaching further back can land on days that were never synced — and on screen an
 * unsynced day looks exactly like a day with no trade, which is the worst possible
 * failure mode for a revenue dashboard.
 *
 * Small gaps are fetched automatically so the CEO doesn't have to think about it. Large
 * ones are offered as one click instead, because a wide backfill takes minutes and hits
 * a rate-limited Presto endpoint — worth a deliberate decision rather than a surprise.
 */
const AUTO_FILL_LIMIT = 14

export function RangeCoverageNotice({
  startDate, endDate, location, onFilled,
}: {
  startDate: string
  endDate: string
  location: string
  /** Called after a successful fetch so the page can re-read its data. */
  onFilled?: () => void
}) {
  const [missing, setMissing] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [justFilled, setJustFilled] = useState(0)
  const [checked, setChecked] = useState(false)
  // Ranges we've already auto-filled, so a re-render can't loop on the same gap.
  const attempted = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setChecked(false)
    setJustFilled(0)

    getRangeCoverage(startDate, endDate, location)
      .then(async (c) => {
        if (cancelled) return
        setMissing(c.missingDays)
        setChecked(true)

        const key = `${startDate}|${endDate}|${location}`
        const autoFillable = c.missingDays.length > 0 && c.missingDays.length <= AUTO_FILL_LIMIT
        if (!autoFillable || attempted.current.has(key)) return

        attempted.current.add(key)
        setBusy(true)
        const res = await fillRangeGaps(c.missingDays)
        if (cancelled) return
        setBusy(false)
        if (res.success || (res.orders ?? 0) > 0) {
          setJustFilled(res.synced)
          setMissing([])
          onFilled?.()
        }
      })
      .catch(() => { if (!cancelled) setChecked(true) })

    return () => { cancelled = true }
    // onFilled is intentionally excluded — callers pass an inline closure, and including
    // it would re-run the check (and the fetch) on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, location])

  const manualFill = async () => {
    setBusy(true)
    const res = await fillRangeGaps(missing)
    setBusy(false)
    if (res.success || (res.orders ?? 0) > 0) {
      setJustFilled(res.synced)
      setMissing([])
      onFilled?.()
    }
  }

  if (busy) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <RefreshCw className="size-3.5 animate-spin" />
        Fetching missing days for this range…
      </p>
    )
  }

  if (justFilled > 0) {
    return (
      <p className="text-xs text-success flex items-center gap-2">
        <CheckCircle className="size-3.5" />
        Fetched {justFilled} missing {justFilled === 1 ? "day" : "days"} for this range.
      </p>
    )
  }

  if (!checked || missing.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-warning">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span>
        {missing.length} {missing.length === 1 ? "day" : "days"} in this range
        {" "}({missing[0]}{missing.length > 1 ? ` → ${missing[missing.length - 1]}` : ""})
        {" "}have never been synced — those days currently read as zero.
      </span>
      <Button size="sm" variant="outline" className="h-6 text-sm" onClick={manualFill}>
        <RefreshCw className="size-3 mr-1" />
        Fetch {missing.length > 31 ? "first 31 days" : "them now"}
      </Button>
      {missing.length > 31 && (
        <span className="text-muted-foreground">
          Capped at 31 days per fetch to stay within Presto&apos;s rate limit.
        </span>
      )}
    </div>
  )
}
