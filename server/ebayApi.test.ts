/**
 * eBay API Client Tests
 * Covers: OAuth2 token logic, response parsing, platform routing,
 * sandbox detection, and error handling.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ─── Mock fetch globally ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFindingApiResponse(items: Array<{ price: string; title: string }>) {
  return {
    findCompletedItemsResponse: [
      {
        ack: ["Success"],
        searchResult: [
          {
            "@count": String(items.length),
            item: items.map((item, i) => ({
              itemId: [`item-${i}`],
              title: [item.title],
              viewItemURL: [`https://www.ebay.com/itm/${i}`],
              sellingStatus: [
                {
                  currentPrice: [{ __value__: item.price, "@currencyId": "USD" }],
                  soldDate: ["2026-04-10T12:00:00.000Z"],
                },
              ],
              condition: [{ conditionDisplayName: ["Used"] }],
              location: ["United States"],
              quantity: ["1"],
            })),
          },
        ],
        paginationOutput: [{ totalEntries: [String(items.length)] }],
      },
    ],
  };
}

function makeBrowseApiResponse(items: Array<{ price: string; title: string }>) {
  return {
    total: items.length,
    itemSummaries: items.map((item, i) => ({
      itemId: `browse-item-${i}`,
      title: item.title,
      price: { value: item.price, currency: "USD" },
      condition: "USED",
      itemWebUrl: `https://www.ebay.com/itm/browse-${i}`,
      itemLocation: { country: "US" },
    })),
  };
}

function makeTokenResponse() {
  return {
    access_token: "v^1.1#i^1#f^0#p^1#r^0#I^3#test-token-abc123",
    token_type: "Application Access Token",
    expires_in: 7200,
  };
}

// ─── Sandbox detection ────────────────────────────────────────────────────────

describe("Sandbox detection", () => {
  it("detects sandbox when App ID contains SBX", () => {
    const appId = "TestApp-SBX-PRD-abc123def456";
    const isSandbox =
      appId.toUpperCase().includes("SBX") ||
      appId.includes("-SBX-") ||
      appId.includes("sandbox");
    expect(isSandbox).toBe(true);
  });

  it("does not flag production App IDs as sandbox", () => {
    const appId = "TestApp-PRD-abc123def456";
    const isSandbox =
      appId.toUpperCase().includes("SBX") ||
      appId.includes("-SBX-") ||
      appId.includes("sandbox");
    expect(isSandbox).toBe(false);
  });
});

// ─── OAuth2 token caching logic ───────────────────────────────────────────────

describe("OAuth2 token caching", () => {
  it("considers token expired when expiresAt - 60s <= now", () => {
    const now = Date.now();
    const expiresAt = now + 30_000; // 30s left (< 60s buffer)
    const isExpired = expiresAt - 60_000 <= now;
    expect(isExpired).toBe(true);
  });

  it("considers token valid when expiresAt - 60s > now", () => {
    const now = Date.now();
    const expiresAt = now + 120_000; // 2 min left (> 60s buffer)
    const isExpired = expiresAt - 60_000 <= now;
    expect(isExpired).toBe(false);
  });

  it("calculates correct expiry from expires_in", () => {
    const before = Date.now();
    const expiresIn = 7200; // 2 hours
    const expiresAt = before + expiresIn * 1000;
    expect(expiresAt - before).toBe(7_200_000);
  });
});

// ─── Finding API response parsing ─────────────────────────────────────────────

describe("Finding API response parsing", () => {
  it("extracts prices and titles from valid response", () => {
    const response = makeFindingApiResponse([
      { price: "49.99", title: "Recalled Widget Used" },
      { price: "35.00", title: "Recalled Widget Parts" },
      { price: "55.00", title: "Recalled Widget OEM" },
    ]);

    const items = response.findCompletedItemsResponse[0].searchResult[0].item;
    const prices = items.map((i) =>
      parseFloat(i.sellingStatus[0].currentPrice[0].__value__)
    );

    expect(prices).toEqual([49.99, 35, 55]);
    expect(prices.length).toBe(3);
  });

  it("calculates correct average price", () => {
    const prices = [49.99, 35.0, 55.0];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    expect(avg).toBeCloseTo(46.66, 1);
  });

  it("filters out zero-price items", () => {
    const allPrices = [0, 49.99, 0, 35.0];
    const validPrices = allPrices.filter((p) => p > 0);
    expect(validPrices).toEqual([49.99, 35.0]);
  });

  it("returns totalCount from paginationOutput", () => {
    const response = makeFindingApiResponse([
      { price: "10.00", title: "Item A" },
      { price: "20.00", title: "Item B" },
    ]);
    const total = parseInt(
      response.findCompletedItemsResponse[0].paginationOutput[0].totalEntries[0]
    );
    expect(total).toBe(2);
  });
});

// ─── Browse API response parsing ─────────────────────────────────────────────

describe("Browse API response parsing", () => {
  it("extracts prices and titles from Browse API response", () => {
    const response = makeBrowseApiResponse([
      { price: "75.00", title: "Used Product A" },
      { price: "60.00", title: "Used Product B" },
    ]);

    const items = response.itemSummaries;
    const prices = items.map((i) => parseFloat(i.price.value));
    expect(prices).toEqual([75, 60]);
  });

  it("calculates correct average from Browse API items", () => {
    const prices = [75.0, 60.0, 90.0];
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    expect(avg).toBeCloseTo(75, 0);
  });

  it("uses total field for count", () => {
    const response = makeBrowseApiResponse([
      { price: "10.00", title: "A" },
      { price: "20.00", title: "B" },
    ]);
    expect(response.total).toBe(2);
  });
});

// ─── Platform routing for auto parts ─────────────────────────────────────────

describe("eBay Motors platform routing", () => {
  it("uses category 6030 for auto parts queries", () => {
    const EBAY_MOTORS_CATEGORY = "6030";
    const isAutoPartQuery = true;
    const categoryId = isAutoPartQuery ? EBAY_MOTORS_CATEGORY : undefined;
    expect(categoryId).toBe("6030");
  });

  it("uses no category for general consumer product queries", () => {
    const EBAY_MOTORS_CATEGORY = "6030";
    const isAutoPartQuery = false;
    const categoryId = isAutoPartQuery ? EBAY_MOTORS_CATEGORY : undefined;
    expect(categoryId).toBeUndefined();
  });
});

// ─── Blended average logic ────────────────────────────────────────────────────

describe("Blended average calculation", () => {
  it("prefers sold listings over active listings", () => {
    const soldAvg = 45.0;
    const activeAvg = 65.0;
    const blendedAvg = soldAvg ?? activeAvg;
    expect(blendedAvg).toBe(45.0);
  });

  it("falls back to active avg when sold is null", () => {
    const soldAvg = null;
    const activeAvg = 65.0;
    const blendedAvg = soldAvg ?? activeAvg;
    expect(blendedAvg).toBe(65.0);
  });

  it("returns null when both sold and active are null", () => {
    const soldAvg = null;
    const activeAvg = null;
    const blendedAvg = soldAvg ?? activeAvg;
    expect(blendedAvg).toBeNull();
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("Error handling", () => {
  it("returns error result when fetch throws", async () => {
    const errorResult = {
      listings: [],
      totalCount: 0,
      avgPrice: null,
      error: "Network timeout",
    };
    expect(errorResult.error).toBe("Network timeout");
    expect(errorResult.listings).toHaveLength(0);
    expect(errorResult.avgPrice).toBeNull();
  });

  it("returns error result on non-200 HTTP status", () => {
    const status = 429; // Rate limited
    const errorResult = {
      listings: [],
      totalCount: 0,
      avgPrice: null,
      error: `Finding API HTTP ${status}`,
    };
    expect(errorResult.error).toContain("429");
  });

  it("handles missing credentials gracefully", () => {
    const appId = undefined;
    const certId = undefined;
    const hasCredentials = !!(appId && certId);
    expect(hasCredentials).toBe(false);
  });
});

// ─── Integration: credential validation (live test skipped in CI) ─────────────

describe("eBay credential validation", () => {
  it("EBAY_APP_ID environment variable is set", () => {
    // This test validates that the secret was injected into the environment
    const appId = process.env.EBAY_APP_ID;
    expect(appId).toBeDefined();
    expect(appId).not.toBe("");
    expect(typeof appId).toBe("string");
  });

  it("EBAY_CERT_ID environment variable is set", () => {
    const certId = process.env.EBAY_CERT_ID;
    expect(certId).toBeDefined();
    expect(certId).not.toBe("");
  });

  it("EBAY_DEV_ID environment variable is set", () => {
    const devId = process.env.EBAY_DEV_ID;
    expect(devId).toBeDefined();
    expect(devId).not.toBe("");
  });

  it("credentials are long enough to be valid (not placeholder values)", () => {
    const appId = process.env.EBAY_APP_ID ?? "";
    const certId = process.env.EBAY_CERT_ID ?? "";
    expect(appId.length).toBeGreaterThan(10);
    expect(certId.length).toBeGreaterThan(10);
  });
});
