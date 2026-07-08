# Deployment (Vercel)

## Prerequisites
- Code pushed to GitHub.
- A Postgres database reachable from Vercel (Neon recommended — use the **pooled** connection string).
- Credentials for Presto, Shipday and a Google service account with access to the costing sheet.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** for both **Production** and **Preview**. Full template: [`.env.example`](../.env.example).

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | ✅ | Neon pooled connection string. |
| `BETTER_AUTH_SECRET` | ✅ | `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | ✅ (prod) | `https://your-app.vercel.app`. Set after the first deploy, then redeploy. |
| `CRON_SECRET` | ✅ | `openssl rand -base64 32`. Vercel Cron sends it as a Bearer token automatically. |
| `PRESTO_BASE_URL` | ✅ | Presto API base URL. |
| `PRESTO_API_KEY` / `PRESTO_API_SECRET` | ✅ | Presto credentials. |
| `PRESTO_LOCATION_ID_HYDE_PARK` | ✅ | Hyde Park site id. |
| `PRESTO_LOCATION_ID_GRAND_ARCADE` | ✅ | Grand Arcade site id. |
| `SHIPDAY_API_KEY` | ✅ | Shipday API key. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ | Service-account email (share the sheet with it). |
| `GOOGLE_PRIVATE_KEY` | ✅ | Keep the `-----BEGIN...` wrapper; escape newlines as `\n`, keep quotes. |
| `GOOGLE_SHEET_ID` | ✅ | From the sheet URL. |

## Step-by-step

1. **Import** the repo in Vercel → New Project. Framework auto-detects **Next.js**; leave build (`next build`) and output defaults.
2. **Add the environment variables** above.
3. **Deploy.** The build now type-checks (`ignoreBuildErrors` was removed). Run `npm run build` locally first to catch errors before pushing.
4. **Set `BETTER_AUTH_URL`** to the real deployment URL and redeploy so auth cookies/origins are correct.
5. **Bootstrap the database** (see below).
6. **Verify the cron** works (see below).

## Database bootstrap

`lib/db/migrate.ts` is idempotent (`IF NOT EXISTS` throughout) but **assumes the base sales tables and Better Auth tables already exist** — it mainly adds columns/indexes and the normalisation + `action_items` tables. For a brand-new database you must also create the base tables.

Options:
- **Existing DB (current setup):** just run `npx tsx lib/db/migrate.ts` against `DATABASE_URL`.
- **Fresh DB:** create the Better Auth tables (`npx @better-auth/cli migrate` or generate) and the base sales tables (`orders`, `order_items`, `deliveries`, `menu_items`, `sync_logs`) via a Drizzle push, **then** run `lib/db/migrate.ts`. There is currently no `drizzle.config.ts`; adding one with `drizzle-kit push` is the clean long-term fix.

Run migrations from your machine (they read `.env.local`), not from the Vercel build.

## The cron duration caveat

`app/api/cron/sync/route.ts` sets `maxDuration = 300`.

- **Vercel Pro:** works as-is; the weekly 7-day sync can take minutes.
- **Vercel Hobby:** functions are capped at **60s** — the sync will be killed mid-run. Options:
  1. Upgrade to Pro, **or**
  2. Split the work so each invocation finishes under 60s (e.g. one day/location per call, or trigger per-day via an external scheduler), **or**
  3. Run the weekly sync from an external scheduler (GitHub Actions / cron-job.org) hitting `/api/cron/sync` with the `CRON_SECRET`.

Test after deploy:
```bash
curl -X POST https://your-app.vercel.app/api/cron/sync \
  -H "Authorization: Bearer <CRON_SECRET>"
```
Expect `200` (all ok) or `207` (partial — see the `errors` array). `401` = wrong/missing secret; `500` = `CRON_SECRET` not set.

## Security checklist

> **⚠️ Blocking for a public deploy.** Better Auth is configured but **nothing enforces a login** on `/dashboard`:
> - No `middleware.ts` and no session check in `app/dashboard/layout.tsx`.
> - No login/signup page; `/` redirects straight to `/dashboard`.
>
> Anyone with the URL can see all business data. Before going public: add a `middleware.ts` that redirects unauthenticated requests to a login page, build that page using `lib/auth-client.ts` (`signIn`/`signUp`), and gate the dashboard layout. Until then, treat the URL as a secret.

Other checks:
- [ ] `CRON_SECRET` set (cron is otherwise a `500`).
- [ ] `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` set for production.
- [ ] `.env.local` is git-ignored (it is) and never committed.
- [ ] `npm run build` passes locally.

## Post-deploy smoke test
1. App loads and redirects to `/dashboard`.
2. Pick a date range with known data — KPIs render.
3. Trigger a manual sync from `/dashboard/sync`; confirm a new `sync_logs` row.
4. Manually hit the cron endpoint (above) and confirm a `200`/`207`.
