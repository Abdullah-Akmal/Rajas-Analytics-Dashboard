import { sql } from "drizzle-orm"
import { orders, orderItems } from "@/lib/db/schema"

/**
 * Shared filter (slicer) fragments for every analytics and operations query.
 *
 * These live outside the "use server" action files because a "use server" module
 * may only export async functions — sync helpers exported from one pass tsc and the
 * build but fail at runtime. Import from here rather than re-declaring them, so the
 * filters (and especially normKey) cannot drift between pages.
 */

// ─── Sales-channel bucket filter ─────────────────────────────────────────────
// Splits orders into three buckets by orderChannel (every order/line carries one):
//   • instore   → "wix"   (in-house EPOS: walk-in, dine-in, phone)
//   • website   → "eatpresto" (own online-ordering storefront)
//   • platforms → uber eats / deliveroo / just eat (third-party delivery apps)
// "all" (or undefined) applies no filter. Works for both query styles: pass a Drizzle
// column (orders.orderChannel) OR a raw sql expression (sql`oi."orderChannel"`).
export const SALES_CHANNEL_MAP: Record<string, string[]> = {
  instore: ["wix"],
  website: ["eatpresto"],
  platforms: ["ubereats", "deliveroo", "justeat"],
}

/** Third-party marketplaces: they own the customer and the courier. */
export const MARKETPLACE_CHANNELS = SALES_CHANNEL_MAP.platforms

export function channelCondition(channelCol: any, channel?: string | null) {
  if (!channel || channel === "all") return undefined
  const vals = SALES_CHANNEL_MAP[channel]
  if (!vals || vals.length === 0) return undefined
  return sql`LOWER(${channelCol}) IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`
}

// ─── Fulfilment-mode and order-platform filters ──────────────────────────────
// mode     — how the order is fulfilled: walk_in / collection / delivery / dine_in
// platform — where it was taken: "walk in" / phone / online (Presto also offers
//            kiosk + future table, but no such rows exist in this data yet)
// Both are compared case-insensitively with spaces normalised to underscores, so
// the stored "walk in" (platform) and "walk_in" (mode) both match a `walk_in` key.
export const slug = (col: any) => sql`LOWER(REPLACE(TRIM(${col}), ' ', '_'))`
export function modeCondition(modeCol: any, mode?: string | null) {
  if (!mode || mode === "all") return undefined
  return sql`${slug(modeCol)} = ${mode}`
}
export function platformCondition(platformCol: any, platform?: string | null) {
  if (!platform || platform === "all") return undefined
  return sql`${slug(platformCol)} = ${platform}`
}
// order_items has no platform column, so filter item lines by their parent order.
export function platformItemCondition(orderIdCol: any, platform?: string | null) {
  if (!platform || platform === "all") return undefined
  return sql`EXISTS (SELECT 1 FROM orders po WHERE po."orderId" = ${orderIdCol} AND ${slug(sql`po.platform`)} = ${platform})`
}

// ─── normKey — SQL mirror of lib/normalise normalizeRaw() ────────────────────
// lower + trim + whitespace-collapse + the (tiny) typo map. If you change one, change
// the other: LOWER(item_alias."normalizedRaw") = normKey(order_items."itemName") is
// the exact join every cost and Product Master lookup depends on.
//
// WHITESPACE MUST BE [[:space:]], NEVER \s. In this Postgres `\s` matches the LETTER
// "s"; that once broke the join for every product name containing an "s" (only 47% of
// revenue joined to a cost). The \m / \M word-boundary escapes do work.
export const normKey = (col: any) =>
  sql`regexp_replace(regexp_replace(regexp_replace(lower(btrim(${col})), '[[:space:]]+', ' ', 'g'), '\\msundays?\\M', 'sundae', 'g'), '\\mperi peri\\M', 'piri piri', 'g')`

// ─── Product Master slicers: brand / product type / category (spec §11) ──────
// These dimensions live on product_master, not on order_items, so they filter via an
// EXISTS on the alias→product-master chain. §11 is explicit that filters must change
// the underlying CALCULATION — "do not calculate all brands together and merely hide
// rows after calculation" — which is exactly what an EXISTS predicate does.
export type PmFilters = { brand?: string; productType?: string; category?: string }

