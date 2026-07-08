/**
 * One-shot CLI runner — syncs the costing sheet then normalises all order_items.
 * Usage: npx tsx scripts/run-normalise.ts
 */
import * as dotenv from "dotenv"
import path from "path"
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

// Server actions can be called from Node directly as long as we don't need
// the Next.js request context (these only use DB + Google Sheets).
import { syncCostingSheet, normaliseOrderItems } from "../lib/normalise/actions"

async function main() {
  console.log("Step 1 — sync costing sheet → dim_costing_item…")
  const sheetResult = await syncCostingSheet()
  if (!sheetResult.success) {
    console.error("❌  Sheet sync failed:", sheetResult.error)
    process.exit(1)
  }
  console.log(`✅  ${sheetResult.count} canonical items upserted\n`)

  console.log("Step 2 — normalise order_items → item_alias…")
  const normResult = await normaliseOrderItems()
  if (!normResult.success) {
    console.error("❌  Normalisation failed:", normResult.error)
    process.exit(1)
  }

  const { total, matched, modifier, inReview } = normResult
  const sellable = (total ?? 0) - (modifier ?? 0)
  const pct = sellable > 0 ? ((matched! / sellable) * 100).toFixed(1) : "0.0"

  console.log(`\n══════════════════════════════════════════`)
  console.log(`  NORMALISATION RESULT`)
  console.log(`══════════════════════════════════════════`)
  console.log(`  Distinct POS names processed : ${total}`)
  console.log(`  Modifiers (auto-classified)  : ${modifier}`)
  console.log(`  Sellable items               : ${sellable}`)
  console.log(`  ✅ Matched                   : ${matched}  (${pct}%)`)
  console.log(`  ⚠️  In review queue          : ${inReview}`)
  console.log(`══════════════════════════════════════════\n`)
  console.log(`Open /dashboard/review to confirm the review queue.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
