"use server"

import { db } from "@/lib/db"
import { sql } from "drizzle-orm"
import { offer } from "@/lib/db/schema"

/**
 * Offer setup records (spec §10) — owner-entered master data.
 *
 * The POS never says who funded a discount, so these records are the only source for
 * the Raja's / Platform funding split, and their start/end dates are what make a
 * comparable baseline (and therefore incrementality) computable at all.
 */

export async function listOffers() {
  const r = await db.execute(sql`
    SELECT id, "offerId", name, brand, store, channel,
           "startDate"::text AS "startDate", "endDate"::text AS "endDate",
           "offerType", "discountPercent", "minSpend",
           "rajasFundingPct", "platformFundingPct", "posCategories"
      FROM offer ORDER BY "startDate" DESC`)
  return r.rows
}

export async function createOffer(input: {
  offerId: string
  name: string
  channel?: string
  store?: string
  startDate: string
  endDate?: string
  discountPercent?: number
  rajasFundingPct?: number
  posCategories?: string
}) {
  try {
    if (!input.offerId?.trim()) return { success: false, error: "Offer ID is required" }
    if (!input.name?.trim()) return { success: false, error: "Offer name is required" }
    const rajas = input.rajasFundingPct ?? 100
    await db.insert(offer).values({
      offerId: input.offerId.trim(),
      name: input.name.trim(),
      store: input.store && input.store !== "all" ? input.store : null,
      channel: input.channel && input.channel !== "all" ? input.channel : null,
      startDate: input.startDate,
      endDate: input.endDate || null,
      discountPercent: input.discountPercent?.toString() ?? null,
      rajasFundingPct: rajas.toString(),
      // The two shares always account for the whole discount.
      platformFundingPct: (100 - rajas).toString(),
      posCategories: input.posCategories?.trim() || null,
    })
    return { success: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return { success: false, error: msg.includes("duplicate") ? "That Offer ID already exists" : msg }
  }
}

export async function deleteOffer(id: number) {
  try {
    await db.execute(sql`DELETE FROM offer WHERE id = ${id}`)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : "Unknown error" }
  }
}

/** POS categories carrying discounts — the candidates an offer record should map to. */
export async function getOfferCandidateCategories() {
  const r = await db.execute<{ cat: string; revenue: string; discount: string }>(sql`
    SELECT COALESCE("categoryName", 'Unknown') AS cat,
           ROUND(SUM(amount::numeric))::text   AS revenue,
           ROUND(SUM(discount::numeric))::text AS discount
      FROM order_items
     WHERE cancelled = false
       AND (upper("categoryName") LIKE '%OFFER%'
         OR upper("categoryName") LIKE '%BUY%'
         OR upper("categoryName") LIKE '%FREE%'
         OR discount::numeric > 0)
     GROUP BY 1
     ORDER BY SUM(discount::numeric) DESC NULLS LAST
     LIMIT 25`)
  return r.rows
}
