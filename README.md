# Rajas Analytics Dashboard

Business-intelligence dashboard for **Rajas** (Leeds) — two locations, **Hyde Park** and **Grand Arcade**. It aggregates data from the Presto EPOS, Shipday delivery platform, and a Google Sheet of item costs into one analytics surface covering sales, item profitability, delivery performance, offers, baskets, customers, forecasting and offer recommendations.

- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript
- **UI:** Tailwind CSS 4 · shadcn/ui (Radix) · Recharts · lucide-react
- **Backend:** Next.js Server Actions
- **Database:** PostgreSQL (Neon) via Drizzle ORM
- **Auth:** Better Auth
- **Hosting:** Vercel (weekly cron for data sync)

---

## Documentation index

| Doc | What's in it |
|-----|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, request lifecycle, tech-stack rationale |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every table, column, relationship and index |
| [docs/SERVER_ACTIONS.md](docs/SERVER_ACTIONS.md) | The "API" — every server action, its inputs and outputs |
| [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) | Presto, Shipday and Google Sheets sync — endpoints, timestamps, mapping |
| [docs/NORMALISATION.md](docs/NORMALISATION.md) | The item-name ETL that maps POS spellings → canonical costed items |
| [docs/PAGES.md](docs/PAGES.md) | Every dashboard screen and the data it renders |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to Vercel, environment variables, database bootstrap |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Day-2 operations: running syncs, the review queue, troubleshooting |
| [.env.example](.env.example) | Template of every required environment variable |

---

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Configure — copy the template and fill in real values
cp .env.example .env.local

# 3. Create / migrate the database schema (idempotent)
npx tsx lib/db/migrate.ts

# 4. Run
npm run dev            # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server |
| `npm run build` | Production build (type-checked) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npx tsx lib/db/migrate.ts` | Create/upgrade DB tables (safe to re-run) |
| `npx tsx scripts/run-normalise.ts` | Re-run the item-name normalisation ETL |
| `npx tsx scripts/coverage-report.ts` | Report cost-coverage of ordered items |
| `npx tsx scripts/inspect-queue.ts` | Inspect the name-review queue |

## Repository layout

```
app/
  actions/dashboard.ts     # all server actions (sync + analytics)
  api/auth/[...all]         # Better Auth handler
  api/cron/sync            # weekly data-sync endpoint (Vercel Cron)
  dashboard/               # one folder per screen
  layout.tsx · page.tsx    # root layout + redirect to /dashboard
components/
  dashboard-sidebar.tsx    # left nav
  date-location-filter.tsx # shared date + location filter (persisted)
  ui/                      # shadcn primitives
lib/
  db/                      # Drizzle client, schema, migrations
  normalise/               # item-name ETL (costing sheet <-> POS names)
  auth.ts · auth-client.ts # Better Auth config
scripts/                   # operational tsx utilities
docs/                      # this documentation set
```

> ⚠️ **Before public deploy:** access control is not yet enforced (no login gate on `/dashboard`). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#security-checklist).
