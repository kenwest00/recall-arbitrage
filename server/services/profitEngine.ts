/**
 * Profit Calculation Engine
 * Routes NHTSA recalls to auto parts platforms (eBay Motors, RockAuto, Car-Part, LKQ)
 * and CPSC recalls to general consumer market platforms (eBay, Amazon, Facebook, Craigslist).
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  recalls,
  pricingData,
  msrpData,
  profitAnalysis,
  type InsertProfitAnalysis,
  type InsertPricingData,
  type InsertMsrpData,
} from "../../drizzle/schema";
import { fetchAllPricesForProduct } from "./marketPricing";
import { fetchAllAutoPartsPrices } from "./autoPartsPricing";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(nums: number[]): number | null {
  const valid = nums.filter((n) => n > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function calcMargin(refundValue: number, avgUsedPrice: number): number {
  if (refundValue <= 0) return 0;
  return ((refundValue - avgUsedPrice) / refundValue) * 100;
}

// ─── Fetch and persist pricing data for a recall ──────────────────────────────

export async function fetchAndStorePricingForRecall(
  recallId: number,
  productName: string,
  agency: "CPSC" | "NHTSA" = "CPSC"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Clear old pricing data for this recall
  await db.delete(pricingData).where(eq(pricingData.recallId, recallId));
  await db.delete(msrpData).where(eq(msrpData.recallId, recallId));

  if (agency === "NHTSA") {
    // ── Auto parts path ──────────────────────────────────────────────────────
    const { ebayMotors, rockAuto, carPart, lkq } = await fetchAllAutoPartsPrices(productName);

    const platformMap = [
      { key: "ebaymotors" as const, data: ebayMotors },
      { key: "carpart" as const, data: carPart },
      { key: "lkq" as const, data: lkq },
    ];

    for (const { key, data } of platformMap) {
      for (const listing of data.listings.slice(0, 10)) {
        const row: InsertPricingData = {
          recallId,
          platform: key,
          listingTitle: listing.title,
          price: String(listing.price),
          condition: listing.condition,
          listingUrl: listing.url,
          quantity: listing.quantity,
        };
        await db.insert(pricingData).values(row);
      }
    }

    // Store RockAuto as MSRP baseline (new/reman pricing)
    for (const listing of rockAuto.listings.slice(0, 5)) {
      const row: InsertMsrpData = {
        recallId,
        source: "RockAuto",
        msrpPrice: String(listing.price),
        productUrl: listing.url,
        productTitle: listing.title,
      };
      await db.insert(msrpData).values(row);
    }
  } else {
    // ── General consumer market path (CPSC) ──────────────────────────────────
    const { ebay, amazon, facebook, craigslist, msrp } = await fetchAllPricesForProduct(productName);

    for (const listing of ebay.listings.slice(0, 10)) {
      await db.insert(pricingData).values({
        recallId,
        platform: "ebay",
        listingTitle: listing.title,
        price: String(listing.price),
        condition: listing.condition,
        listingUrl: listing.url,
        quantity: listing.quantity,
      } as InsertPricingData);
    }

    for (const listing of amazon.listings.slice(0, 10)) {
      await db.insert(pricingData).values({
        recallId,
        platform: "amazon",
        listingTitle: listing.title,
        price: String(listing.price),
        condition: listing.condition,
        listingUrl: listing.url,
        quantity: listing.quantity,
      } as InsertPricingData);
    }

    for (const listing of facebook.listings.slice(0, 10)) {
      await db.insert(pricingData).values({
        recallId,
        platform: "facebook",
        listingTitle: listing.title,
        price: String(listing.price),
        condition: listing.condition,
        listingUrl: listing.url,
        quantity: listing.quantity,
      } as InsertPricingData);
    }

    for (const listing of craigslist.listings.slice(0, 10)) {
      await db.insert(pricingData).values({
        recallId,
        platform: "craigslist",
        listingTitle: listing.title,
        price: String(listing.price),
        condition: listing.condition,
        listingUrl: listing.url,
        quantity: listing.quantity,
      } as InsertPricingData);
    }

    for (const m of msrp) {
      if (m.price) {
        await db.insert(msrpData).values({
          recallId,
          source: m.source,
          msrpPrice: String(m.price),
          productUrl: m.url,
          productTitle: m.title,
        } as InsertMsrpData);
      }
    }
  }
}

// ─── Calculate and store profit analysis for a recall ─────────────────────────

export async function calculateProfitForRecall(
  recallId: number,
  thresholdPercent = 10
): Promise<InsertProfitAnalysis | null> {
  const db = await getDb();
  if (!db) return null;

  const [recall] = await db.select().from(recalls).where(eq(recalls.id, recallId)).limit(1);
  if (!recall) return null;

  const refundValue = recall.refundValue ? parseFloat(String(recall.refundValue)) : null;
  const isNhtsa = recall.agency === "NHTSA";

  const prices = await db.select().from(pricingData).where(eq(pricingData.recallId, recallId));

  let ebayAvg: number | null = null;
  let amazonAvg: number | null = null;
  let fbAvg: number | null = null;
  let craigslistAvg: number | null = null;
  let ebayMotorsAvg: number | null = null;
  let carPartAvg: number | null = null;
  let lkqAvg: number | null = null;

  if (isNhtsa) {
    const ebayMotorsPrices = prices.filter((p) => p.platform === "ebaymotors").map((p) => parseFloat(String(p.price)));
    const carPartPrices = prices.filter((p) => p.platform === "carpart").map((p) => parseFloat(String(p.price)));
    const lkqPrices = prices.filter((p) => p.platform === "lkq").map((p) => parseFloat(String(p.price)));
    ebayMotorsAvg = avg(ebayMotorsPrices);
    carPartAvg = avg(carPartPrices);
    lkqAvg = avg(lkqPrices);
  } else {
    const ebayPrices = prices.filter((p) => p.platform === "ebay").map((p) => parseFloat(String(p.price)));
    const amazonPrices = prices.filter((p) => p.platform === "amazon").map((p) => parseFloat(String(p.price)));
    const fbPrices = prices.filter((p) => p.platform === "facebook").map((p) => parseFloat(String(p.price)));
    const craigslistPrices = prices.filter((p) => p.platform === "craigslist").map((p) => parseFloat(String(p.price)));
    ebayAvg = avg(ebayPrices);
    amazonAvg = avg(amazonPrices);
    fbAvg = avg(fbPrices);
    craigslistAvg = avg(craigslistPrices);
  }

  // Blended average: only used-market sources (exclude RockAuto new parts)
  const allUsedPrices = prices
    .filter((p) => p.platform !== "rockauto")
    .map((p) => parseFloat(String(p.price)));
  const blendedAvg = avg(allUsedPrices);

  // MSRP
  const msrpRows = await db.select().from(msrpData).where(eq(msrpData.recallId, recallId));
  const msrpPrices = msrpRows.map((m) => parseFloat(String(m.msrpPrice))).filter((p) => p > 0);
  const msrpValue = avg(msrpPrices);

  // Profit calculation
  let profitMargin: number | null = null;
  let profitAmount: number | null = null;
  let meetsThreshold = false;

  if (refundValue !== null && blendedAvg !== null) {
    profitAmount = refundValue - blendedAvg;
    profitMargin = calcMargin(refundValue, blendedAvg);
    meetsThreshold = profitMargin >= thresholdPercent;
  }

  // For CPSC: blend craigslist into fbAvg field if no fb data
  const effectiveFbAvg = isNhtsa
    ? (lkqAvg !== null ? String(lkqAvg) : null)
    : (fbAvg !== null ? String(fbAvg) : craigslistAvg !== null ? String(craigslistAvg) : null);

  const analysis: InsertProfitAnalysis = {
    recallId,
    avgUsedPrice: blendedAvg !== null ? String(blendedAvg) : null,
    // For CPSC: use standard fields; for NHTSA: repurpose fields for auto parts platforms
    ebayAvgPrice: isNhtsa ? (ebayMotorsAvg !== null ? String(ebayMotorsAvg) : null) : (ebayAvg !== null ? String(ebayAvg) : null),
    amazonAvgPrice: isNhtsa ? (carPartAvg !== null ? String(carPartAvg) : null) : (amazonAvg !== null ? String(amazonAvg) : null),
    fbAvgPrice: effectiveFbAvg,
    ebayCount: prices.filter((p) => ["ebay", "ebaymotors"].includes(p.platform)).length,
    amazonCount: prices.filter((p) => ["amazon", "carpart"].includes(p.platform)).length,
    fbCount: prices.filter((p) => ["facebook", "lkq", "craigslist"].includes(p.platform)).length,
    totalCount: allUsedPrices.length,
    refundValue: refundValue !== null ? String(refundValue) : null,
    msrpValue: msrpValue !== null ? String(msrpValue) : null,
    profitMargin: profitMargin !== null ? String(profitMargin) : null,
    profitAmount: profitAmount !== null ? String(profitAmount) : null,
    meetsThreshold,
    calculatedAt: new Date(),
  };

  const existing = await db
    .select({ id: profitAnalysis.id })
    .from(profitAnalysis)
    .where(eq(profitAnalysis.recallId, recallId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(profitAnalysis).set(analysis).where(eq(profitAnalysis.recallId, recallId));
  } else {
    await db.insert(profitAnalysis).values(analysis);
  }

  return analysis;
}

/**
 * Refresh pricing and profit analysis for all active recalls.
 */
export async function refreshAllProfitAnalysis(thresholdPercent = 10): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const allRecalls = await db
    .select({ id: recalls.id, productName: recalls.productName, title: recalls.title, agency: recalls.agency })
    .from(recalls)
    .where(eq(recalls.isActive, true));

  for (const recall of allRecalls) {
    try {
      const productQuery = recall.productName || recall.title || "";
      if (!productQuery) continue;
      await fetchAndStorePricingForRecall(recall.id, productQuery, recall.agency as "CPSC" | "NHTSA");
      await calculateProfitForRecall(recall.id, thresholdPercent);
      // 2 second delay between recalls to respect eBay API rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[ProfitEngine] Failed for recall ${recall.id}:`, err);
    }
  }
}
