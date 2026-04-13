import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getDashboardStats,
  getRecallById,
  getRecentSyncLogs,
  getUserReports,
  getUserSettings,
  listRecalls,
  upsertUserSettings,
} from "./db";
import {
  calculateProfitForRecall,
  fetchAndStorePricingForRecall,
  refreshAllProfitAnalysis,
} from "./services/profitEngine";
import { createReport } from "./services/reportGenerator";
import {
  getSchedulerStatus,
  startScheduler,
  triggerImmediateSync,
  updateSchedulerInterval,
} from "./services/scheduler";
import { ingestCpscRecalls, ingestNhtsaRecalls } from "./services/recallIngestion";
import { getDb } from "./db";
import { dealTracker } from "../drizzle/schema";
import { eq, desc, sum, count } from "drizzle-orm";

// ─── Recalls Router ───────────────────────────────────────────────────────────

const recallsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        agency: z.array(z.string()).optional(),
        search: z.string().optional(),
        category: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        onlyWithRefund: z.boolean().optional(),
        onlyOpportunities: z.boolean().optional(),
        profitThreshold: z.number().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      return listRecalls(input);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const result = await getRecallById(input.id);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Recall not found" });
      return result;
    }),

  refreshPricing: protectedProcedure
    .input(z.object({ recallId: z.number() }))
    .mutation(async ({ input }) => {
      const result = await getRecallById(input.recallId);
      if (!result) throw new TRPCError({ code: "NOT_FOUND" });

      const productQuery = result.recall.productName || result.recall.title || "";
      await fetchAndStorePricingForRecall(input.recallId, productQuery);
      const analysis = await calculateProfitForRecall(input.recallId);
      return { success: true, analysis };
    }),
});

// ─── Analysis Router ──────────────────────────────────────────────────────────

const analysisRouter = router({
  dashboard: publicProcedure
    .input(z.object({ profitThreshold: z.number().default(10) }).optional())
    .query(async ({ input }) => {
      return getDashboardStats(input?.profitThreshold ?? 10);
    }),

  opportunities: publicProcedure
    .input(
      z.object({
        profitThreshold: z.number().default(10),
        agency: z.array(z.string()).optional(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input }) => {
      return listRecalls({
        onlyOpportunities: true,
        onlyWithRefund: true, // Opportunities are always refund-only
        profitThreshold: input.profitThreshold,
        agency: input.agency,
        limit: input.limit,
      });
    }),
});

// ─── Settings Router ──────────────────────────────────────────────────────────

const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getUserSettings(ctx.user.id);
    return (
      settings || {
        refreshIntervalHours: 24,
        profitThreshold: "10.00",
        preferredAgencies: ["CPSC", "NHTSA"],
      }
    );
  }),

  update: protectedProcedure
    .input(
      z.object({
        refreshIntervalHours: z.number().min(1).max(168).optional(),
        profitThreshold: z.number().min(0).max(100).optional(),
        preferredAgencies: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updateData: Record<string, unknown> = {};

      if (input.refreshIntervalHours !== undefined) {
        updateData.refreshIntervalHours = input.refreshIntervalHours;
        updateSchedulerInterval(input.refreshIntervalHours);
      }

      if (input.profitThreshold !== undefined) {
        updateData.profitThreshold = String(input.profitThreshold);
      }

      if (input.preferredAgencies !== undefined) {
        updateData.preferredAgencies = input.preferredAgencies;
      }

      await upsertUserSettings(ctx.user.id, updateData);
      return { success: true };
    }),
});

// ─── Reports Router ───────────────────────────────────────────────────────────

const reportsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return getUserReports(ctx.user.id);
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(256),
        format: z.enum(["csv", "pdf"]),
        filters: z
          .object({
            agency: z.array(z.string()).optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
            minProfitThreshold: z.number().optional(),
            category: z.string().optional(),
            onlyWithRefund: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createReport(
        ctx.user.id,
        input.name,
        input.filters || {},
        input.format
      );
      return result;
    }),
});

