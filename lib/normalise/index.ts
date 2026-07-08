/**
 * Item-name normalisation layer.
 *
 * Pipeline:
 *   POS itemName → trim → classify (modifier / item / deal) → match canonical
 *               → attach cost or flag for review
 *
 * Exported entry-points:
 *   syncCostingSheet()   — pull Google Sheet → dim_costing_item
 *   normaliseOrderItems()— scan order_items → populate item_alias
 *   getReviewQueue()     — unresolved aliases (confidence < 1 or unmatched)
 *   confirmAlias()       — human marks a mapping as correct
 */

// ─── Modifier category names (POS categoryName values) ──────────────────────
// Matched case-insensitively after trimming — covers trailing-space variants.
const MODIFIER_CATEGORY_PATTERNS: RegExp[] = [
  /^size[s]?$/i,
  /^crust[s]?$/i,
  /^flavou?rs?$/i,
  /^remove ingredients?$/i,
  /^add ingredients?$/i,
  /^dips?(\s*&\s*sauces?)?$/i,
  /^extras?$/i,
  /^extras?\s*(&\s*add-ons?)?$/i,
  // "Main" in Presto = the entree slot inside a combo deal (not a standalone item)
  /^main[s]?$/i,
  // Fee / hidden lines
  /^online\s*hidden$/i,
  /^hidden\s*food$/i,
  /^add\s*price$/i,
  // Combo sub-slots (protein/base selection)
  /^base[s]?$/i,
  /^chicken$/i,
  /^donner$/i,
]

// ─── Deal / wrapper category names ──────────────────────────────────────────
const DEAL_CATEGORY_PATTERNS: RegExp[] = [
  /^box\s*meals?\s*(&\s*deals?)?$/i,
  /^meal\s*deals?$/i,
  /^combo\s*box(es)?$/i,
]

// ─── Typo corrections applied before any matching ───────────────────────────
const TYPO_MAP: Record<string, string> = {
  "sundays": "sundae",   // Strawberry Sundays → Strawberry Sundae
  "sunday":  "sundae",   // Blue Berry Sunday → Blue Berry Sundae
  // POS vs sheet spelling for piri piri
  "peri peri": "piri piri",
}

