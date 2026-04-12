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
} from "./services/profitEngine";
import { createReport } from "./services/reportGenerator";
import {
  getSchedulerStatus,
  startScheduler,
  triggerImmediateSync,
  updateSchedulerInterval,
} from "./services/scheduler";
import { ingestCpscRecalls, ingestNhtsaRecalls } from "./services/recallIngestion";

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

  triggerSync: protectedProcedure
    .input(z.object({ agency: z.enum(["CPSC", "NHTSA", "ALL"]).default("ALL") }))
    .mutation(async ({ input }) => {
      if (input.agency === "CPSC") {
        const result = await ingestCpscRecalls();
        return { success: true, result };
      } else if (input.agency === "NHTSA") {
        const result = await ingestNhtsaRecalls();
        return { success: true, result };
      } else {
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

// ─── App Router ───────────────────────────────────────────────────────────────

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
});

export type AppRouter = typeof appRouter;
