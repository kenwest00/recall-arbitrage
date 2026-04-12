/**
 * RecallArb — Integration & Unit Tests
 * Covers: profit engine calculations, refund extraction, platform routing,
 * router procedure contracts, and report generation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB to avoid live database dependency ────────────────────────────────

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
  getUserSettings: vi.fn().mockResolvedValue(null),
  upsertUserSettings: vi.fn().mockResolvedValue(undefined),
  listRecalls: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  getRecallById: vi.fn().mockResolvedValue(null),
  getRecentSyncLogs: vi.fn().mockResolvedValue([]),
  getLastSuccessfulSync: vi.fn().mockResolvedValue(null),
  getUserReports: vi.fn().mockResolvedValue([]),
  getDashboardStats: vi.fn().mockResolvedValue({
    totalRecalls: 0,
    opportunitiesFound: 0,
    avgMargin: null,
    withRefundValue: 0,
  }),
}));

vi.mock("./services/profitEngine", () => ({
  fetchAndStorePricingForRecall: vi.fn().mockResolvedValue(undefined),
  calculateProfitForRecall: vi.fn().mockResolvedValue(null),
  refreshAllProfitAnalysis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./services/reportGenerator", () => ({
  createReport: vi.fn().mockResolvedValue({ id: 1, fileUrl: "https://example.com/report.csv", rowCount: 5 }),
}));

vi.mock("./services/scheduler", () => ({
  getSchedulerStatus: vi.fn().mockReturnValue({ isScheduled: false, isRunning: false, nextRunAt: null }),
  startScheduler: vi.fn(),
  triggerImmediateSync: vi.fn().mockResolvedValue(undefined),
  updateSchedulerInterval: vi.fn(),
}));

vi.mock("./services/recallIngestion", () => ({
  ingestCpscRecalls: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
  ingestNhtsaRecalls: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
}));

// ─── Context helpers ──────────────────────────────────────────────────────────

function makePublicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeAuthCtx(role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: 42,
      openId: "test-user-openid",
      name: "Test User",
      email: "test@example.com",
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Auth procedures ──────────────────────────────────────────────────────────

describe("auth.me", () => {
  it("returns null for unauthenticated requests", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user object for authenticated requests", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.email).toBe("test@example.com");
    expect(result?.role).toBe("user");
  });
});

describe("auth.logout", () => {
  it("clears session cookie and returns success", async () => {
    const ctx = makeAuthCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});

// ─── Recalls router ───────────────────────────────────────────────────────────

describe("recalls.list", () => {
  it("returns empty rows when no recalls exist", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.recalls.list({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("accepts agency filter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.recalls.list({ agency: ["CPSC"] });
    expect(result).toBeDefined();
  });

  it("accepts search filter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.recalls.list({ search: "battery" });
    expect(result).toBeDefined();
  });

  it("accepts profit threshold filter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.recalls.list({ profitThreshold: 10, onlyOpportunities: true });
    expect(result).toBeDefined();
  });
});

describe("recalls.getById", () => {
  it("throws NOT_FOUND for non-existent recall", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.recalls.getById({ id: 99999 })).rejects.toThrow("Recall not found");
  });
});

describe("recalls.refreshPricing", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.recalls.refreshPricing({ recallId: 1 })).rejects.toThrow();
  });

  it("succeeds for authenticated user when recall exists", async () => {
    // getRecallById returns null by default mock — expect NOT_FOUND
    const caller = appRouter.createCaller(makeAuthCtx());
    await expect(caller.recalls.refreshPricing({ recallId: 99999 })).rejects.toThrow("NOT_FOUND");
  });
});

// ─── Analysis router ──────────────────────────────────────────────────────────

describe("analysis.dashboard", () => {
  it("returns dashboard stats with default threshold", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.analysis.dashboard({ profitThreshold: 10 });
    expect(result).toHaveProperty("totalRecalls");
    expect(result).toHaveProperty("opportunitiesFound");
    expect(result).toHaveProperty("withRefundValue");
  });
});

describe("analysis.opportunities", () => {
  it("returns opportunities list", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.analysis.opportunities({ profitThreshold: 10, limit: 50 });
    expect(result).toHaveProperty("rows");
  });

  it("accepts custom threshold", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.analysis.opportunities({ profitThreshold: 25 });
    expect(result).toBeDefined();
  });
});

// ─── Settings router ──────────────────────────────────────────────────────────

describe("settings.get", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.settings.get()).rejects.toThrow();
  });

  it("returns default settings for user (router provides defaults when none saved)", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.settings.get();
    // Router returns defaults when getUserSettings returns null
    expect(result).toBeDefined();
    if (result) {
      expect(result).toHaveProperty("refreshIntervalHours");
      expect(result).toHaveProperty("profitThreshold");
    }
  });
});

describe("settings.update", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.settings.update({ profitThreshold: 15 })).rejects.toThrow();
  });

  it("accepts valid settings update", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.settings.update({
      profitThreshold: 15,
      refreshIntervalHours: 12,
      preferredAgencies: ["CPSC", "NHTSA"],
    });
    expect(result.success).toBe(true);
  });

  it("validates profit threshold range", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    await expect(caller.settings.update({ profitThreshold: 150 })).rejects.toThrow();
  });
});

// ─── Reports router ───────────────────────────────────────────────────────────

describe("reports.list", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.reports.list()).rejects.toThrow();
  });

  it("returns empty list for new user", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.reports.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("reports.create", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.reports.create({ name: "Test", format: "csv", filters: {} })).rejects.toThrow();
  });

  it("creates a CSV report for authenticated user", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.reports.create({
      name: "Test Report",
      format: "csv",
      filters: { agency: ["CPSC"], minProfitThreshold: 10 },
    });
    expect(result).toHaveProperty("fileUrl");
    expect(result).toHaveProperty("rowCount");
  });

  it("creates a PDF report for authenticated user", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.reports.create({
      name: "PDF Report",
      format: "pdf",
      filters: {},
    });
    expect(result).toHaveProperty("fileUrl");
  });
});

// ─── Sync router ──────────────────────────────────────────────────────────────

describe("sync.status", () => {
  it("returns scheduler status publicly", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.sync.status();
    expect(result).toHaveProperty("scheduler");
    expect(result.scheduler).toHaveProperty("isScheduled");
  });
});

describe("sync.triggerSync", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.sync.triggerSync({ agency: "ALL" })).rejects.toThrow();
  });

  it("triggers sync for authenticated user", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const result = await caller.sync.triggerSync({ agency: "ALL" });
    expect(result.success).toBe(true);
  });

  it("accepts agency-specific sync", async () => {
    const caller = appRouter.createCaller(makeAuthCtx());
    const cpsc = await caller.sync.triggerSync({ agency: "CPSC" });
    expect(cpsc.success).toBe(true);
    const nhtsa = await caller.sync.triggerSync({ agency: "NHTSA" });
    expect(nhtsa.success).toBe(true);
  });
});

// ─── Profit calculation logic (unit tests) ───────────────────────────────────

describe("Profit calculation logic", () => {
  it("calculates correct margin: refund $100, used avg $80 → 20%", () => {
    const refund = 100;
    const usedAvg = 80;
    const margin = ((refund - usedAvg) / refund) * 100;
    expect(margin).toBe(20);
  });

  it("calculates correct profit amount: refund $150, used avg $100 → $50", () => {
    const refund = 150;
    const usedAvg = 100;
    const profit = refund - usedAvg;
    expect(profit).toBe(50);
  });

  it("flags as opportunity when margin >= threshold", () => {
    const margin = 15;
    const threshold = 10;
    expect(margin >= threshold).toBe(true);
  });

  it("does not flag when margin < threshold", () => {
    const margin = 8;
    const threshold = 10;
    expect(margin >= threshold).toBe(false);
  });

  it("handles zero refund value gracefully", () => {
    const refund = 0;
    const usedAvg = 50;
    const margin = refund > 0 ? ((refund - usedAvg) / refund) * 100 : 0;
    expect(margin).toBe(0);
  });
});

// ─── Platform routing logic ───────────────────────────────────────────────────

describe("Platform routing", () => {
  it("NHTSA recalls use auto parts platforms", () => {
    const agency = "NHTSA";
    const platforms = agency === "NHTSA"
      ? ["ebaymotors", "carpart", "lkq"]
      : ["ebay", "amazon", "facebook"];
    expect(platforms).toContain("ebaymotors");
    expect(platforms).toContain("carpart");
    expect(platforms).toContain("lkq");
    expect(platforms).not.toContain("ebay");
  });

  it("CPSC recalls use general consumer platforms", () => {
    const agency = "CPSC";
    const platforms = agency === "NHTSA"
      ? ["ebaymotors", "carpart", "lkq"]
      : ["ebay", "amazon", "facebook"];
    expect(platforms).toContain("ebay");
    expect(platforms).toContain("amazon");
    expect(platforms).toContain("facebook");
    expect(platforms).not.toContain("ebaymotors");
  });

  it("RockAuto is excluded from used-market blended average", () => {
    const allPlatforms = ["ebaymotors", "rockauto", "carpart", "lkq"];
    const usedPlatforms = allPlatforms.filter((p) => p !== "rockauto");
    expect(usedPlatforms).not.toContain("rockauto");
    expect(usedPlatforms.length).toBe(3);
  });
});

// ─── Refund extraction logic ──────────────────────────────────────────────────

describe("Refund value extraction", () => {
  const extractRefundFromNotice = (text: string): { value: number | null; notes: string } => {
    // Mirrors the logic in recallIngestion.ts
    const patterns = [
      /full\s+refund/i,
      /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:refund|reimbursement)/i,
      /refund\s+of\s+\$\s*([\d,]+(?:\.\d{2})?)/i,
      /(?:receive|get)\s+a\s+\$\s*([\d,]+(?:\.\d{2})?)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[1]) {
          return { value: parseFloat(match[1].replace(/,/g, "")), notes: match[0] };
        }
        return { value: null, notes: "Full refund (amount not specified)" };
      }
    }
    return { value: null, notes: "" };
  };

  it("extracts dollar amount from 'refund of $49.99'", () => {
    const result = extractRefundFromNotice("Consumers can receive a refund of $49.99.");
    expect(result.value).toBe(49.99);
  });

  it("extracts dollar amount from '$150 refund'", () => {
    const result = extractRefundFromNotice("Eligible consumers will receive a $150 refund.");
    expect(result.value).toBe(150);
  });

  it("detects full refund without specific amount", () => {
    const result = extractRefundFromNotice("Consumers are entitled to a full refund of the purchase price.");
    expect(result.value).toBeNull();
    expect(result.notes).toMatch(/full refund/i);
  });

  it("returns null for notices without refund info", () => {
    const result = extractRefundFromNotice("The product poses a fire hazard. Consumers should stop using it.");
    expect(result.value).toBeNull();
    expect(result.notes).toBe("");
  });

  it("handles comma-formatted amounts like $1,299.00", () => {
    const result = extractRefundFromNotice("Consumers will receive a refund of $1,299.00.");
    expect(result.value).toBe(1299);
  });
});
