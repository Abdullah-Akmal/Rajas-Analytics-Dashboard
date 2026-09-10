"use server"

import { sql } from "drizzle-orm"
import { getSettingsLookup } from "@/lib/settings/actions"

/**
 * VAT treatment (Corrections Priority 1).
 *
 * The brief is explicit on two points:
 *
 *   "Do not create separate VAT logic independently on each Analytics page."
 *   "Use one method consistently across Item Profitability, Item Performance,
 *    Channel Performance and Offers."
 *
 * So every page resolves revenue through this one helper. Changing `revenue_basis`
 * in Settings changes all of them at once.
 *
 * WHY NET IS THE DEFAULT
 * Supplier costs are recorded excluding VAT. Comparing them against VAT-inclusive
 * revenue understates every food-cost percentage — a £3 net cost on a £12 gross sale
 * reads as 25% when the true figure against £10 net revenue is 30%. Net is the only
 * like-for-like basis.
 *
 * HOW NET IS CALCULATED
 * From the VAT actually recorded on each POS line (`vatAmount`), never by dividing by
 * an assumed rate. UK food service mixes standard-rated and zero-rated sales — hot
 * food eaten in is 20%, much cold takeaway food is 0% — so a flat divisor would
 * wrongly shrink zero-rated revenue. The configured `vat_rate` is a reference figure
 * used only where the POS supplied no VAT amount at all.
 */

export type RevenueBasis = "gross" | "net"

export type RevenueBasisConfig = {
  basis: RevenueBasis
  vatEnabled: boolean
  vatRate: number
  /** Short sentence for the UI so the reader knows which basis produced a figure. */
  label: string
}

export async function getRevenueBasis(): Promise<RevenueBasisConfig> {
  const setting = await getSettingsLookup()
  const vatEnabled = setting.bool("vat_enabled")
  const configured = setting.text("revenue_basis") === "gross" ? "gross" : "net"
  // With VAT switched off there is nothing to strip, so gross and net are the same
  // thing; reporting "net" would imply a deduction that never happened.
  const basis: RevenueBasis = vatEnabled ? configured : "gross"
  return {
    basis,
    vatEnabled,
    vatRate: setting("vat_rate"),
    label:
      basis === "net"
        ? "Profitability is calculated on net revenue, excluding VAT."
        : vatEnabled
          ? "Profitability is calculated on gross revenue, including VAT."
          : "VAT is disabled, so all revenue is treated as VAT-free.",
  }
}

/**
 * SQL for one order line's revenue under the configured basis.
 *
 * `amountCol` and `vatCol` are the order_items columns. Guarded so a malformed VAT
 * figure larger than the line total can never produce negative revenue.
 */
export async function revenueSql(cfg: RevenueBasisConfig, amountCol: unknown, vatCol: unknown) {
  if (cfg.basis === "gross") return sql`${amountCol}::numeric`
  return sql`GREATEST(${amountCol}::numeric - COALESCE(${vatCol}::numeric, 0), 0)`
}

/**
 * Same, written against a raw table alias for hand-built SQL.
 * Pass the alias only — never user input; this is interpolated, not parameterised.
 */
export async function revenueRawSql(cfg: RevenueBasisConfig, alias: string) {
  if (cfg.basis === "gross") return sql.raw(`${alias}.amount::numeric`)
  return sql.raw(`GREATEST(${alias}.amount::numeric - COALESCE(${alias}."vatAmount"::numeric, 0), 0)`)
}

/** Order-level equivalent, for queries that aggregate the `orders` table. */
export async function orderRevenueRawSql(cfg: RevenueBasisConfig, alias: string) {
  if (cfg.basis === "gross") return sql.raw(`${alias}."totalAmount"::numeric`)
  return sql.raw(`GREATEST(${alias}."totalAmount"::numeric - COALESCE(${alias}."vatAmount"::numeric, 0), 0)`)
}
