# Operations Runbook

Day-2 operations for keeping the dashboard's data correct and fresh.

## Routine: weekly data refresh
The Vercel Cron (`0 4 * * 1`) calls `/api/cron/sync`, which syncs the **last 7 days** of Presto (both locations) + Shipday. To confirm it ran:
- Check `sync_logs` (newest rows) or the **Sync** screen.
- Or hit it manually:
  ```bash
  curl -X POST https://your-app.vercel.app/api/cron/sync -H "Authorization: Bearer <CRON_SECRET>"
  ```
  `200` ok · `207` partial (see `errors`) · `401` bad secret · `500` secret not set.

## Routine: after new menu items appear
New POS item names have no cost until normalised:
```bash
npx tsx scripts/run-normalise.ts     # match new POS names → canonical items
npx tsx scripts/inspect-queue.ts     # list fuzzy/unmatched needing review
npx tsx scripts/coverage-report.ts   # % of ordered volume with costs
```
Then open **Name Review** (`/dashboard/review`) and confirm the queued aliases. Profitability numbers improve as coverage rises.

## Routine: costing sheet changed
Re-import costs, then re-run normalisation:
1. From **Sync** (or call `syncCostingSheet()` / `syncGoogleSheets()`).
2. `npx tsx scripts/run-normalise.ts`.

## Manual backfill
On the **Sync** screen:
- Re-sync a specific date/location (Presto) or date range (Shipday).
- `backfillOrderTime` — populate `orders.orderTime` on legacy rows.
- `clearSyncData(scope)` — **destructive**; wipes orders/deliveries/all before a clean re-sync. Double-check the location/scope.

---

## Troubleshooting

### "Connection terminated" / intermittent query failure
Neon closes idle sockets. The pool (`lib/db/index.ts`) retries once on transient drops, so most self-heal. If persistent: check Neon isn't paused/over its connection cap and that `DATABASE_URL` is the **pooled** string.

### Revenue in two reports doesn't match
Usually a **per-page date-filter difference**, not a bug — confirm both pages use the same range/location. If a single page's item totals look inflated, suspect an `item_alias` join fan-out; analytics use the deduped `costLookup()` to prevent this (see [NORMALISATION.md](NORMALISATION.md)).

### Orders missing after midnight
Presto returns shifts, not calendar days. `syncPrestoData` fetches day D **and** D-1 to catch after-midnight trade. If a late-night gap appears, re-sync that date (it will re-pull the adjoining shift).

### Charts show trade before opening hours
Hour bucketing must use `AT TIME ZONE 'Europe/London'`. If a page shows pre-open orders, an aggregation is bucketing in UTC — fix the query to convert first.

### Item shows £0 / missing cost
Its POS name isn't mapped yet. Run `scripts/run-normalise.ts` and clear it in Name Review; if the item isn't in the costing sheet at all, add it there first.

### Cron returns 500
`CRON_SECRET` isn't set on the server. Set it in Vercel env and redeploy.

---

## Data-quality checks
- **Order-line reconciliation:** `getOrderLineValidation` (surfaced in-app) compares order totals to summed line items — a spread flags ingestion gaps.
- **Cost coverage:** `scripts/coverage-report.ts` — aim to keep uncosted ordered volume low.
- **Review queue depth:** `scripts/inspect-queue.ts` — keep it near zero so new items stay costed.

## Where things live
| Concern | File |
|---------|------|
| Sync + analytics actions | `app/actions/dashboard.ts` |
| Normalisation ETL + review | `lib/normalise/` |
| DB client / schema / migration | `lib/db/` |
| Cron endpoint | `app/api/cron/sync/route.ts` |
| Auth config | `lib/auth.ts`, `lib/auth-client.ts` |
