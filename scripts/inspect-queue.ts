import * as dotenv from "dotenv"
import path from "path"
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })
import { db } from "../lib/db/index"
import { sql } from "drizzle-orm"

async function check() {
  const cats = await db.execute<{ categoryName: string; cnt: string }>(
    sql`SELECT "categoryName", COUNT(*) as cnt FROM order_items GROUP BY "categoryName" ORDER BY COUNT(*) DESC LIMIT 25`
  )
  console.log("\nTop categoryNames in order_items:")
  for (const r of cats.rows) console.log(`  ${String(r.cnt).padStart(6)}  ${r.categoryName}`)

  const unmatched = await db.execute<{ matchMethod: string; posCategoryName: string; normalizedRaw: string }>(
    sql`SELECT "normalizedRaw", "posCategoryName"
        FROM item_alias
        WHERE "matchMethod" = 'unmatched'
        ORDER BY "posCategoryName" NULLS LAST, "normalizedRaw" NULLS LAST`
  )
  console.log(`\nAll ${unmatched.rows.length} UNMATCHED items:`)
  for (const r of unmatched.rows) {
    console.log(`  [${r.posCategoryName ?? "null"}]  "${r.normalizedRaw}"`)
  }

  const totals = await db.execute<{ matchMethod: string; cnt: string }>(
    sql`SELECT "matchMethod", COUNT(*) as cnt FROM item_alias GROUP BY "matchMethod" ORDER BY COUNT(*) DESC`
  )
  console.log("\nitem_alias breakdown by matchMethod:")
  for (const r of totals.rows) console.log(`  ${String(r.cnt).padStart(6)}  ${r.matchMethod}`)
}

check().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
