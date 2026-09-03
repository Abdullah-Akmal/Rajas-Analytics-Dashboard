/**
 * Menu-engineering classification (spec §8).
 *
 * Pure functions only — no DB access — so the rules can be reasoned about and
 * exercised directly. The action in lib/analytics/item-performance.ts supplies the
 * measured inputs and the owner-editable thresholds.
 *
 * The spec's five statuses and their meaning:
 *
 *   STAR              proven/high demand + healthy economics   → Protect & Grow
 *   FIX               proven/high demand + economics below target → Repair Economics
 *   PROMOTE           healthy economics + lower-than-expected demand → Grow Demand
 *   REVIEW            low demand + weak economics              → Commercial decision
 *   INSUFFICIENT DATA below the minimum evidence threshold      → No classification yet
 */

export type PerformanceStatus =
  | "STAR" | "FIX" | "PROMOTE" | "REVIEW" | "INSUFFICIENT_DATA"

export const STATUS_LABEL: Record<PerformanceStatus, string> = {
  STAR: "Star",
  FIX: "Fix",
  PROMOTE: "Promote",
  REVIEW: "Review",
  INSUFFICIENT_DATA: "Insufficient Data",
}

export const STATUS_MEANING: Record<PerformanceStatus, string> = {
  STAR: "Protect & Grow",
  FIX: "Repair Economics",
  PROMOTE: "Grow Demand",
  REVIEW: "Commercial decision required",
  INSUFFICIENT_DATA: "Wait for evidence",
}

export type ClassificationInputs = {
  /** Orders containing this product. Drives the evidence test. */
  ordersWith: number
  /** Order Penetration % = ordersWith ÷ eligible orders × 100 (§8 primary measure). */
  penetrationPct: number
  /** Food cost as a fraction of revenue, e.g. 0.41. Null when cost is missing. */
  foodCostPct: number | null
}

export type ClassificationThresholds = {
  /** Penetration % at the configured percentile of the comparable set. */
  popularityCutoff: number
  /** Minimum orders before a product is classified at all (§5, default 20). */
  minQualifyingOrders: number
  /** Commercial target food cost %, e.g. 0.33 — NOT the menu median (§8). */
  targetFoodCostPct: number
  /** Band around target that still counts as healthy (§5 amber tolerance). */
  amberTolerancePct: number
}

/**
 * Classify one product.
 *
 * §4's missing-cost rule takes precedence over everything: an item with no reliable
 * cost cannot be judged on economics, so it is never classified — it must not be able
 * to become a high-margin recommendation.
 */
export function classify(
  input: ClassificationInputs,
  t: ClassificationThresholds,
): PerformanceStatus {
  const { ordersWith, penetrationPct, foodCostPct } = input

  // Not enough evidence, or no reliable cost → no classification (§4, §8).
  if (ordersWith < t.minQualifyingOrders) return "INSUFFICIENT_DATA"
  if (foodCostPct === null || !Number.isFinite(foodCostPct)) return "INSUFFICIENT_DATA"

  const highDemand = penetrationPct >= t.popularityCutoff
  // Healthy = at or below target food cost, allowing the amber tolerance band.
  const healthyEconomics = foodCostPct <= t.targetFoodCostPct + t.amberTolerancePct

  if (highDemand && healthyEconomics) return "STAR"
  if (highDemand && !healthyEconomics) return "FIX"
  if (!highDemand && healthyEconomics) return "PROMOTE"
  return "REVIEW"
}

/**
 * The penetration value at a given percentile of the comparable set (§8:
 * "at/above the 60th percentile within the relevant comparable category/product set").
 *
 * Uses nearest-rank, which is stable on the small sets a single menu produces.
 */
export function percentileCutoff(values: number[], percentile: number): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return 0
  const rank = Math.ceil((percentile / 100) * xs.length)
  return xs[Math.min(Math.max(rank, 1), xs.length) - 1]
}

/**
 * Theoretical GP gap for a FIX item (§8).
 *
 * "For FIX items, calculate current GP versus GP at target economics at the same
 *  volume. Label this theoretical/potential - never guaranteed profit."
 *
 * At target economics the same revenue would carry cost = revenue × targetFoodCostPct,
 * so the gap is the extra gross profit that would produce, holding volume constant.
 * Returns 0 when the item is already at or better than target.
 */
export function theoreticalGpGap(
  revenue: number,
  actualCost: number,
  targetFoodCostPct: number,
): number {
  if (!Number.isFinite(revenue) || revenue <= 0) return 0
  const targetCost = revenue * targetFoodCostPct
  const gap = actualCost - targetCost
  return gap > 0 ? gap : 0
}

/** Ranking weight so the priority list leads with the biggest commercial impact. */
export function priorityScore(status: PerformanceStatus, gpGap: number, revenue: number): number {
  switch (status) {
    case "FIX": return 1_000_000 + gpGap          // money actively leaking
    case "REVIEW": return 500_000 + revenue       // needs a decision
    case "PROMOTE": return 250_000 + revenue      // upside
    case "STAR": return 100_000 + revenue         // protect
    default: return 0
  }
}