// ─── Known POS→canonical overrides that the algorithm cannot infer ───────────
// Add entries here only after human confirmation (these feed reviewed=true rows).
const MANUAL_OVERRIDES: Record<string, string> = {
  // "12inch M" could be Mushroom or Mexicano — confirmed Mushroom
  "12inch M": "12inch Mushroom Pizza",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Trim whitespace, collapse internal runs, apply typo corrections. */
export function normalizeRaw(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ")
  // Apply typo map (case-insensitive replace of whole words)
  for (const [typo, fix] of Object.entries(TYPO_MAP)) {
    const re = new RegExp(`\\b${escapeRe(typo)}\\b`, "gi")
    s = s.replace(re, (m) => {
      // Preserve original capitalisation of first char
      return m[0].toUpperCase() === m[0]
        ? fix.charAt(0).toUpperCase() + fix.slice(1)
        : fix
    })
  }
  return s
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** True if this POS categoryName marks a modifier/component line. */
export function isModifierCategory(cat: string | null | undefined): boolean {
  if (!cat) return false
  const t = cat.trim()
  return MODIFIER_CATEGORY_PATTERNS.some((re) => re.test(t))
}

/** True if this is a deal/bundle wrapper line. */
export function isDealCategory(cat: string | null | undefined): boolean {
  if (!cat) return false
  const t = cat.trim()
  return DEAL_CATEGORY_PATTERNS.some((re) => re.test(t))
}

// ─── Pizza decoder ───────────────────────────────────────────────────────────

const PIZZA_SIZE_RE = /^(\d+)\s*inch\s*/i

/**
 * Build the initials key for a canonical pizza name.
 * Rules:
 *  - Strip size prefix ("12inch "), strip trailing "Pizza" (case-insensitive)
 *  - ALL-CAPS tokens are kept whole (BBQ, CT → BBQ, CT)
 *  - "&" is skipped
 *  - Other tokens: take first char uppercased
 *
 * Examples:
 *   "Queen Margherita Pizza"          → "QM"
 *   "BBQ Chicken Pizza"               → "BBQC"
 *   "Rock My Socks Pizza"             → "RMS"
 *   "Chicken Tikka Pizza"             → "CT"   (both ALL-CAPS in the sheet → "CT")
 *   "Mexicano Pizza"                  → "Mex"  (falls through to prefix match)
 */
function buildInitials(canonicalName: string): string {
  let name = canonicalName
  // Strip size prefix
  name = name.replace(PIZZA_SIZE_RE, "")
  // Strip trailing "Pizza" word
  name = name.replace(/\bPizza\b/gi, "").trim()

  const tokens = name.split(/\s+/).filter(Boolean)
  return tokens
    .filter((t) => t !== "&")
    .map((t) => {
      // ALL-CAPS token kept whole (BBQ, CT, etc.)
      if (t === t.toUpperCase() && t.length > 1) return t
      return t[0].toUpperCase()
    })
    .join("")
}

export type PizzaDecodeResult =
  | { matched: true;  canonicalName: string; size: string; method: "exact" | "initials" | "prefix"; confidence: 1 }
  | { matched: false; reason: "no_size" | "ambiguous" | "no_match"; candidates?: string[] }

/**
 * Decode a POS pizza name against the list of canonical pizza names.
 *
 * Input examples:  "8inch Queen Margherita Pizza"
 *                  "12inch QM"
 *                  "16inch RMS"
 *                  "12inch BBQ C"
 *                  "12inch Mex"
 *
 * The caller is responsible for only passing items whose categoryName
 * looks like a pizza category.
 */
export function decodePizza(
  raw: string,
  canonicalPizzaNames: string[]
): PizzaDecodeResult {
  const sizeMatch = raw.match(PIZZA_SIZE_RE)
  if (!sizeMatch) return { matched: false, reason: "no_size" }

  const size = sizeMatch[1]          // "8" | "12" | "16"
  const code = raw.replace(PIZZA_SIZE_RE, "").trim()
  const codeLower = code.toLowerCase()

  // ── Step 1: exact spelled-out match ──────────────────────────────────────
  // Normalise both sides: & → and, lowercase, drop "pizza"
  const normalise = (s: string) =>
    s.toLowerCase()
      .replace(/&/g, "and")
      .replace(/\bpizza\b/g, "")
      .replace(/\s+/g, " ")
      .trim()

  const codeNorm = normalise(code)
  for (const name of canonicalPizzaNames) {
    const nameNorm = normalise(name)
    if (codeNorm === nameNorm) {
      return { matched: true, canonicalName: name, size, method: "exact", confidence: 1 }
    }
  }

  // ── Step 2: initials match ────────────────────────────────────────────────
  const initialsMatches = canonicalPizzaNames.filter(
    (name) => buildInitials(name).toUpperCase() === code.replace(/\s+/g, "").toUpperCase()
  )
  if (initialsMatches.length === 1) {
    return { matched: true, canonicalName: initialsMatches[0], size, method: "initials", confidence: 1 }
  }
  if (initialsMatches.length > 1) {
    return { matched: false, reason: "ambiguous", candidates: initialsMatches }
  }

  // ── Step 3: prefix of a single-token canonical ───────────────────────────
  // e.g. "Mex" → "Mexicano Pizza" (only if exactly one canonical starts with that prefix)
  const prefixMatches = canonicalPizzaNames.filter((name) => {
    // Strip size + "Pizza" from canonical; check if first word starts with code
    const stem = name
      .replace(PIZZA_SIZE_RE, "")
      .replace(/\bPizza\b/gi, "")
      .trim()
    return stem.toLowerCase().startsWith(codeLower)
  })
  if (prefixMatches.length === 1) {
    return { matched: true, canonicalName: prefixMatches[0], size, method: "prefix", confidence: 1 }
  }
  if (prefixMatches.length > 1) {
    return { matched: false, reason: "ambiguous", candidates: prefixMatches }
  }

  return { matched: false, reason: "no_match" }
}

// ─── Non-pizza matcher ───────────────────────────────────────────────────────

export type NonPizzaMatchResult =
  | { matched: true;  canonicalName: string; method: "exact" | "fuzzy"; confidence: number }
  | { matched: false }

/**
 * Match a non-pizza POS name against canonical costing names.
 *
 * 1. Exact match (case-insensitive, trimmed).
 * 2. Normalised exact: remove punctuation, collapse spaces.
 * 3. Levenshtein ratio ≥ 0.82 on the longest of the two strings
 *    (handles Solo/Meal suffix variants, minor spelling, truncation).
 *    Only fires when there is exactly one candidate above threshold.
 */
export function matchNonPizza(
  raw: string,
  canonicalNames: string[]
): NonPizzaMatchResult {
  const rawLower = raw.toLowerCase().trim()

  // Strip " (With Options)" suffix that Presto sometimes appends
  const stripSuffix = (s: string) =>
    s.replace(/\s*\(with options\)\s*$/i, "").trim()

  const rawClean = stripSuffix(rawLower)

  // Step 1: exact (case-insensitive)
  for (const name of canonicalNames) {
    if (stripSuffix(name.toLowerCase()) === rawClean) {
      return { matched: true, canonicalName: name, method: "exact", confidence: 1 }
    }
  }

  // Step 2: normalised exact (remove punctuation, collapse spaces)
  const normStr = (s: string) =>
    stripSuffix(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()

  const rawNorm = normStr(raw)
  for (const name of canonicalNames) {
    if (normStr(name) === rawNorm) {
      return { matched: true, canonicalName: name, method: "exact", confidence: 1 }
    }
  }

  // Step 3: Levenshtein ratio
  const THRESHOLD = 0.82
  let bestRatio = 0
  let bestName = ""
  let tieCount = 0

  for (const name of canonicalNames) {
    const ratio = levenshteinRatio(rawNorm, normStr(name))
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestName = name
      tieCount = 1
    } else if (ratio === bestRatio && ratio >= THRESHOLD) {
      tieCount++
    }
  }

  if (bestRatio >= THRESHOLD && tieCount === 1) {
    return { matched: true, canonicalName: bestName, method: "fuzzy", confidence: bestRatio }
  }

  return { matched: false }
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (la === 0 || lb === 0) return 0
  // Cap at 60 chars each for speed
  const aa = a.slice(0, 60), bb = b.slice(0, 60)
  const dist = levenshtein(aa, bb)
  return 1 - dist / Math.max(aa.length, bb.length)
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

// ─── Pizza category detector ─────────────────────────────────────────────────

export function isPizzaCategory(cat: string | null | undefined): boolean {
  if (!cat) return false
  // Matches "PIZZAS", "Pizza Names", "8inch Pizza Names ", "Piri Piri" etc.
  // A category is a pizza category if it contains "pizza" anywhere (case-insensitive).
  // "Piri Piri" is a chicken grills category — explicitly excluded.
  const t = cat.trim().toLowerCase()
  if (t === "piri piri" || t === "peri peri") return false
  return t.includes("pizza")
}

// ─── Solo / Meal variant detector ───────────────────────────────────────────

export function detectVariant(
  raw: string,
  cat: string | null | undefined
): "solo" | "meal" | null {
  const r = raw.toLowerCase()
  const c = (cat || "").toLowerCase()
  if (r.includes("solo") || c.includes("solo")) return "solo"
  if (r.includes("make it a meal") || r.includes("meal") || c.includes("meal")) return "meal"
  return null
}
