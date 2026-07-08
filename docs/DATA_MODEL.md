# Data Model

All tables are defined in [`lib/db/schema.ts`](../lib/db/schema.ts) (Drizzle) and created by [`lib/db/migrate.ts`](../lib/db/migrate.ts). Postgres on Neon.

## Table groups

- **Auth** (Better Auth): `user`, `session`, `account`, `verification`
- **Sales / ingestion**: `orders`, `order_items`, `deliveries`, `menu_items`, `sync_logs`
- **Normalisation**: `dim_costing_item`, `item_alias`
- **Execution tracking**: `action_items`

---

## Sales & ingestion

### `orders` — one row per POS order
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `orderId` | text unique | Presto order id (natural key, dedup) |
| `location` | text NOT NULL | `Hyde Park` \| `Grand Arcade` |
| `date` | date NOT NULL | UK-local trading date |
| `totalAmount` | numeric(10,2) | order gross |
| `platform` | text | e.g. `Wix`, `Deliveroo`, `UberEats`, `JustEat` |
| `orderChannel` | text | POS channel string |
| `mode` | text | delivery / collection / dine-in |
| `cancelled` | boolean | filtered out of most analytics |
| `discountValue` / `discountPercent` | numeric | order-level discount |
| `paymentType` | text | |
| `customerId` | text | present mainly for Wix web orders (see below) |
| `vatAmount` | numeric | |
| `orderTime` | timestamp | UTC wall-clock; converted to `Europe/London` when bucketing |
| `createdAt` | timestamp | ingest time |

### `order_items` — one row per line on an order
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `orderId` | text NOT NULL | links to `orders.orderId` (not an FK constraint) |
| `location`, `date` | | denormalised for fast filtering |
| `itemId` | text | Presto item id |
| `itemName` | text NOT NULL | **raw POS name** — normalised via `item_alias` |
| `itemType`, `categoryName`, `groupName` | text | POS taxonomy |
| `qty` | numeric | |
| `unitPrice`, `amount`, `discount` | numeric | |
| `vatAmount`, `vatPercent` | numeric | |
| `modifierCost` | numeric | |
| `mode`, `orderChannel` | text | |
| `cancelled` | boolean | |

### `deliveries` — one row per Shipday delivery
Rich delivery record: lifecycle timestamps (`placementTime`, `requestedPickupTime`, `requestedDeliveryTime`, `assignedTime`, `startTime`, `pickedupTime`, `arrivedTime`, `deliveryTime`, `failedDeliveryTime`), `status`, `accepted`, driver (`driverId`, `driverName`), money (`orderTotal`, `deliveryFee`, `driverPayment`, `tip`, `discount`, `tax`), `distance`, `paymentMethod`, `orderSource`, and pickup/delivery **name + address + lat/lng**. `shipdayOrderId` is unique. Used by the Delivery & Drivers page for on-time %, distance and area analytics.

### `menu_items` — legacy per-location menu + prices
`itemName`, `category`, `itemType`, `costPrice`, `sellingPriceHydePark`, `sellingPriceGrandArcade`, `location`. Kept for the item-profitability join; the authoritative cost source is now `dim_costing_item`.

### `sync_logs` — audit trail of every sync
`source` (presto/shipday/sheets), `location`, `status`, `recordsProcessed`, `errorMessage`, `syncedAt`. Surfaced on the Sync page.

---

## Normalisation layer

See [NORMALISATION.md](NORMALISATION.md) for how these are populated and used.

### `dim_costing_item` — canonical costed items (from the Google Sheet)
`canonicalName` (unique), `category`, `itemType` (`pizza` \| `solo_meal` \| `simple`), size costs `cost8inch` / `cost12inch` / `cost16inch`, `costSolo`, `costMeal`, `primaryCost`, plus `sellingPriceHydePark` / `sellingPriceGrandArcade`.

### `item_alias` — maps every raw POS name → a canonical item
`normalizedRaw` (unique, trimmed POS name), `canonicalId` → `dim_costing_item.id` (nullable = unmatched), decoded `size` and `variant`, `matchMethod`, `confidence` (1.0 deterministic, <1.0 fuzzy, null unmatched), `reviewed` (human-confirmed), `posCategoryName`, `isModifier` (£0 component line, not a sellable item).
Indexes: `item_alias_canonical_idx(canonicalId)`, `item_alias_reviewed_idx(reviewed)`.

---

## Execution tracking

### `action_items` — the weekly Action Panel
`title`, `detail`, `category` (Pricing \| Offers \| Platform \| Delivery \| Menu \| Other), `priority` (high \| medium \| low), `owner`, `deadline`, `status` (todo \| in_progress \| done), `impact`. Rows are created by promoting an auto-generated recommendation or added manually.

---

## Relationships (logical)

```
user ─1─* session
user ─1─* account
dim_costing_item ─1─* item_alias           (canonicalId, ON DELETE SET NULL)
orders.orderId  ─1─* order_items.orderId    (app-level link, no FK)
order_items.itemName ──normKey──▶ item_alias.normalizedRaw ──▶ dim_costing_item  (cost lookup)
```

> **Note on `customerId`:** only **Wix web orders** carry a stable customer identity. Delivery-platform orders use per-order anonymous ids, so repeat-customer analytics are scoped to identified web customers only.