// ─── Sync Router ──────────────────────────────────────────────────────────────

const syncRouter = router({
  status: publicProcedure.query(async () => {
    const scheduler = getSchedulerStatus();
    const logs = await getRecentSyncLogs(5);
    return { scheduler, recentLogs: logs };
  }),

  logs: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return getRecentSyncLogs(input.limit);
    }),

  triggerSync: publicProcedure
    .input(z.object({ agency: z.enum(["CPSC", "NHTSA", "ALL"]).default("ALL") }))
    .mutation(async ({ input }) => {
      if (input.agency === "CPSC") {
        const result = await ingestCpscRecalls();
        // Run pricing + profit analysis after ingestion
        refreshAllProfitAnalysis().catch((err) =>
          console.error("[triggerSync] Profit analysis failed:", err)
        );
        return { success: true, result };
      } else if (input.agency === "NHTSA") {
        const result = await ingestNhtsaRecalls();
        // Run pricing + profit analysis after ingestion
        refreshAllProfitAnalysis().catch((err) =>
          console.error("[triggerSync] Profit analysis failed:", err)
        );
        return { success: true, result };
      } else {
        // triggerImmediateSync now runs the full pipeline (recalls + pricing + profit)
        await triggerImmediateSync();
        return { success: true, result: { message: "Full sync triggered" } };
      }
    }),

  updateInterval: protectedProcedure
    .input(z.object({ hours: z.number().min(1).max(168) }))
    .mutation(async ({ ctx, input }) => {
      updateSchedulerInterval(input.hours);
      await upsertUserSettings(ctx.user.id, { refreshIntervalHours: input.hours });
      return { success: true };
    }),
});

// ─── Deal Tracker Router ───────────────────────────────────────────────────────────

