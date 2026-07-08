/**
 * Coverage report — run against items_2026_05.csv (or any Presto item CSV).
 *
 * Usage:
 *   npx tsx scripts/coverage-report.ts [path/to/items_2026_05.csv]
 *
 * Expected CSV columns (Presto export):
 *   itemName, categoryName, amount, qty
 *   (extra columns are ignored)
 *
 * The script does NOT touch the database — it runs purely in-memory so you
 * can evaluate coverage before committing to the live pipeline.
 */

import fs from "fs"
import path from "path"
import Papa from "papaparse"
import * as dotenv from "dotenv"

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") })

// ── imports from the normalisation layer ────────────────────────────────────
import {
  normalizeRaw,
  isModifierCategory,
  isDealCategory,
  isPizzaCategory,
  decodePizza,
  matchNonPizza,
  detectVariant,
} from "../lib/normalise/index"

// ── Pull costing data live from the Google Sheet ─────────────────────────────
async function fetchCanonicals() {
  const { google } = await import("googleapis")
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  })
  const sheets = google.sheets({ version: "v4", auth })
  const spreadsheetId =
    process.env.GOOGLE_SHEET_ID || "1mWyvmYnTz7Ewe2vzAkS_st1Ti9aLxPO-WW8IV8LCUP8"

  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const names = meta.data.sheets?.map((s) => s.properties?.title).filter(Boolean) || []
  const tab =
    names.find(
      (n) => n?.toLowerCase().includes("costing") || n?.toLowerCase().includes("item")
    ) || names[0]

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:AH220`,
  })

  const rows: string[][] = (res.data.values || []) as string[][]
  const parseNum = (v: string | undefined): number | null => {
    if (!v) return null
    const n = parseFloat(v.replace(/[£$€,\s]/g, ""))
    return isNaN(n) || n < 0 ? null : n
  }

  type SectionType = "pizza" | "solo_meal" | "simple"
  const detectSection = (row: string[]): SectionType | null => {
    const c = row.map((x) => x?.toLowerCase().trim())
    if (c.some((x) => x.includes("8inch") || x.includes("12inch") || x.includes('8"') || x.includes('12"'))) return "pizza"
    if (c.some((x) => x === "solo cost" || x === "meal cost")) return "solo_meal"
    if ((c[1]?.includes("name") || c[1] === "name ") && (c[3] || "").includes("cost")) return "simple"
    return null
  }

  type CanonicalItem = {
    name: string
    category: string | null
    itemType: SectionType
    primaryCost: number | null
    cost8: number | null
    cost12: number | null
  }

  const items: CanonicalItem[] = []
  let cat: string | null = null
  let section: SectionType | null = null

  for (const row of rows) {
    if (!row || row.length === 0) continue
    const colA = row[0]?.trim()
    const colB = row[1]?.trim()

    if ((!colB || colB === "") && colA && isNaN(Number(colA)) && !colA.startsWith("£") && colA !== "Product No.") {
      cat = colA
      section = null
      continue
    }
    if (colA?.toLowerCase().includes("product") || colA?.toLowerCase() === "product no.") {
      const s = detectSection(row)
      if (s) section = s
      continue
    }
    if (isNaN(parseFloat(colA)) && !colA?.startsWith("£")) continue
    if (!colB || colB === "-") continue
    if (!isNaN(Number(colB)) || colB.startsWith("£")) continue

    const name = colB.trim()
    let primary: number | null = null
    let cost8: number | null = null
    let cost12: number | null = null

    if (section === "pizza") {
      cost8   = parseNum(row[3])
      cost12  = parseNum(row[4])
      primary = cost12 ?? cost8
    } else if (section === "solo_meal") {
      primary = parseNum(row[3])
    } else {
      primary = parseNum(row[3])
    }
    items.push({ name, category: cat, itemType: section || "simple", primaryCost: primary, cost8, cost12 })
  }
  return items
}

// ── Main ──────────────────────────────────────────────────────────────────────

const MANUAL_OVERRIDES: Record<string, string> = {
  "12inch M": "12inch Mushroom Pizza",
}

async function main() {
  const csvPath = process.argv[2] || "items_2026_05.csv"
  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌  CSV not found: ${csvPath}`)
    console.error("    Drop items_2026_05.csv in the project root and re-run.\n")
    process.exit(1)
  }

  console.log("📡  Fetching canonical names from Google Sheet…")
  const canonicals = await fetchCanonicals()
  console.log(`    Found ${canonicals.length} canonical items\n`)

  const allNames    = canonicals.map((c) => c.name)
  const pizzaNames  = canonicals.filter((c) => c.itemType === "pizza").map((c) => c.name)
  const nonPizzaNames = canonicals.filter((c) => c.itemType !== "pizza").map((c) => c.name)

  const raw = fs.readFileSync(csvPath, "utf-8")
  const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true })
  const rows = parsed.data

  console.log(`📄  CSV rows: ${rows.length.toLocaleString()}`)

  // Collect distinct (itemName, categoryName, amount) combos
  type RawKey = { itemName: string; categoryName: string; amount: number; rowCount: number }
  const distinct = new Map<string, RawKey>()
  for (const row of rows) {
    const name = (row.itemName ?? row["Item Name"] ?? "").trim()
    const cat  = (row.categoryName ?? row["Category Name"] ?? "").trim()
    const amt  = parseFloat(row.amount ?? row["Amount"] ?? "0") || 0
    const key  = `${name}|||${cat}`
    const existing = distinct.get(key)
    if (existing) { existing.rowCount++; existing.amount += amt }
    else distinct.set(key, { itemName: name, categoryName: cat, amount: amt, rowCount: 1 })
  }
  console.log(`    Distinct (name × category) combos: ${distinct.size}`)

  // Run normalisation pipeline on each distinct combo
  type Result = {
    raw: string
    category: string
    classification: string
    matchMethod: string
    canonicalName: string | null
    confidence: number | null
    size: string | null
    rowCount: number
    revenue: number
  }

  const results: Result[] = []
  const reviewQueue: Result[] = []
  const uncostedFlags: Result[] = []

  let totalLines = 0, modifierLines = 0, dealLines = 0, matchedLines = 0, reviewLines = 0, zeroAmtLines = 0

  for (const [, entry] of distinct) {
    const { itemName, categoryName, amount, rowCount } = entry
    if (!itemName) continue
    totalLines++

    const normalized = normalizeRaw(itemName)
    const isZeroAmt = amount <= 0

    // ── classify ──────────────────────────────────────────────────────────
    if (isModifierCategory(categoryName)) {
      modifierLines++
      if (isZeroAmt) zeroAmtLines++
      results.push({ raw: itemName, category: categoryName, classification: "modifier", matchMethod: "modifier", canonicalName: null, confidence: null, size: null, rowCount, revenue: amount })
      continue
    }

    if (isDealCategory(categoryName)) { dealLines++ }

    // ── manual override ────────────────────────────────────────────────────
    const override = MANUAL_OVERRIDES[normalized.trim()]
    if (override) {
      matchedLines++
      results.push({ raw: itemName, category: categoryName, classification: "item", matchMethod: "manual", canonicalName: override, confidence: 1, size: null, rowCount, revenue: amount })
      continue
    }

    // ── pizza ──────────────────────────────────────────────────────────────
    if (isPizzaCategory(categoryName)) {
      const r = decodePizza(normalized, pizzaNames)
      if (r.matched) {
        matchedLines++
        const cost = canonicals.find((c) => c.name === r.canonicalName)?.primaryCost
        const res: Result = { raw: itemName, category: categoryName, classification: "pizza", matchMethod: r.method, canonicalName: r.canonicalName, confidence: r.confidence, size: r.size, rowCount, revenue: amount }
        results.push(res)
        if (cost == null) uncostedFlags.push(res)
      } else {
        reviewLines++
        const res: Result = { raw: itemName, category: categoryName, classification: "pizza", matchMethod: `unmatched:${r.reason}`, canonicalName: null, confidence: null, size: null, rowCount, revenue: amount }
        results.push(res)
        reviewQueue.push(res)
      }
      continue
    }

    // ── general ───────────────────────────────────────────────────────────
    const r = matchNonPizza(normalized, allNames)
    if (r.matched) {
      const needsReview = r.confidence < 1
      needsReview ? reviewLines++ : matchedLines++
      const cost = canonicals.find((c) => c.name === r.canonicalName)?.primaryCost
      const res: Result = { raw: itemName, category: categoryName, classification: "item", matchMethod: r.method, canonicalName: r.canonicalName, confidence: r.confidence, size: null, rowCount, revenue: amount }
      results.push(res)
      if (needsReview) reviewQueue.push(res)
      if (cost == null) uncostedFlags.push(res)
    } else {
      reviewLines++
      const res: Result = { raw: itemName, category: categoryName, classification: "item", matchMethod: "unmatched", canonicalName: null, confidence: null, size: null, rowCount, revenue: amount }
      results.push(res)
      reviewQueue.push(res)
    }
  }

  const sellable = totalLines - modifierLines
  const matchedPct = sellable > 0 ? ((matchedLines / sellable) * 100).toFixed(1) : "0.0"
  const reviewPct  = sellable > 0 ? ((reviewLines  / sellable) * 100).toFixed(1) : "0.0"

  console.log("\n════════════════════════════════════════════════════════")
  console.log("  COVERAGE REPORT")
  console.log("════════════════════════════════════════════════════════")
  console.log(`  Distinct (name×cat) combos : ${totalLines}`)
  console.log(`  Modifier / component lines : ${modifierLines}  (auto-classified, skipped)`)
  console.log(`  Deal wrapper lines         : ${dealLines}`)
  console.log(`  Sellable item combos       : ${sellable}`)
  console.log(`  ✅ Matched (deterministic) : ${matchedLines}  (${matchedPct}%)`)
  console.log(`  ⚠️  Review queue           : ${reviewLines}  (${reviewPct}%)`)
  console.log(`  🚩 Matched but uncosted    : ${uncostedFlags.length}`)
  console.log("════════════════════════════════════════════════════════\n")

  // ── Review queue ──────────────────────────────────────────────────────────
  if (reviewQueue.length > 0) {
    console.log("⚠️  REVIEW QUEUE (confirm once → learned forever)\n")
    const sorted = [...reviewQueue].sort((a, b) => b.revenue - a.revenue)
    for (const r of sorted) {
      const rev = r.revenue > 0 ? `  £${r.revenue.toFixed(2)}` : "  £0"
      const method = r.canonicalName
        ? `  → "${r.canonicalName}" (${r.matchMethod}, ${((r.confidence ?? 0) * 100).toFixed(0)}%)`
        : `  → NO MATCH (${r.matchMethod})`
      console.log(`  "${r.raw}"  [${r.category}]${rev}${method}`)
    }
  }

  // ── Uncosted flags ────────────────────────────────────────────────────────
  if (uncostedFlags.length > 0) {
    console.log("\n🚩 MATCHED BUT NO COST DATA (no cost entry in sheet)\n")
    for (const r of uncostedFlags) {
      console.log(`  "${r.raw}" → "${r.canonicalName}"  [${r.category}]`)
    }
  }

  console.log("\nDone.\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
