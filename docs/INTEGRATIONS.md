# External Integrations

Three external sources feed the database. All ingestion lives in [`app/actions/dashboard.ts`](../app/actions/dashboard.ts) and [`lib/normalise/actions.ts`](../lib/normalise/actions.ts).

---

## 1. Presto EPOS — sales

**Env:** `PRESTO_BASE_URL`, `PRESTO_API_KEY`, `PRESTO_API_SECRET`, `PRESTO_LOCATION_ID_HYDE_PARK`, `PRESTO_LOCATION_ID_GRAND_ARCADE`
**Action:** `syncPrestoData(dateStr, "HYDE_PARK" | "GRAND_ARCADE")`
**Writes:** `orders`, `order_items`

### How it works
Presto's sales endpoint (`reports/shift/detailed?where=date:<date>`) returns **trading shifts, not calendar days**. A shift can run past midnight, so orders placed after 00:00 belong to the *previous* trading day's shift.

To capture a full UK calendar day (00:00–24:00), `syncPrestoData` fetches **two shifts per call**: the requested day **D** and the previous day **D-1**, then keeps the orders whose UK-local timestamp falls on D. This is why the weekly cron can loop day-by-day without losing after-midnight trade.

### Timestamps
- Order times come back as wall-clock and are stored in `orders.orderTime`.
- All downstream hour/day bucketing converts with `AT TIME ZONE 'Europe/London'`, so charts respect GMT/BST and never show trade before opening (GA 10:30, HP 11:00).
- `orders.date` is the UK-local trading date.

### Mapping (high level)
Presto order → `orders` (id, location, date, totals, platform/channel, mode, discounts, payment, customerId, VAT, orderTime). Each Presto line → `order_items` (itemName, category/group, qty, unitPrice, amount, discount, VAT, modifierCost).

---

## 2. Shipday — deliveries

**Env:** `SHIPDAY_API_KEY`
**Action:** `syncShipdayData(startDate, endDate)`
**Writes:** `deliveries`

Pulls delivery orders for a date range and upserts on `shipdayOrderId`. Captures the full delivery lifecycle (placement → assigned → picked up → arrived → delivered/failed), driver, money (fee, driver payment, tip, tax, discount), distance, payment method, and pickup/delivery addresses with lat/lng. Powers the **Delivery & Drivers** page (on-time %, average delivery time, distance bands, area analytics).

---

## 3. Google Sheets — item costs

**Env:** `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`
**Actions:** `syncGoogleSheets()` (menu_items) · `syncCostingSheet()` (dim_costing_item)
**Writes:** `menu_items`, `dim_costing_item`

Authenticated via a Google **service account** (share the sheet with the service-account email). The "Item Costing" tab is parsed into canonical items with size/variant costs (8/12/16-inch, solo, meal, primary) and per-location selling prices. These are the authoritative costs the profitability reports use — joined to POS lines through the normalisation layer.

> `GOOGLE_PRIVATE_KEY` must keep its `-----BEGIN PRIVATE KEY-----` wrapper. In env files, escape newlines as `\n` and keep the surrounding quotes.

---

## Sync orchestration

| Trigger | Path | Scope |
|---------|------|-------|
| **Scheduled** | `app/api/cron/sync/route.ts` (Vercel Cron `0 4 * * 1`) | Rolling last 7 UK-local days: Presto ×2 locations per day, then Shipday for the range. Auth: `Authorization: Bearer <CRON_SECRET>`. |
| **Manual** | `/dashboard/sync` screen | Ad-hoc date/location backfills, plus `backfillOrderTime` and `clearSyncData`. |

Every sync appends to `sync_logs` (source, location, status, recordsProcessed, errorMessage). Check that table (or the Sync screen) to confirm a run.

See [RUNBOOK.md](RUNBOOK.md) for operating these.
