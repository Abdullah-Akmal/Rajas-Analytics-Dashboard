# Server Actions Reference

This is the app's "API". All actions live in [`app/actions/dashboard.ts`](../app/actions/dashboard.ts) (`"use server"`) unless noted. Normalisation actions live in [`lib/normalise/actions.ts`](../lib/normalise/actions.ts).

Common parameters:
- `startDate`, `endDate` — `yyyy-MM-dd` (UK-local trading dates, inclusive).
- `location` — `"Hyde Park"` | `"Grand Arcade"` | `"all"` (or omitted = all).

Cancelled orders are excluded from analytics unless a doc says otherwise.

---

## Write side — data sync

| Action | Signature | Purpose |
|--------|-----------|---------|
| `syncGoogleSheets()` | `()` | Pull menu items / costs from the Google Sheet into `menu_items` / `dim_costing_item`. |
| `syncPrestoData(dateStr, locationKey)` | `("yyyy-MM-dd", "HYDE_PARK" \| "GRAND_ARCADE")` | Pull one trading day of orders + line items for one location. Fetches the day's shift **and the previous day's shift** to capture after-midnight orders. |
| `syncShipdayData(startDate, endDate)` | `(string, string)` | Pull deliveries for a date range into `deliveries`. |
| `backfillOrderTime()` | `()` | Populate `orders.orderTime` for legacy rows lacking it (from Shipday/line data). |
| `clearSyncData(scope)` | `("orders" \| "deliveries" \| "all")` | Danger: wipe ingested data for a re-sync. |

Every sync writes a `sync_logs` row. Returns `{ success, orders?/count?, error? }`.

## Normalisation (in `lib/normalise/actions.ts`)

| Action | Purpose |
|--------|---------|
| `syncCostingSheet()` | Load the "Item Costing" sheet tab into `dim_costing_item`. |
| `normaliseOrderItems()` | Scan distinct POS `itemName`s, decode size/variant, match to canonical items, upsert `item_alias`. |
| `getReviewQueue()` | Unreviewed / low-confidence aliases needing a human decision. |
| `getAllCanonicals()` | All `dim_costing_item` rows (for the review dropdown). |
| `getCostingItemsWithAliasCounts()` | Canonical items + how many POS names map to each. |
| `confirmAlias(aliasId, canonicalId)` | Human confirms (or clears) a mapping; sets `reviewed=true`. |
| `getUncostedItems()` | Ordered items with no cost coverage yet. |

---

## Read side — analytics

### Overview & profitability
| Action | Returns |
|--------|---------|
| `getOverviewKPIs(s,e,loc)` | Revenue, orders, AOV, gross profit, margin — headline KPIs. |
| `getItemProfitability(s,e,loc)` | Per-item units, revenue, cost, gross profit, margin %, avg unit price. |
| `getCategoryPerformance(s,e,loc)` | Same rolled up by category. |
| `getDailyRevenueTrend(s,e,loc)` | Revenue per day (split by location when `loc="all"`). |

### Sales mix
| Action | Returns |
|--------|---------|
| `getTopItemsByPlatform(s,e,loc,perPlatform=8)` | Top N items within each platform. |
| `getPlatformPerformance(s,e,loc)` | Revenue/orders/AOV by platform. |
| `getModeBreakdown(s,e,loc)` | Split by delivery / collection / dine-in. |

### Time-of-day
| Action | Returns |
|--------|---------|
| `getHourlyDemand(s,e,loc)` | Orders/revenue by hour (UK local). |
| `getHourlyBreakdown(s,e,loc,dayOfWeek?)` | Hourly orders/revenue/AOV, optionally for one weekday. Powers Offer Recommendation. |
| `getHourlyDemandHeatmap(s,e,loc)` | Hour × metric grid. |
| `getRevenueHeatmap(s,e,loc)` | Day-of-week × hour revenue grid (the Overview heatmap). |

### Delivery
| Action | Returns |
|--------|---------|
| `getDeliveryKPIs(s,e)` | On-time %, avg delivery time, distance, fees. |
| `getDeliveryPerformance(s,e)` | Per-driver performance. |
| `getDeliveryAreaAnalytics(s,e)` | Delivery geography / area breakdown. |

### Offers
| Action | Returns |
|--------|---------|
| `getOfferAnalysis(s,e,loc)` | Discount usage summary. |
| `getOfferAnalytics(s,e,loc,…)` | Detailed offer performance (uplift, cost of discount, margin impact). |

### Basket & customers
| Action | Returns |
|--------|---------|
| `getBasketAnalysis(s,e,loc)` | Items-per-order distribution, top items, penetration. |
| `getBasketInsights(s,e,loc)` | Market-basket: `{ affinity, attach, groups }` — item-pair affinity (support/confidence/lift), add-on attach rates (meal bundles credited as side+drink), and menu-group order counts. |
| `getCustomerInsights(s,e,loc)` | Identified **web** customers: top customers, coverage, New/Returning/Regular segmentation, repeat rate, spend. |
| `getWebCustomerItemsBySegment(s,e,loc)` | `{ newCustomers, returning, regular }` — top items each segment buys (units, revenue, orders). |

### Forecasting & validation
| Action | Returns |
|--------|---------|
| `getForecastData(loc?)` | Demand forecast inputs/series. |
| `getOrderLineValidation(s,e,loc)` | Reconciliation of order totals vs summed line items (data-quality check). |

### Reference / logs
| Action | Returns |
|--------|---------|
| `getMenuItems()` | All `menu_items`. |
| `getSyncLogs()` | Recent `sync_logs`. |

### Action Panel (execution tracker)
| Action | Purpose |
|--------|---------|
| `getActionItems()` | List all `action_items`. |
| `createActionItem(input)` | Create a task (`title`, `detail`, `category`, `priority`, `owner`, `deadline`, `impact`). |
| `updateActionItem(id, patch)` | Update status/fields. |
| `deleteActionItem(id)` | Remove a task. |

---

### Cost-lookup internals

Analytics that need item cost use a deduped `costLookup()` subquery (one unit cost per normalised item name, preferring `reviewed` then `confidence`). This prevents the `item_alias` join from fanning out and inflating totals — see the Revenue Reconciliation note in the project memory and [NORMALISATION.md](NORMALISATION.md).
