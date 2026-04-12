import { and, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  InsertUserSettings,
  msrpData,
  pricingData,
  profitAnalysis,
  recalls,
  reports,
  syncLog,
  userSettings,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value !== undefined) {
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    }
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }

  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── User Settings ────────────────────────────────────────────────────────────

export async function getUserSettings(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertUserSettings(userId: number, settings: Partial<InsertUserSettings>) {
  const db = await getDb();
  if (!db) return;

  const existing = await getUserSettings(userId);
  if (existing) {
    await db.update(userSettings).set(settings).where(eq(userSettings.userId, userId));
  } else {
    await db.insert(userSettings).values({
      userId,
      refreshIntervalHours: settings.refreshIntervalHours ?? 24,
      profitThreshold: settings.profitThreshold ?? "10.00",
      preferredAgencies: settings.preferredAgencies ?? ["CPSC", "NHTSA"],
    });
  }
}

// ─── Recalls ─────────────────────────────────────────────────────────────────

export interface RecallListFilters {
  agency?: string[];
  search?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  onlyWithRefund?: boolean;
  onlyOpportunities?: boolean;
  profitThreshold?: number;
  limit?: number;
  offset?: number;
}

export async function listRecalls(filters: RecallListFilters = {}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const conditions = [eq(recalls.isActive, true)];

  if (filters.agency && filters.agency.length > 0) {
    conditions.push(inArray(recalls.agency, filters.agency as ("CPSC" | "NHTSA")[]));
  }

  if (filters.search) {
    conditions.push(
      or(
        ilike(recalls.title, `%${filters.search}%`),
        ilike(recalls.productName, `%${filters.search}%`),
        ilike(recalls.manufacturer, `%${filters.search}%`),
        ilike(recalls.recallNumber, `%${filters.search}%`)
      )!
    );
  }

  if (filters.category) {
    conditions.push(ilike(recalls.category, `%${filters.category}%`));
  }

  if (filters.dateFrom) {
    conditions.push(gte(recalls.recallDate, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    conditions.push(lte(recalls.recallDate, new Date(filters.dateTo)));
  }

  if (filters.onlyWithRefund) {
    conditions.push(eq(recalls.refundExtracted, true));
  }

  const rows = await db
    .select({
      id: recalls.id,
      recallNumber: recalls.recallNumber,
      agency: recalls.agency,
      title: recalls.title,
      productName: recalls.productName,
      manufacturer: recalls.manufacturer,
      category: recalls.category,
      recallDate: recalls.recallDate,
      refundValue: recalls.refundValue,
      refundExtracted: recalls.refundExtracted,
      refundNotes: recalls.refundNotes,
      recallUrl: recalls.recallUrl,
      imageUrl: recalls.imageUrl,
      hazard: recalls.hazard,
      avgUsedPrice: profitAnalysis.avgUsedPrice,
      ebayAvgPrice: profitAnalysis.ebayAvgPrice,
      amazonAvgPrice: profitAnalysis.amazonAvgPrice,
      fbAvgPrice: profitAnalysis.fbAvgPrice,
      totalCount: profitAnalysis.totalCount,
      profitMargin: profitAnalysis.profitMargin,
      profitAmount: profitAnalysis.profitAmount,
      meetsThreshold: profitAnalysis.meetsThreshold,
      calculatedAt: profitAnalysis.calculatedAt,
    })
    .from(recalls)
    .leftJoin(profitAnalysis, eq(recalls.id, profitAnalysis.recallId))
    .where(and(...conditions))
    .orderBy(desc(recalls.recallDate))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  // Post-filter by profit threshold if needed
  const filtered = filters.onlyOpportunities
    ? rows.filter((r) => {
        const margin = r.profitMargin ? parseFloat(String(r.profitMargin)) : null;
        const threshold = filters.profitThreshold ?? 10;
        return margin !== null && margin >= threshold;
      })
    : rows;

  return { rows: filtered, total: filtered.length };
}

export async function getRecallById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const [recall] = await db.select().from(recalls).where(eq(recalls.id, id)).limit(1);
  if (!recall) return null;

  const [analysis] = await db
    .select()
    .from(profitAnalysis)
    .where(eq(profitAnalysis.recallId, id))
    .limit(1);

  const pricing = await db.select().from(pricingData).where(eq(pricingData.recallId, id));

  const msrp = await db.select().from(msrpData).where(eq(msrpData.recallId, id));

  return { recall, analysis: analysis || null, pricing, msrp };
}

// ─── Sync Logs ────────────────────────────────────────────────────────────────

export async function getRecentSyncLogs(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(syncLog).orderBy(desc(syncLog.startedAt)).limit(limit);
}

export async function getLastSuccessfulSync() {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(syncLog)
    .where(eq(syncLog.status, "success"))
    .orderBy(desc(syncLog.completedAt))
    .limit(1);
  return row || null;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function getUserReports(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(desc(reports.createdAt))
    .limit(50);
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getDashboardStats(thresholdPercent = 10) {
  const db = await getDb();
  if (!db) return null;

  // Count total active recalls directly from the recalls table
  const allRecalls = await db
    .select({
      id: recalls.id,
      refundExtracted: recalls.refundExtracted,
    })
    .from(recalls)
    .where(eq(recalls.isActive, true));

  const totalRecallCount = allRecalls.filter((r) => r.refundExtracted).length; // Only count refund-eligible recalls
  const withRefundCount = totalRecallCount; // All tracked recalls are refund-eligible

  // Profit analysis (may be empty if pricing hasn't been fetched yet)
  const allAnalysis = await db.select().from(profitAnalysis);

  const opportunities = allAnalysis.filter((a) => {
    const margin = a.profitMargin ? parseFloat(String(a.profitMargin)) : null;
    return margin !== null && margin >= thresholdPercent;
  });

  const margins = allAnalysis
    .map((a) => (a.profitMargin ? parseFloat(String(a.profitMargin)) : null))
    .filter((m): m is number => m !== null);

  const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : null;

  const lastSync = await getLastSuccessfulSync();

  return {
    totalRecalls: totalRecallCount,
    opportunitiesFound: opportunities.length,
    avgMargin: avgMargin ? parseFloat(avgMargin.toFixed(1)) : null,
    lastSyncAt: lastSync?.completedAt || null,
    withRefundValue: withRefundCount,
  };
}