function pmPreds(f?: PmFilters) {
  if (!f) return []
  const preds: any[] = []
  if (f.brand && f.brand !== "all") preds.push(sql`pm.brand = ${f.brand}`)
  if (f.productType && f.productType !== "all") preds.push(sql`pm."productType" = ${f.productType}`)
  if (f.category && f.category !== "all") preds.push(sql`pm.category = ${f.category}`)
  return preds
}

/** True when any product-master filter is active. */
export function pmActive(f?: PmFilters) {
  return pmPreds(f).length > 0
}

export function pmExists(itemNameCol: any, f?: PmFilters) {
  const preds = pmPreds(f)
  if (preds.length === 0) return undefined
  return sql`EXISTS (
    SELECT 1 FROM item_alias ia_f
      JOIN product_master pm ON pm.id = ia_f."productMasterId"
     WHERE lower(ia_f."normalizedRaw") = ${normKey(itemNameCol)}
       AND ${sql.join(preds, sql` AND `)})`
}

/**
 * Order-level form: the order contains at least one line of the selected brand /
 * type / category. Used where the unit is the ORDER (demand, retention), so a
 * Brand filter keeps the orders that brand actually took.
 */
export function orderPmExists(orderIdCol: any, f?: PmFilters) {
  const preds = pmPreds(f)
  if (preds.length === 0) return undefined
  return sql`EXISTS (
    SELECT 1 FROM order_items oi_f
      JOIN item_alias ia_f ON lower(ia_f."normalizedRaw") = ${normKey(sql`oi_f."itemName"`)}
      JOIN product_master pm ON pm.id = ia_f."productMasterId"
     WHERE oi_f."orderId" = ${orderIdCol}
       AND oi_f.amount::numeric > 0
       AND ${sql.join(preds, sql` AND `)})`
}

/** Product-master slicers for a Drizzle order_items query. */
export function pmSlicers(f?: PmFilters) {
  const c = pmExists(orderItems.itemName, f)
  return c ? [c] : []
}
/** Same, as a raw ` AND …` fragment for hand-written SQL. Pass the table alias. */
export function rawPmSlicers(alias: string, f?: PmFilters) {
  const c = pmExists(sql.raw(`${alias}."itemName"`), f)
  return c ? sql` AND ${c}` : sql``
}
/** Order-level product-master filter as a raw ` AND …` fragment. Pass the orders alias. */
export function rawOrderPmSlicers(alias: string, f?: PmFilters) {
  const c = orderPmExists(sql.raw(`${alias}."orderId"`), f)
  return c ? sql` AND ${c}` : sql``
}

/** Slicer conditions for an ORDERS-based query (Drizzle condition array style). */
export function orderSlicers(channel?: string, mode?: string, platform?: string) {
  const out: any[] = []
  const c = channelCondition(orders.orderChannel, channel); if (c) out.push(c)
  const m = modeCondition(orders.mode, mode); if (m) out.push(m)
  const p = platformCondition(orders.platform, platform); if (p) out.push(p)
  return out
}
/** Slicer conditions for an ORDER_ITEMS-based query (Drizzle condition array style). */
export function itemSlicers(channel?: string, mode?: string, platform?: string) {
  const out: any[] = []
  const c = channelCondition(orderItems.orderChannel, channel); if (c) out.push(c)
  const m = modeCondition(orderItems.mode, mode); if (m) out.push(m)
  const p = platformItemCondition(orderItems.orderId, platform); if (p) out.push(p)
  return out
}
/** Same slicers as a raw ` AND …` fragment, for hand-written SQL. Pass the table alias. */
export function rawItemSlicers(alias: string, channel?: string, mode?: string, platform?: string) {
  const parts = [
    channelCondition(sql.raw(`${alias}."orderChannel"`), channel),
    modeCondition(sql.raw(`${alias}.mode`), mode),
    platformItemCondition(sql.raw(`${alias}."orderId"`), platform),
  ].filter(Boolean)
  return parts.length ? sql` AND ${sql.join(parts as any[], sql` AND `)}` : sql``
}
export function rawOrderSlicers(alias: string, channel?: string, mode?: string, platform?: string) {
  const parts = [
    channelCondition(sql.raw(`${alias}."orderChannel"`), channel),
    modeCondition(sql.raw(`${alias}.mode`), mode),
    platformCondition(sql.raw(`${alias}.platform`), platform),
  ].filter(Boolean)
  return parts.length ? sql` AND ${sql.join(parts as any[], sql` AND `)}` : sql``
}
