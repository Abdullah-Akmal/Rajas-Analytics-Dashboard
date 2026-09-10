# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Business-intelligence dashboard for **Rajas** (Leeds), two locations — `HYDE_PARK` and `GRAND_ARCADE`. A single Next.js 16 App Router app plays three roles at once: **ETL** (pulls Presto sales, Shipday deliveries, Google Sheets costs), **analytics engine** (SQL aggregations in server actions), and **presentation** (client pages rendering Recharts/shadcn). There is no separate backend — everything runs in Next.js against one Neon Postgres database.

## Commands

```bash
npm run dev            # local dev server
npm run build          # production build — this is the type-check
npm run lint           # ESLint

npx tsx lib/db/migrate.ts          # create/upgrade tables (idempotent, safe to re-run)
npx tsx lib/db/perf-migrate.ts     # add hot-path indexes (idempotent, CONCURRENTLY)
npx tsx scripts/run-normalise.ts   # re-run item-name ETL after new items appear
npx tsx scripts/inspect-queue.ts   # what's awaiting human name review
npx tsx scripts/coverage-report.ts # how much ordered volume has costs
```

**There is no test framework** — no Jest/Vitest/Playwright, no test files. `npm run build` is the only automated correctness gate, so run it after non-trivial changes. The `tsx` scripts read `.env.local` via dotenv; server actions read the ambient env.

## Non-obvious invariants

Violating these produces *silently wrong numbers*, not errors. They are the main reason to read this file.

### 1. Costs go through the normalisation layer, never a direct join

POS item names are messy (`12" Piri Piri`, `12 inch peri peri`, …). Costs resolve via `item_alias` → `dim_costing_item`, and **must** use the deduped helpers in [dashboard.ts](app/actions/dashboard.ts):

- `costLookup()` for Drizzle queries, `costLookupRaw` for hand-written SQL.
- Joining `order_items` straight to `item_alias` matches one line to **multiple** alias rows and multiplies `SUM(amount)`/`SUM(qty)`/cost. This has previously inflated revenue and profit across Item Profitability, Category, Overview and Offer reports.
- Do **not** use the legacy `menu_items.costPrice` exact-name join; it misses the spellings the Name Review screen maps by hand.
- `normKey()` (SQL) mirrors `normalizeRaw()` in [lib/normalise/index.ts](lib/normalise/index.ts). **If you change one, change the other** — the join depends on them producing identical output.
- **In SQL regexes use `[[:space:]]`, never `\s`.** In this Postgres `regexp_replace(x, '\s+', ' ', 'g')` replaces the letter **s**, not whitespace. This silently broke the cost join for every name containing an "s" (319 of 563 aliases): only 47% of revenue joined to a cost. `\m`/`\M` word boundaries are fine — it is specifically `\s` that fails.

See [docs/NORMALISATION.md](docs/NORMALISATION.md) for the full ETL.

### 2. Every analytics action takes the same six params, and applies the slicers

Signature convention: `(startDate, endDate, location?, channel?, mode?, platform?)`.

Apply the filters with the shared helpers — never hand-roll them:

| Query style | Helper |
|---|---|
| Drizzle, orders-based | `orderSlicers(channel, mode, platform)` |
| Drizzle, order_items-based | `itemSlicers(...)` |
| Raw SQL, items | `rawItemSlicers(alias, ...)` |
| Raw SQL, orders | `rawOrderSlicers(alias, ...)` |

`channel` buckets `orderChannel`: `instore` = wix, `website` = eatpresto, `platforms` = ubereats/deliveroo/justeat. `order_items` has no platform column, so item-level platform filtering goes through an `EXISTS` on the parent order (`platformItemCondition`). A new action that skips these silently ignores the user's filter selection.

### 3. Time is Europe/London, always

Trade runs past midnight and across BST/GMT. Hour/day extraction uses `AT TIME ZONE 'Europe/London'`; calendar dates use `ukDateStr()` (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' })`). Naive UTC mis-buckets orders.

### 4. Date comparisons cast both sides

Use `dateGte`/`dateLte`, which cast to `::date`. Comparing a timestamp column to a date string directly gives wrong boundary rows.

### 5. Exclude cancelled orders

`orders.cancelled` defaults false; analytics queries filter it out. Don't drop that predicate when copying a query.

### 6. DB access is lazy by design

[lib/db/index.ts](lib/db/index.ts) exports `db`/`pool` as Proxies over lazy singletons so `dotenv.config()` in CLI scripts runs before `DATABASE_URL` is read (ESM hoists imports). The pool also monkey-patches `query` to retry once on transient Neon socket drops. Consequences: **never run a query at module scope**, and build query fragments (like `costLookup()`) per-request rather than hoisting them to a const.

## Adding a dashboard screen

1. Create `app/dashboard/<route>/page.tsx` as a **client component** (`"use client"`).
2. Register it in the relevant nav array in [dashboard-sidebar.tsx](components/dashboard-sidebar.tsx) — `analyticsItems`, `operationsItems`, or `intelligenceItems`. A nav entry can carry `secondary: true` (a tab on another page, e.g. Category Performance) or a `badge`.
3. Render `<DateLocationFilter onFilterChange={...} />` and call server actions on change. Pass `showChannel={false}` on inherently single-channel pages (Delivery, Customers) where the slicers would mislead.
4. Add the server action to [app/actions/dashboard.ts](app/actions/dashboard.ts) following the conventions above.

The filter persists to URL query string **and** `sessionStorage`, so state survives navigation between pages.

## Data sync

- **Manual:** `/dashboard/sync` calls the sync actions directly (backfill, clear).
- **Scheduled:** [app/api/cron/sync/route.ts](app/api/cron/sync/route.ts), registered in `vercel.json` as `0 4 * * 1` (Mondays 04:00 UTC), protected by `CRON_SECRET`. Rolling last-7-days.
- Every sync writes a row to `sync_logs`. Shipday's API caps at ~1 month, so its sync windows the range and retries on throttle.
- Run the normalisation ETL after a significant Presto sync or costing-sheet change, then clear the review queue so new items get costs.

Node runtime only — the `pg` driver is not Edge-compatible. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Known gaps

- **No auth gate.** Better Auth is configured with its handler at `app/api/auth/[...all]` and its tables exist, but there is no `middleware.ts`, no layout session guard, and no login page. `/dashboard` is fully open. This is the top pre-launch task — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **`maxDuration = 300`** on the cron route requires Vercel Pro; Hobby caps at 60s.
- **The `docs/` set was written 2026-07-03 and has drifted.** Notably `docs/PAGES.md` still describes the shared filter as date + location only; it now also carries sales-channel, fulfilment-mode and order-platform. Verify against code before trusting a doc detail.

## Documentation map

`README.md` is the entry point. Deeper detail lives in [docs/](docs/): `ARCHITECTURE.md` (design decisions, request lifecycle), `DATA_MODEL.md` (tables, indexes), `SERVER_ACTIONS.md` (the API surface), `INTEGRATIONS.md`, `NORMALISATION.md`, `PAGES.md`, `DEPLOYMENT.md`, `RUNBOOK.md`.
