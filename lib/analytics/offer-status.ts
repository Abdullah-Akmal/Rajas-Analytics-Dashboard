/**
 * Offer status vocabulary (spec §10: Scale, Keep, Modify, Stop, Insufficient Data).
 *
 * Kept out of offers.ts because a "use server" module may export ONLY async functions.
 * A non-async export there passes `tsc` and even `next build`, then fails at runtime
 * with "A 'use server' file can only export async functions" — so constants and types
 * shared with client components live here instead.
 */

export type OfferStatus = "SCALE" | "KEEP" | "MODIFY" | "STOP" | "INSUFFICIENT_DATA"

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  SCALE: "Scale",
  KEEP: "Keep",
  MODIFY: "Modify",
  STOP: "Stop",
  INSUFFICIENT_DATA: "Insufficient Data",
}
