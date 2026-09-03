/**
 * The catalog of owner-editable settings (spec §5).
 *
 * The DB only stores values that have actually been overridden — this file is the
 * source of truth for which settings exist, what they mean, and what they fall back
 * to. Adding a setting is a code change here, not a migration.
 *
 * Scope:
 *   perStore   — one value per store ("Hyde Park" / "Grand Arcade")
 *   perChannel — one value per store × delivery platform
 *   global     — a single value
 */

export type SettingGroup =
  | "Commercial"
  | "Menu Intelligence"
  | "Channel"
  | "Hyde Park Drivers"
  | "Offers"

export type SettingUnit = "percent" | "currency" | "number" | "days" | "miles"

export type SettingDef = {
  key: string
  label: string
  group: SettingGroup
  unit: SettingUnit
  scope: "global" | "perStore" | "perChannel"
  default: number
  help?: string
  /** Where the seeded value comes from, when the pricing sheet supplies one. */
  seedFrom?: "instoreTargetFcPct" | "platformTargetFcPct" | "platformCommissionPct" | "mealUplift" | "amberTolerancePct"
}

export const STORES = ["Hyde Park", "Grand Arcade"] as const
export const CHANNELS = ["ubereats", "deliveroo", "justeat"] as const
export const CHANNEL_LABELS: Record<string, string> = {
  ubereats: "Uber Eats",
  deliveroo: "Deliveroo",
  justeat: "Just Eat",
}

export const SETTINGS: SettingDef[] = [
  // ── Commercial ────────────────────────────────────────────────────────────
  {
    key: "target_food_cost_pct", label: "Target food cost %", group: "Commercial",
    unit: "percent", scope: "perStore", default: 0.33, seedFrom: "instoreTargetFcPct",
    help: "Instore target. Item margin is judged against this, not the menu median (§8).",
  },
  {
    key: "platform_target_food_cost_pct", label: "Platform target food cost %", group: "Commercial",
    unit: "percent", scope: "perStore", default: 0.38, seedFrom: "platformTargetFcPct",
    help: "Higher than instore to absorb platform commission.",
  },
  {
    key: "amber_tolerance_pct", label: "Amber tolerance %", group: "Commercial",
    unit: "percent", scope: "perStore", default: 0.03, seedFrom: "amberTolerancePct",
    help: "Within this band of target counts as Near Target rather than Above Target.",
  },
  {
    key: "meal_uplift", label: "Meal uplift", group: "Commercial",
    unit: "currency", scope: "perStore", default: 2.25, seedFrom: "mealUplift",
    help: "Price added when a solo item is upgraded to a meal.",
  },

  // ── Menu Intelligence (§8) ────────────────────────────────────────────────
  {
    key: "popularity_percentile", label: "Popularity percentile", group: "Menu Intelligence",
    unit: "number", scope: "global", default: 60,
    help: "Order-penetration percentile at or above which a product counts as high demand.",
  },
  {
    key: "min_qualifying_orders", label: "Minimum qualifying orders", group: "Menu Intelligence",
    unit: "number", scope: "global", default: 20,
    help: "Below this a product is INSUFFICIENT DATA and is not classified.",
  },
  {
    key: "trend_threshold_pct", label: "Trend threshold %", group: "Menu Intelligence",
    unit: "percent", scope: "global", default: 0.15,
    help: "Period-on-period movement past this counts as a real trend, not noise.",
  },

  // ── Channel (§9) ──────────────────────────────────────────────────────────
  {
    key: "commission_pct", label: "Commission %", group: "Channel",
    unit: "percent", scope: "perChannel", default: 0.30, seedFrom: "platformCommissionPct",
    help: "Deducted from revenue when calculating channel contribution.",
  },

  // ── Hyde Park drivers (§9) — entered manually, no upstream source ─────────
  {
    key: "driver_hourly_rate", label: "Driver hourly rate", group: "Hyde Park Drivers",
    unit: "currency", scope: "global", default: 7.0,
    help: "Allocated across completed deliveries in the shift.",
  },
  {
    key: "driver_base_per_delivery", label: "Base £ per delivery", group: "Hyde Park Drivers",
    unit: "currency", scope: "global", default: 1.5,
  },
  {
    key: "driver_included_miles", label: "Included mileage", group: "Hyde Park Drivers",
    unit: "miles", scope: "global", default: 3.0,
    help: "Miles covered by the base rate before extra mileage applies.",
  },
  {
    key: "driver_extra_per_mile", label: "Extra £ per mile", group: "Hyde Park Drivers",
    unit: "currency", scope: "global", default: 1.0,
  },

  // ── Offers (§10) ──────────────────────────────────────────────────────────
  {
    key: "offer_max_discount_pct", label: "Max acceptable discount %", group: "Offers",
    unit: "percent", scope: "global", default: 0.25,
  },
  {
    key: "offer_min_contribution", label: "Min contribution per order", group: "Offers",
    unit: "currency", scope: "global", default: 3.0,
  },
  {
    key: "offer_min_sample", label: "Minimum sample (orders)", group: "Offers",
    unit: "number", scope: "global", default: 30,
    help: "Below this an offer is Insufficient Data rather than Scale/Keep/Stop.",
  },
  {
    key: "offer_baseline_days", label: "Baseline period (days)", group: "Offers",
    unit: "days", scope: "global", default: 28,
    help: "Comparable window before the offer used to estimate incrementality.",
  },
]

export const SETTING_GROUPS: SettingGroup[] = [
  "Commercial", "Menu Intelligence", "Channel", "Hyde Park Drivers", "Offers",
]

export const byKey = (k: string) => SETTINGS.find((s) => s.key === k)

/** Composite identity of one setting value. */
export function scopeId(key: string, store?: string | null, channel?: string | null) {
  return `${key}::${store ?? ""}::${channel ?? ""}`
}

/** Percent settings are stored as decimals (0.33) but edited as 33. */
export function toDisplay(def: SettingDef, raw: number): number {
  return def.unit === "percent" ? Math.round(raw * 1000) / 10 : raw
}
export function fromDisplay(def: SettingDef, shown: number): number {
  return def.unit === "percent" ? shown / 100 : shown
}
export function unitSuffix(def: SettingDef): string {
  switch (def.unit) {
    case "percent": return "%"
    case "currency": return "£"
    case "miles": return "mi"
    case "days": return "days"
    default: return ""
  }
}
