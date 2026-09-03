"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

/**
 * "What Changed?" (spec §6 — an ADD on the Overview wireframe).
 *
 * Each row states a movement and the evidence behind it, e.g.
 *   Revenue down            Primary movement: Uber orders down.
 *   Direct channel growing  Wix share +X pts.
 *
 * These are stated observations derived from measured comparable-period movements —
 * not recommendations. §1 forbids adding AI recommendations that the spec did not ask
 * for, so this panel only reports what moved and by how much.
 */

export type ChangeRow = {
  headline: string
  evidence: string
  direction: "up" | "down" | "flat"
}

/** Build the change rows from measured movements. Returns [] when there is no baseline. */
export function buildChangeRows(input: {
  revenueChangePct: number | null
  ordersChangePct: number | null
  aovChangePct: number | null
  marginChangePts: number | null
  directPctChangePts: number | null
  /** Biggest single channel mover, if one stands out. */
  topChannelMover?: { label: string; changePct: number | null } | null
}): ChangeRow[] {
  const rows: ChangeRow[] = []
  const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v)

  const rev = n(input.revenueChangePct)
  if (rev !== null) {
    const mover = input.topChannelMover
    const moverText =
      mover && n(mover.changePct) !== null
        ? `Primary movement: ${mover.label} ${mover.changePct! >= 0 ? "up" : "down"} ${Math.abs(mover.changePct!).toFixed(1)}%.`
        : "No single channel dominates the movement."
    rows.push({
      headline: rev >= 0 ? "Revenue up" : "Revenue down",
      evidence: `${rev >= 0 ? "+" : ""}${rev.toFixed(1)}% vs comparable period. ${moverText}`,
      direction: rev > 0 ? "up" : rev < 0 ? "down" : "flat",
    })
  }

  const direct = n(input.directPctChangePts)
  if (direct !== null && Math.abs(direct) >= 0.5) {
    rows.push({
      headline: direct > 0 ? "Direct channel growing" : "Direct channel shrinking",
      evidence: `Direct share ${direct >= 0 ? "+" : ""}${direct.toFixed(1)} pts of revenue mix.`,
      direction: direct > 0 ? "up" : "down",
    })
  }

  const margin = n(input.marginChangePts)
  if (margin !== null && Math.abs(margin) >= 0.5) {
    rows.push({
      headline: margin >= 0 ? "Margin improved" : "Margin deteriorated",
      evidence: `Gross margin ${margin >= 0 ? "+" : ""}${margin.toFixed(1)} pts — investigate product/channel mix.`,
      direction: margin > 0 ? "up" : "down",
    })
  }

  const orders = n(input.ordersChangePct)
  const aov = n(input.aovChangePct)
  if (orders !== null && aov !== null && Math.abs(orders) >= 1) {
    // Separating volume from basket size is the first question anyone asks of a
    // revenue move, so state which one actually drove it.
    const driver = Math.abs(orders) >= Math.abs(aov) ? "order volume" : "average order value"
    rows.push({
      headline: `Driven by ${driver}`,
      evidence: `Orders ${orders >= 0 ? "+" : ""}${orders.toFixed(1)}%, AOV ${aov >= 0 ? "+" : ""}${aov.toFixed(1)}%.`,
      direction: orders > 0 ? "up" : "down",
    })
  }

  return rows
}

export function WhatChanged({
  rows, comparableLabel,
}: { rows: ChangeRow[]; comparableLabel?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">What Changed?</CardTitle>
        <CardDescription className="text-xs">
          {comparableLabel ?? "Movement against the comparable period"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No comparable baseline for this period yet — sync more history to see movement.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border/50">
            {rows.map((r) => {
              const Icon = r.direction === "up" ? TrendingUp : r.direction === "down" ? TrendingDown : Minus
              const color =
                r.direction === "up" ? "text-[oklch(0.7_0.15_150)]"
                : r.direction === "down" ? "text-destructive"
                : "text-muted-foreground"
              return (
                <div key={r.headline} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                  <Icon className={`size-4 mt-0.5 shrink-0 ${color}`} />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-foreground">{r.headline}</span>
                    <span className="text-[11px] text-muted-foreground">{r.evidence}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
