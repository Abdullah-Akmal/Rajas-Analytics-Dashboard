/**
 * Comparable-period rules (spec §6 and §11).
 *
 * The spec is emphatic on one point:
 *
 *   "Incomplete periods must only be compared with equivalent elapsed historical
 *    windows. This rule applies to Overview, trends, alerts and later Intelligence."
 *
 * and, in §14, requires a demonstration that "a partial trading day cannot generate a
 * false decline versus a completed day".
 *
 * So a period that is still running is never compared against a completed one. When
 * today is in range we compute how far into the trading day we are, and clamp the
 * historical window to the same elapsed point.
 *
 * Everything here is Europe/London — trade runs past midnight and across BST/GMT, so
 * a naive UTC cutoff would mis-bucket the boundary hours.
 */

const UK = "Europe/London"

const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: UK, year: "numeric", month: "2-digit", day: "2-digit",
})
const hmsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
})

/** UK-local calendar date (yyyy-MM-dd) for an instant. */
export function ukDate(d: Date = new Date()): string {
  return ymdFmt.format(d)
}

/** Seconds elapsed since UK-local midnight. */
export function ukSecondsIntoDay(d: Date = new Date()): number {
  const [h, m, s] = hmsFmt.format(d).split(":").map(Number)
  return h * 3600 + m * 60 + s
}

const DAY_MS = 86_400_000
const addDays = (iso: string, n: number) =>
  ymdFmt.format(new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS))

/** Inclusive day count between two yyyy-MM-dd dates. */
export function dayCount(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate}T12:00:00Z`)
  const b = Date.parse(`${endDate}T12:00:00Z`)
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1)
}

export type ComparablePeriod = {
  /** Start of the equivalent prior window (yyyy-MM-dd). */
  prevStart: string
  /** End of the equivalent prior window (yyyy-MM-dd). */
  prevEnd: string
  /** True when the CURRENT period includes a day that is still trading. */
  isPartial: boolean
  /**
   * Seconds into the final UK day that both windows are clamped to, or null when the
   * current period is complete and no clamp is needed.
   */
  cutoffSeconds: number | null
  /** Length of the window in days — the two windows always match. */
  days: number
}

/**
 * The window immediately preceding [startDate, endDate], of identical length.
 *
 * If endDate is today (UK), both windows are clamped to the same elapsed point in
 * their final day so a part-day is never compared against a whole one.
 */
export function comparablePeriod(
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): ComparablePeriod {
  const days = dayCount(startDate, endDate)
  const today = ukDate(now)
  // The period is partial when it runs to today or beyond — today is still trading.
  const isPartial = endDate >= today
  return {
    prevStart: addDays(startDate, -days),
    prevEnd: addDays(endDate, -days),
    isPartial,
    cutoffSeconds: isPartial ? ukSecondsIntoDay(now) : null,
    days,
  }
}

/** Percentage change, guarding division by zero. Null when there is no baseline. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Difference in percentage points — for comparing two rates (e.g. margin). */
export function ptsChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  return current - previous
}
