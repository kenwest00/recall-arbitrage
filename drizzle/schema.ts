import {
  boolean,
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// ─── Core user table ────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── User settings ───────────────────────────────────────────────────────────
export const userSettings = mysqlTable("user_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  refreshIntervalHours: int("refreshIntervalHours").default(24).notNull(),
  profitThreshold: decimal("profitThreshold", { precision: 5, scale: 2 }).default("10.00").notNull(),
  preferredAgencies: json("preferredAgencies").$type<string[]>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

// ─── Recalls ─────────────────────────────────────────────────────────────────
export const recalls = mysqlTable("recalls", {
  id: int("id").autoincrement().primaryKey(),
  recallNumber: varchar("recallNumber", { length: 64 }).notNull().unique(),
  agency: mysqlEnum("agency", ["CPSC", "NHTSA"]).notNull(),
  title: text("title").notNull(),
  productName: text("productName"),
  manufacturer: text("manufacturer"),
  category: varchar("category", { length: 128 }),
  description: text("description"),
  hazard: text("hazard"),
  remedy: text("remedy"),
  rawNotice: text("rawNotice"),
  refundValue: decimal("refundValue", { precision: 10, scale: 2 }),
  refundExtracted: boolean("refundExtracted").default(false).notNull(),
  refundNotes: text("refundNotes"),
  recallDate: timestamp("recallDate"),
  recallUrl: text("recallUrl"),
  imageUrl: text("imageUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Recall = typeof recalls.$inferSelect;
export type InsertRecall = typeof recalls.$inferInsert;

// ─── Pricing data (per platform listing) ─────────────────────────────────────
export const pricingData = mysqlTable("pricing_data", {
  id: int("id").autoincrement().primaryKey(),
  recallId: int("recallId").notNull(),
  platform: mysqlEnum("platform", ["ebay", "amazon", "facebook", "craigslist", "ebaymotors", "rockauto", "carpart", "lkq"]).notNull(),
  listingTitle: text("listingTitle"),
  price: decimal("price", { precision: 10, scale: 2 }),
  condition: varchar("condition", { length: 64 }),
  listingUrl: text("listingUrl"),
  quantity: int("quantity").default(1),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});

export type PricingData = typeof pricingData.$inferSelect;
export type InsertPricingData = typeof pricingData.$inferInsert;

// ─── MSRP data ────────────────────────────────────────────────────────────────
export const msrpData = mysqlTable("msrp_data", {
  id: int("id").autoincrement().primaryKey(),
  recallId: int("recallId").notNull(),
  source: varchar("source", { length: 64 }),
  msrpPrice: decimal("msrpPrice", { precision: 10, scale: 2 }),
  productUrl: text("productUrl"),
  productTitle: text("productTitle"),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
});

export type MsrpData = typeof msrpData.$inferSelect;
export type InsertMsrpData = typeof msrpData.$inferInsert;

// ─── Profit analysis (aggregated per recall) ──────────────────────────────────
export const profitAnalysis = mysqlTable("profit_analysis", {
  id: int("id").autoincrement().primaryKey(),
  recallId: int("recallId").notNull().unique(),
  avgUsedPrice: decimal("avgUsedPrice", { precision: 10, scale: 2 }),
  ebayAvgPrice: decimal("ebayAvgPrice", { precision: 10, scale: 2 }),
  amazonAvgPrice: decimal("amazonAvgPrice", { precision: 10, scale: 2 }),
  fbAvgPrice: decimal("fbAvgPrice", { precision: 10, scale: 2 }),
  ebayCount: int("ebayCount").default(0),
  amazonCount: int("amazonCount").default(0),
  fbCount: int("fbCount").default(0),
  totalCount: int("totalCount").default(0),
  refundValue: decimal("refundValue", { precision: 10, scale: 2 }),
  msrpValue: decimal("msrpValue", { precision: 10, scale: 2 }),
  profitMargin: decimal("profitMargin", { precision: 8, scale: 4 }),
  profitAmount: decimal("profitAmount", { precision: 10, scale: 2 }),
  meetsThreshold: boolean("meetsThreshold").default(false),
  calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
});

export type ProfitAnalysis = typeof profitAnalysis.$inferSelect;
export type InsertProfitAnalysis = typeof profitAnalysis.$inferInsert;

// ─── Sync log ─────────────────────────────────────────────────────────────────
export const syncLog = mysqlTable("sync_log", {
  id: int("id").autoincrement().primaryKey(),
  agency: mysqlEnum("agency", ["CPSC", "NHTSA", "ALL"]).notNull(),
  status: mysqlEnum("status", ["running", "success", "error"]).default("running").notNull(),
  recordsIngested: int("recordsIngested").default(0),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type SyncLog = typeof syncLog.$inferSelect;
export type InsertSyncLog = typeof syncLog.$inferInsert;

// ─── Reports ──────────────────────────────────────────────────────────────────
export const reports = mysqlTable("reports", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  filters: json("filters").$type<{
    agency?: string[];
    dateFrom?: string;
    dateTo?: string;
    minProfitThreshold?: number;
    category?: string;
  }>(),
  status: mysqlEnum("status", ["pending", "ready", "error"]).default("pending").notNull(),
  format: mysqlEnum("format", ["csv", "pdf"]).notNull(),
  fileUrl: text("fileUrl"),
  rowCount: int("rowCount").default(0),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Report = typeof reports.$inferSelect;
export type InsertReport = typeof reports.$inferInsert;
