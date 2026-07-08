# Item-Name Normalisation (ETL)

## The problem

POS item names are messy: `"12\" Piri Piri"`, `"12 inch peri peri"`, `"Piri-Piri Pizza (Large)"` can all be the same product. The Google costing sheet, meanwhile, has one clean canonical name per item with costs per size/variant. Without a mapping, cost joins miss (undercount) or fan out (overcount).

The normalisation layer maps **every distinct raw POS name → one canonical costed item**, once, so every report shares consistent costs.

## The pieces

| Piece | Role |
|-------|------|
| `dim_costing_item` | Canonical items from the sheet, with size/variant costs. |
| `item_alias` | One row per distinct raw POS `itemName` → a `canonicalId` (+ decoded `size`/`variant`, match method, confidence, reviewed flag, `isModifier`). |
| `lib/normalise/index.ts` | Pure functions: `normalizeRaw`, `decodePizza`, `matchNonPizza`, `detectVariant`, category predicates. |
| `lib/normalise/actions.ts` | Server actions that run the ETL and drive the review UI. |

## `normalizeRaw()` / `normKey`

Lowercases, trims, collapses whitespace, and applies a typo/synonym map (e.g. `sundays → sundae`, `peri peri → piri piri`). Used both to build alias keys and, as the SQL `normKey()` expression, to join `order_items.itemName` to `item_alias.normalizedRaw` at query time.

## Matching pipeline (`normaliseOrderItems`)

1. Collect distinct trimmed POS `itemName`s from `order_items`.
2. Classify by POS category (pizza vs non-pizza vs modifier/deal).
3. **Pizzas:** `decodePizza()` extracts size (8/12/16) and variant, matches to a canonical pizza. Method = `exact` / `initials` / `prefix`.
4. **Non-pizzas:** `matchNonPizza()` does exact then fuzzy matching → `non_pizza_exact` / `non_pizza_fuzzy`.
5. Modifiers / £0 component lines are flagged `isModifier=true` (excluded from item analytics).
6. Results upsert into `item_alias` with a `confidence` (1.0 deterministic, <1.0 fuzzy, null unmatched) and `reviewed=false`.

## Human review

Fuzzy/unmatched aliases land in the **Name Review** queue (`/dashboard/review`, badge "Queue"):
- `getReviewQueue()` lists them; the operator picks the correct canonical item.
- `confirmAlias(aliasId, canonicalId)` sets the mapping and `reviewed=true`.
- Confirmed mappings win in cost lookups (ordered by `reviewed DESC, confidence DESC`).

## Cost lookup at query time

Analytics build a deduped `costLookup()` subquery: for each normalised name it takes exactly one unit cost — `(array_agg(<cost CASE> ORDER BY reviewed DESC, confidence DESC NULLS LAST, id))[1]`. Selecting the correct size cost (8/12/16-inch, solo, meal, primary) uses the alias's decoded `size`/`variant`. Deduping is essential: a plain join to `item_alias` can produce multiple rows per line and **inflate** revenue/profit totals.

## Operating it

```bash
npx tsx scripts/run-normalise.ts      # re-run the ETL after new items appear
npx tsx scripts/inspect-queue.ts      # see what's awaiting review
npx tsx scripts/coverage-report.ts    # how much ordered volume has costs
```

Run the ETL after each significant Presto sync or costing-sheet change, then clear the review queue so new items get costs.
