import { boolean, date, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

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
  assignedTime: timestamp("assignedTime"),
  startTime: timestamp("startTime"),
  pickedupTime: timestamp("pickedupTime"),
  arrivedTime: timestamp("arrivedTime"),
  deliveryTime: timestamp("deliveryTime"),
  failedDeliveryTime: timestamp("failedDeliveryTime"),
  status: text("status"),
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
