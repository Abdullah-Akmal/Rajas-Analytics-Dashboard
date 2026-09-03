import { boolean, date, index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

// ─── Brands ───────────────────────────────────────────────────────────────
// The costing sheet is split by full-width banner rows ("Rajas Menu Costing",
// "House of Peri Peri Menu Costing"). Everything below a banner belongs to that
// brand until the next one. Rajas is the default so pre-existing rows — and any
// sheet without banners — keep behaving as they did before brands existed.
export const BRAND_RAJAS = "Rajas"
export const BRAND_HOUSE_OF_PERI_PERI = "House of Peri Peri"
export const BRAND_DEFAULT = BRAND_RAJAS

// ─── Better Auth Tables ────────────────────────────────────────────────────
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// ─── App Tables ───────────────────────────────────────────────────────────
export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  itemName: text("itemName").notNull(),
  // Brand banner the item sits under in the costing sheet ("Rajas" | "House of Peri Peri")
  brand: text("brand").notNull().default(BRAND_DEFAULT),
  category: text("category"),
  itemType: text("itemType"),
  costPrice: numeric("costPrice", { precision: 10, scale: 2 }),
  sellingPriceHydePark: numeric("sellingPriceHydePark", { precision: 10, scale: 2 }),
  sellingPriceGrandArcade: numeric("sellingPriceGrandArcade", { precision: 10, scale: 2 }),
  location: text("location"),
  lastSyncedAt: timestamp("lastSyncedAt").defaultNow(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderId: text("orderId").unique(),
  location: text("location").notNull(),
  date: date("date").notNull(),
  totalAmount: numeric("totalAmount", { precision: 10, scale: 2 }),
  platform: text("platform"),
  orderChannel: text("orderChannel"),
  mode: text("mode"),
  cancelled: boolean("cancelled").default(false),
  discountValue: numeric("discountValue", { precision: 10, scale: 2 }).default("0"),
  discountPercent: numeric("discountPercent", { precision: 5, scale: 2 }).default("0"),
  paymentType: text("paymentType"),
  customerId: text("customerId"),
  vatAmount: numeric("vatAmount", { precision: 10, scale: 2 }).default("0"),
  orderTime: timestamp("orderTime"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: text("orderId").notNull(),
  location: text("location").notNull(),
  date: date("date").notNull(),
  itemId: text("itemId"),
  itemName: text("itemName").notNull(),
  itemType: text("itemType"),
  categoryName: text("categoryName"),
  groupName: text("groupName"),
  qty: numeric("qty", { precision: 10, scale: 2 }).default("0"),
  unitPrice: numeric("unitPrice", { precision: 10, scale: 2 }).default("0"),
  amount: numeric("amount", { precision: 10, scale: 2 }).default("0"),
  discount: numeric("discount", { precision: 10, scale: 2 }).default("0"),
  vatAmount: numeric("vatAmount", { precision: 10, scale: 2 }).default("0"),
  vatPercent: numeric("vatPercent", { precision: 5, scale: 2 }).default("0"),
  modifierCost: numeric("modifierCost", { precision: 10, scale: 2 }).default("0"),
  mode: text("mode"),
  orderChannel: text("orderChannel"),
  cancelled: boolean("cancelled").default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export const deliveries = pgTable("deliveries", {
  id: serial("id").primaryKey(),
  shipdayOrderId: text("shipdayOrderId").unique(),
  orderNumber: text("orderNumber"),
  placementTime: timestamp("placementTime"),
  requestedPickupTime: timestamp("requestedPickupTime"),
  requestedDeliveryTime: timestamp("requestedDeliveryTime"),
  assignedTime: timestamp("assignedTime"),
  startTime: timestamp("startTime"),
  pickedupTime: timestamp("pickedupTime"),
  arrivedTime: timestamp("arrivedTime"),
  deliveryTime: timestamp("deliveryTime"),
  failedDeliveryTime: timestamp("failedDeliveryTime"),
  status: text("status"),
  accepted: boolean("accepted").default(false),
  driverId: text("driverId"),
  driverName: text("driverName"),
  orderTotal: numeric("orderTotal", { precision: 10, scale: 2 }),
  deliveryFee: numeric("deliveryFee", { precision: 10, scale: 2 }),
  driverPayment: numeric("driverPayment", { precision: 10, scale: 2 }),
  tip: numeric("tip", { precision: 10, scale: 2 }).default("0"),
  discount: numeric("discount", { precision: 10, scale: 2 }).default("0"),
  tax: numeric("tax", { precision: 10, scale: 2 }).default("0"),
  distance: numeric("distance", { precision: 10, scale: 2 }),
  paymentMethod: text("paymentMethod"),
  orderSource: text("orderSource"),
  // Pickup location
  pickupName: text("pickupName"),
  pickupAddress: text("pickupAddress"),
  pickupLat: numeric("pickupLat", { precision: 10, scale: 7 }),
  pickupLng: numeric("pickupLng", { precision: 10, scale: 7 }),
  // Delivery location
  deliveryName: text("deliveryName"),
  deliveryAddress: text("deliveryAddress"),
  deliveryLat: numeric("deliveryLat", { precision: 10, scale: 7 }),
  deliveryLng: numeric("deliveryLng", { precision: 10, scale: 7 }),
  incomplete: boolean("incomplete").default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
})

export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  location: text("location"),
  status: text("status").notNull(),
  recordsProcessed: integer("recordsProcessed").default(0),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt").notNull().defaultNow(),
})

// Execution tracker — persisted action items management can assign, schedule & track.
// Rows are created by promoting an auto-generated action, or added manually.
export const actionItems = pgTable("action_items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  detail: text("detail"),
  category: text("category"),                 // Pricing | Offers | Platform | Delivery | Menu | Other
  priority: text("priority").notNull().default("medium"), // high | medium | low
  owner: text("owner"),                       // assigned person
  deadline: date("deadline"),                 // due date
  status: text("status").notNull().default("todo"), // todo | in_progress | done
  impact: text("impact"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// ─── Normalisation Layer ──────────────────────────────────────────────────

// Canonical item definitions pulled from the "Item Costing" Google Sheet tab.
// Each row = one sellable item in its canonical sheet spelling + all known cost columns.
export const dimCostingItem = pgTable("dim_costing_item", {
  id: serial("id").primaryKey(),
  // Exact name as it appears in col B of the sheet (trimmed)
  canonicalName: text("canonicalName").notNull().unique(),
  // Brand banner this item sits under in the sheet — the authoritative brand source.
  // POS categoryName cannot be used: a product moves category when it goes on offer.
  brand: text("brand").notNull().default(BRAND_DEFAULT),
  category: text("category"),                    // section header from sheet (e.g. "Pizzas")
  itemType: text("itemType"),                    // "pizza" | "solo_meal" | "simple"
  // Costs pulled from the sheet (null = not present in that column)
  cost8inch: numeric("cost8inch",   { precision: 10, scale: 2 }),
  cost12inch: numeric("cost12inch", { precision: 10, scale: 2 }),
  cost16inch: numeric("cost16inch", { precision: 10, scale: 2 }),
  costSolo: numeric("costSolo",     { precision: 10, scale: 2 }),
  costMeal: numeric("costMeal",     { precision: 10, scale: 2 }),
  // Simple / default cost (col D for simple items; 12" cost for pizzas)
  primaryCost: numeric("primaryCost", { precision: 10, scale: 2 }),
  sellingPriceHydePark:    numeric("sellingPriceHydePark",    { precision: 10, scale: 2 }),
  sellingPriceGrandArcade: numeric("sellingPriceGrandArcade", { precision: 10, scale: 2 }),
  lastSyncedAt: timestamp("lastSyncedAt").defaultNow(),
  createdAt:   timestamp("createdAt").notNull().defaultNow(),
  updatedAt:   timestamp("updatedAt").notNull().defaultNow(),
})

// Maps every distinct (trimmed) POS itemName → a canonical dim_costing_item row.
// Populated by the normalisation ETL; new unknowns land here with reviewed=false.
export const itemAlias = pgTable("item_alias", {
  id: serial("id").primaryKey(),
  // The raw POS name after basic trim (not lowercased — preserves original for display)
  normalizedRaw: text("normalizedRaw").notNull().unique(),
  // FK to dim_costing_item — null means no match found yet (goes to review queue)
  canonicalId: integer("canonicalId").references(() => dimCostingItem.id, { onDelete: "set null" }),
  // Decoded size for pizzas ("8" | "12" | "16" | null)
  size: text("size"),
  // Variant context ("solo" | "meal" | null)
  variant: text("variant"),
  // How the match was made
  matchMethod: text("matchMethod"),  // "exact" | "initials" | "prefix" | "non_pizza_exact" | "non_pizza_fuzzy" | "manual" | "unmatched"
  // 1.0 = deterministic; <1.0 = fuzzy/needs review; null = unmatched
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  // false = in review queue; true = a human confirmed this mapping
  reviewed: boolean("reviewed").notNull().default(false),
  // Resolved Product_Master_ID — the permanent identity the spec joins on (§3).
  // Populated by the product-master ETL from (canonicalId, size, variant).
  productMasterId: integer("productMasterId"),
  // POS categoryName that was seen on this raw name (helps classify new names)
  posCategoryName: text("posCategoryName"),
  // Whether this row is a modifier/component (£0 line, not a sellable item)
  isModifier: boolean("isModifier").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => [
  index("item_alias_canonical_idx").on(t.canonicalId),
  index("item_alias_reviewed_idx").on(t.reviewed),
])

// ─── Pricing Engine (separate Google workbook) ─────────────────────────────
// Per-store COMMERCIAL SETTINGS block at the top of each store tab. Read-only:
// the sheet is the source of truth for now, so there is no UI to edit these.
export const pricingSettings = pgTable("pricing_settings", {
  id: serial("id").primaryKey(),
  // Matches orders.location values: "Hyde Park" | "Grand Arcade"
  store: text("store").notNull().unique(),
  instoreTargetFcPct:    numeric("instoreTargetFcPct",    { precision: 6, scale: 4 }),
  platformTargetFcPct:   numeric("platformTargetFcPct",   { precision: 6, scale: 4 }),
  platformCommissionPct: numeric("platformCommissionPct", { precision: 6, scale: 4 }),
  mealUplift:            numeric("mealUplift",            { precision: 10, scale: 2 }),
  amberTolerancePct:     numeric("amberTolerancePct",     { precision: 6, scale: 4 }),
  lastSyncedAt: timestamp("lastSyncedAt").defaultNow(),
  updatedAt:    timestamp("updatedAt").notNull().defaultNow(),
})

// One row per (store × pricing section × product). Each store tab carries the same
// product list twice — once under INSTORE PRICING, once under PLATFORM PRICING
// (platform prices are marked up to absorb commission).
export const pricingItem = pgTable("pricing_item", {
  id: serial("id").primaryKey(),
  store: text("store").notNull(),
  priceMode: text("priceMode").notNull(),          // "instore" | "platform"
  category: text("category"),                       // section header, e.g. "PIZZA"
  productName: text("productName").notNull(),       // exact col-A text from the sheet
  // normalizeRaw() of productName — the join key to item_alias / dim_costing_item
  normalizedName: text("normalizedName").notNull(),
  // Resolved costing item; null = no match yet (surfaces in the review queue)
  canonicalId: integer("canonicalId").references(() => dimCostingItem.id, { onDelete: "set null" }),
  salesVolume: text("salesVolume"),                 // "High" | "Medium" | "Low" (emoji stripped)
  soloCost:  numeric("soloCost",  { precision: 10, scale: 4 }),
  mealCost:  numeric("mealCost",  { precision: 10, scale: 4 }),
  // Authoritative for margin reporting — what customers are charged today.
  currentSoloPrice: numeric("currentSoloPrice", { precision: 10, scale: 2 }),
  currentMealPrice: numeric("currentMealPrice", { precision: 10, scale: 2 }),
  soloFcPct: numeric("soloFcPct", { precision: 6, scale: 4 }),
  mealFcPct: numeric("mealFcPct", { precision: 6, scale: 4 }),
  targetFcStatus: text("targetFcStatus"),            // "On Target" | "Near Target" | "Above Target"
  competitorPrice: numeric("competitorPrice", { precision: 10, scale: 2 }),
  // Pricing-review signals only — these never feed a reported margin.
  recommendation: text("recommendation"),            // "Keep" | "Increase" | "Review Recipe" | …
  reason: text("reason"),
  recommendedSoloPrice: numeric("recommendedSoloPrice", { precision: 10, scale: 2 }),
  recommendedMealPrice: numeric("recommendedMealPrice", { precision: 10, scale: 2 }),
  finalSoloPrice: numeric("finalSoloPrice", { precision: 10, scale: 2 }),
  finalMealPrice: numeric("finalMealPrice", { precision: 10, scale: 2 }),
  newSoloFcPct: numeric("newSoloFcPct", { precision: 6, scale: 4 }),
  newMealFcPct: numeric("newMealFcPct", { precision: 6, scale: 4 }),
  lastSyncedAt: timestamp("lastSyncedAt").defaultNow(),
  updatedAt:    timestamp("updatedAt").notNull().defaultNow(),
}, (t) => [
  index("pricing_item_norm_idx").on(t.normalizedName),
  index("pricing_item_store_mode_idx").on(t.store, t.priceMode),
  index("pricing_item_canonical_idx").on(t.canonicalId),
])

// ─── Analytics Settings (owner-editable, spec §5) ──────────────────────────
// Generic key/value so new settings need no migration. Scope is (key, store,
// channel): a NULL store means "applies to every store", a NULL channel means
// "not channel-specific". The catalog in lib/settings/catalog.ts defines which
// keys exist, their labels, units, groups and defaults — the DB only stores
// values the owner has actually overridden.
export const analyticsSettings = pgTable("analytics_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  store: text("store"),        // "Hyde Park" | "Grand Arcade" | null = all stores
  channel: text("channel"),    // "ubereats" | "deliveroo" | "justeat" | null = n/a
  value: text("value").notNull(),   // stored as text; the catalog says how to parse
  updatedBy: text("updatedBy"),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => [
  index("analytics_settings_key_idx").on(t.key),
])

// Manual driver shift log — §9 requires driver HOURS to cost Hyde Park deliveries,
// and no upstream system provides them, so they are entered by hand.
export const driverShift = pgTable("driver_shift", {
  id: serial("id").primaryKey(),
  store: text("store").notNull(),
  driverName: text("driverName").notNull(),
  shiftDate: date("shiftDate").notNull(),
  startTime: timestamp("startTime").notNull(),
  finishTime: timestamp("finishTime").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => [
  index("driver_shift_date_idx").on(t.shiftDate),
  index("driver_shift_driver_idx").on(t.driverName),
])

// ─── Product Master (spec §3) ──────────────────────────────────────────────
// The single identity table linking EPOS, costing, pricing and analytics.
//
// dim_costing_item is WIDE — one row per product carrying cost8inch/cost12inch/
// cost16inch/costSolo/costMeal columns. The spec requires each sellable variant to
// be *independently identifiable* ("Zinger Burger - Solo and Zinger Burger - Meal
// must be independently identifiable"), so this table is the LONG form: one row per
// (costing item × size/variant that actually carries a cost), each with a permanent
// Product_Master_ID that never changes as sheet names drift.
export const productMaster = pgTable("product_master", {
  id: serial("id").primaryKey(),
  // Stable business key: canonical name + variant discriminator. Survives re-imports.
  productKey: text("productKey").notNull().unique(),
  canonicalName: text("canonicalName").notNull(),   // clean business-facing name
  displayName: text("displayName").notNull(),       // e.g. "Zinger Burger - Meal"
  brand: text("brand").notNull().default(BRAND_DEFAULT),
  storeApplicability: text("storeApplicability").notNull().default("both"), // both|Hyde Park|Grand Arcade
  category: text("category"),
  // solo | meal | deal | side | drink | addon | modifier | meal_upgrade | other
  productType: text("productType").notNull().default("other"),
  size: text("size"),        // "8" | "12" | "16" | null
  variant: text("variant"),  // "solo" | "meal" | null
  costingItemId: integer("costingItemId").references(() => dimCostingItem.id, { onDelete: "set null" }),
  currentCost: numeric("currentCost", { precision: 10, scale: 4 }),
  // costed | cost_missing | mapping_required  (§3 "Costing Status")
  costingStatus: text("costingStatus").notNull().default("cost_missing"),
  currentPrice: numeric("currentPrice", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => [
  index("product_master_brand_idx").on(t.brand),
  index("product_master_type_idx").on(t.productType),
  index("product_master_costing_idx").on(t.costingItemId),
  index("product_master_status_idx").on(t.costingStatus),
])

// ─── Offer setup records (spec §10) ────────────────────────────────────────
// "Every meaningful offer has an Offer ID and setup record."
//
// The POS gives us discounted lines but never says WHO funded the discount, and the
// generic "OFFERS" category carries no per-offer identity. Both are owner-entered
// master data — without them §10's contribution and incrementality cannot be computed,
// only estimated.
export const offer = pgTable("offer", {
  id: serial("id").primaryKey(),
  offerId: text("offerId").notNull().unique(),      // e.g. UBER-20OFF-AUG26
  name: text("name").notNull(),                      // e.g. "20% Uber"
  brand: text("brand"),
  store: text("store"),                              // null = all stores
  channel: text("channel"),                          // null = all channels
  startDate: date("startDate").notNull(),
  endDate: date("endDate"),
  offerType: text("offerType"),                      // percent | bogof | bundle | fixed
  discountPercent: numeric("discountPercent", { precision: 5, scale: 2 }),
  minSpend: numeric("minSpend", { precision: 10, scale: 2 }),
  // The split that decides whether an offer costs Raja's anything at all.
  rajasFundingPct: numeric("rajasFundingPct", { precision: 5, scale: 2 }).default("100"),
  platformFundingPct: numeric("platformFundingPct", { precision: 5, scale: 2 }).default("0"),
  // POS categoryName(s) this offer shows up under, so measured lines can be attributed.
  posCategories: text("posCategories"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (t) => [
  index("offer_dates_idx").on(t.startDate, t.endDate),
])

// Which Product_Master_IDs an offer applies to (§10 "Applicable Products").
export const offerProduct = pgTable("offer_product", {
  id: serial("id").primaryKey(),
  offerRowId: integer("offerRowId").notNull().references(() => offer.id, { onDelete: "cascade" }),
  productMasterId: integer("productMasterId").references(() => productMaster.id, { onDelete: "cascade" }),
}, (t) => [
  index("offer_product_offer_idx").on(t.offerRowId),
])
