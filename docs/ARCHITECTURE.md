# Architecture

## 1. Overview

Rajas Analytics is a **single Next.js application** that plays three roles:

1. **ETL / ingestion** — server actions pull raw data from Presto (sales), Shipday (deliveries) and Google Sheets (costs) and write it to Postgres.
2. **Analytics engine** — server actions run SQL aggregations over that data (profitability, baskets, offers, forecasting, …).
3. **Presentation** — App-Router client pages call the analytics actions and render charts/tables.

There is no separate backend service; everything runs inside Next.js and talks to one Postgres database (Neon).

```
┌──────────────┐   ┌──────────────┐   ┌───────────────┐
│  Presto API  │   │  Shipday API │   │ Google Sheets │   External sources
└──────┬───────┘   └──────┬───────┘   └───────┬───────┘
       │ sync actions     │                   │ costing sheet
       ▼                  ▼                   ▼
┌────────────────────────────────────────────────────────┐
│         app/actions/dashboard.ts  (+ lib/normalise)     │  Server (Node runtime)
│   write side: syncPrestoData / syncShipdayData /        │
│               syncGoogleSheets / normaliseOrderItems     │
└───────────────────────────┬────────────────────────────┘
                            ▼
                  ┌───────────────────┐
                  │  Postgres (Neon)  │  orders, order_items, deliveries,
                  │   via Drizzle ORM │  dim_costing_item, item_alias, …
                  └─────────┬─────────┘
                            ▲ read side (getOverviewKPIs, getBasketInsights, …)
┌───────────────────────────┴────────────────────────────┐
│      app/dashboard/**  (client components)              │  Browser
│   DateLocationFilter → server action → Recharts/tables  │
└─────────────────────────────────────────────────────────┘
```

## 2. Request lifecycle (a typical page)

1. A dashboard page (e.g. `app/dashboard/basket/page.tsx`) is a **client component** (`"use client"`).
2. On mount and whenever the shared **DateLocationFilter** changes, it calls one or more **server actions** from `app/actions/dashboard.ts` with `(startDate, endDate, location)`.
3. The server action runs a Drizzle/SQL query against Postgres and returns plain JSON.
4. The page stores the result in React state and renders it with Recharts / shadcn tables.

The filter persists its state in the URL query string **and** `sessionStorage` (see `components/date-location-filter.tsx`), so navigating between pages keeps the same date range and location.

## 3. Ingestion lifecycle

Two entry points:

- **Manual** — the **Sync** screen (`/dashboard/sync`) calls the sync actions directly for ad-hoc backfills.
- **Scheduled** — `app/api/cron/sync/route.ts` runs a rolling **last-7-days** sync. It's registered in `vercel.json` as a weekly Vercel Cron (`0 4 * * 1`, Mondays 04:00 UTC) and is protected by `CRON_SECRET`.

The cron handler loops each of the last 7 UK-local days, calls `syncPrestoData(day, location)` for both locations, then `syncShipdayData(start, end)` once, and finally records outcomes. Every sync writes a row to `sync_logs`.

See [INTEGRATIONS.md](INTEGRATIONS.md) for the exact API calls and timestamp handling.

## 4. Key design decisions

| Area | Decision | Why |
|------|----------|-----|
| Data access | **Server Actions**, not REST routes | Co-locates queries with the app, type-safe end to end, no API layer to maintain. |
| ORM | **Drizzle** over `pg` Pool | Typed schema + raw-SQL escape hatch for the heavy analytics queries. |
| DB client | Lazy singleton Pool with retry-once on transient drops (`lib/db/index.ts`) | Neon closes idle sockets; a single retry hides the "Connection terminated" blip. |
| Time | All hour/day extraction uses `AT TIME ZONE 'Europe/London'`; calendar dates via `Intl.DateTimeFormat('en-CA', {timeZone:'Europe/London'})` | Trade runs past midnight and across BST/GMT; naive UTC would mis-bucket orders. |
| Item costs | **Normalisation layer** (`dim_costing_item` + `item_alias`) | POS item names are messy and inconsistent; a canonical mapping lets one cost feed every report. |
| Bundle imports | `optimizePackageImports: [lucide-react, recharts, date-fns]` in `next.config.mjs` | Tree-shakes heavy barrels → smaller client bundles, faster dev compile. |

## 5. Runtimes & hosting

- **Node runtime** for server actions and the cron route (they use the `pg` driver — not Edge-compatible).
- The cron route sets `export const dynamic = "force-dynamic"` and `maxDuration = 300`. **300s requires Vercel Pro**; on Hobby the function is capped at 60s (see [DEPLOYMENT.md](DEPLOYMENT.md#the-cron-duration-caveat)).
- Images are served `unoptimized` (no Vercel image-optimisation dependency).

## 6. Authentication (current state)

Better Auth is configured (`lib/auth.ts`), exposes its handler at `app/api/auth/[...all]`, and its tables exist (`user`, `session`, `account`, `verification`). **However, no middleware or layout guard currently enforces a session on `/dashboard`, and there is no login page.** Closing this gap is the top pre-launch task — see [DEPLOYMENT.md](DEPLOYMENT.md#security-checklist).
