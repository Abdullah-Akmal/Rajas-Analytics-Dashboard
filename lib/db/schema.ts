import { boolean, date, index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

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