const dealTrackerRouter = router({
  getAll: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    return db.select().from(dealTracker).orderBy(desc(dealTracker.createdAt));
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [deal] = await db.select().from(dealTracker).where(eq(dealTracker.id, input.id)).limit(1);
      if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
      return deal;
    }),

  create: publicProcedure
    .input(
      z.object({
        recallId: z.number(),
        recallNumber: z.string().optional(),
        productName: z.string().optional(),
        manufacturer: z.string().optional(),
        refundValue: z.number().optional(),
        purchasePrice: z.number(),
        shippingCost: z.number().default(0),
        purchasePlatform: z.enum(["ebay", "facebook", "craigslist", "amazon", "other"]).optional(),
        purchaseUrl: z.string().optional(),
        purchaseDate: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const totalCost = input.purchasePrice + (input.shippingCost ?? 0);
      const netProfit = input.refundValue ? input.refundValue - totalCost : null;
      const result = await db.insert(dealTracker).values({
        recallId: input.recallId,
        recallNumber: input.recallNumber,
        productName: input.productName,
        manufacturer: input.manufacturer,
        refundValue: input.refundValue !== undefined ? String(input.refundValue) : null,
        purchasePrice: String(input.purchasePrice),
        shippingCost: String(input.shippingCost ?? 0),
        totalCost: String(totalCost),
        purchasePlatform: input.purchasePlatform,
        purchaseUrl: input.purchaseUrl,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : new Date(),
        claimStatus: "not_started",
        netProfit: netProfit !== null ? String(netProfit) : null,
        notes: input.notes,
      });
      const insertId = Number((result as unknown as { insertId: number }).insertId);
      return { success: true, id: insertId };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        purchasePrice: z.number().optional(),
        shippingCost: z.number().optional(),
        purchasePlatform: z.enum(["ebay", "facebook", "craigslist", "amazon", "other"]).optional(),
        purchaseUrl: z.string().optional(),
        purchaseDate: z.string().optional(),
        claimStatus: z.enum(["not_started", "submitted", "pending", "approved", "received", "denied"]).optional(),
        claimSubmittedDate: z.string().optional(),
        refundReceivedDate: z.string().optional(),
        refundReceivedAmount: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [existing] = await db.select().from(dealTracker).where(eq(dealTracker.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      const purchasePrice = input.purchasePrice !== undefined ? input.purchasePrice : parseFloat(String(existing.purchasePrice ?? 0));
      const shippingCost = input.shippingCost !== undefined ? input.shippingCost : parseFloat(String(existing.shippingCost ?? 0));
      const totalCost = purchasePrice + shippingCost;
      const refundValue = existing.refundValue ? parseFloat(String(existing.refundValue)) : null;
      const refundReceived = input.refundReceivedAmount !== undefined ? input.refundReceivedAmount : (existing.refundReceivedAmount ? parseFloat(String(existing.refundReceivedAmount)) : null);
      const netProfit = refundReceived !== null ? refundReceived - totalCost : (refundValue !== null ? refundValue - totalCost : null);

      const updateData: Record<string, unknown> = {
        totalCost: String(totalCost),
        netProfit: netProfit !== null ? String(netProfit) : null,
      };
      if (input.purchasePrice !== undefined) updateData.purchasePrice = String(input.purchasePrice);
      if (input.shippingCost !== undefined) updateData.shippingCost = String(input.shippingCost);
      if (input.purchasePlatform !== undefined) updateData.purchasePlatform = input.purchasePlatform;
      if (input.purchaseUrl !== undefined) updateData.purchaseUrl = input.purchaseUrl;
      if (input.purchaseDate !== undefined) updateData.purchaseDate = new Date(input.purchaseDate);
      if (input.claimStatus !== undefined) updateData.claimStatus = input.claimStatus;
      if (input.claimSubmittedDate !== undefined) updateData.claimSubmittedDate = new Date(input.claimSubmittedDate);
      if (input.refundReceivedDate !== undefined) updateData.refundReceivedDate = new Date(input.refundReceivedDate);
      if (input.refundReceivedAmount !== undefined) updateData.refundReceivedAmount = String(input.refundReceivedAmount);
      if (input.notes !== undefined) updateData.notes = input.notes;

      await db.update(dealTracker).set(updateData).where(eq(dealTracker.id, input.id));
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(dealTracker).where(eq(dealTracker.id, input.id));
      return { success: true };
    }),

  getSummary: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const deals = await db.select().from(dealTracker);
    const totalInvested = deals.reduce((acc, d) => acc + parseFloat(String(d.totalCost ?? 0)), 0);
    const pendingRefunds = deals
      .filter((d) => ["submitted", "pending", "approved"].includes(d.claimStatus ?? ""))
      .reduce((acc, d) => acc + parseFloat(String(d.refundValue ?? 0)), 0);
    const profitBanked = deals
      .filter((d) => d.claimStatus === "received")
      .reduce((acc, d) => acc + parseFloat(String(d.netProfit ?? 0)), 0);
    const avgMargin = deals.length > 0
      ? deals
          .filter((d) => d.refundValue && d.totalCost)
          .reduce((acc, d) => {
            const rv = parseFloat(String(d.refundValue ?? 0));
            const tc = parseFloat(String(d.totalCost ?? 0));
            return acc + (rv > 0 ? ((rv - tc) / rv) * 100 : 0);
          }, 0) / Math.max(1, deals.filter((d) => d.refundValue && d.totalCost).length)
      : 0;
    return {
      totalDeals: deals.length,
      totalInvested: Math.round(totalInvested * 100) / 100,
      pendingRefunds: Math.round(pendingRefunds * 100) / 100,
      profitBanked: Math.round(profitBanked * 100) / 100,
      avgMargin: Math.round(avgMargin * 10) / 10,
    };
  }),
});

// ─── App Router ──────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  recalls: recallsRouter,
  analysis: analysisRouter,
  settings: settingsRouter,
  reports: reportsRouter,
  sync: syncRouter,
  deals: dealTrackerRouter,
});

export type AppRouter = typeof appRouter;
