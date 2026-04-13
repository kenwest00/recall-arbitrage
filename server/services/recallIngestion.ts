/**
 * Recall Ingestion Service
 * Orchestrates fetching from CPSC and NHTSA APIs and persisting to the database.
 * Uses LLM-based refund extraction for more accurate refund value detection.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { recalls, syncLog, type InsertRecall } from "../../drizzle/schema";
import {
  fetchAllCpscRecalls,
  extractRefundValue,
  isRefundRemedy,
  type CpscRecall,
} from "./cpscClient";
import {
  fetchRecentNhtsaRecalls,
  extractNhtsaRefundValue,
  type NhtsaRecall,
} from "./nhtsaClient";
import { extractRefundWithLLM } from "./refundExtractor";
import { fetchMsrpPrice, type MsrpResult } from "./marketPricing";

// ─── CPSC Ingestion ──────────────────────────────────────────────────────────

async function mapCpscRecall(r: CpscRecall): Promise<InsertRecall> {
  const product = r.Products?.[0];
  const hazard = r.Hazards?.[0]?.Name || "";
  const remedy = r.Remedies?.map((rem) => rem.Name).join(", ") || "";
  const manufacturer = r.Manufacturers?.[0]?.Name || "";
  const rawNotice = [r.Description, `Hazard: ${hazard}`, `Remedy: ${remedy}`]
    .filter(Boolean)
    .join("\n\n");

  // Step 1: regex-based quick check (fast, no API cost)
  const hasRefund = isRefundRemedy(r.Remedies || []);
  const { value: regexValue, notes: regexNotes } = hasRefund
    ? extractRefundValue(remedy)
    : { value: null, notes: "" };

  let finalRefundValue: number | null = regexValue;
  let finalRefundNotes: string = regexNotes || "";
  let finalRefundExtracted: boolean = hasRefund;
  let refundCertainty: "explicit" | "msrp" | "estimated" = regexValue !== null ? "explicit" : "estimated";

  // Step 2: LLM extraction — runs for ALL recalls to catch cases regex misses
  try {
    const llmResult = await extractRefundWithLLM(remedy, r.Description || "");

    if (llmResult.isReplacementOnly && !llmResult.isFullPurchasePrice && llmResult.refundValue === null) {
      // Replacement only — no cash refund
      finalRefundValue = null;
      finalRefundExtracted = false;
      finalRefundNotes = llmResult.refundNotes || "Replacement only, no cash refund";
      refundCertainty = "estimated";
    } else if (llmResult.refundValue !== null) {
      // LLM found an explicit dollar amount
      finalRefundValue = llmResult.refundValue;
      finalRefundExtracted = true;
      finalRefundNotes = llmResult.refundNotes || `Explicit refund: $${llmResult.refundValue}`;
      refundCertainty = "explicit";
    } else if (llmResult.isFullPurchasePrice) {
      // Full purchase price refund — try to get MSRP as proxy
      finalRefundExtracted = true;
      finalRefundNotes = llmResult.refundNotes || "Full purchase price refund";
      refundCertainty = "msrp";

      const productName = product?.Name || "";
      if (productName) {
        try {
          const msrpResults: MsrpResult[] = await fetchMsrpPrice(productName);
          const bestMsrp = msrpResults.find((m) => m.price !== null && m.price > 0);
          if (bestMsrp && bestMsrp.price) {
            finalRefundValue = bestMsrp.price;
            finalRefundNotes = `Full purchase price refund; MSRP proxy: $${bestMsrp.price} from ${bestMsrp.source}`;
          }
        } catch {
          // MSRP fetch failed — leave refundValue null but keep refundExtracted=true
        }
      }
    } else if (hasRefund && regexValue === null) {
      // Regex detected a refund but couldn't extract amount; LLM also couldn't
      finalRefundExtracted = true;
      finalRefundNotes = llmResult.refundNotes || "Refund available, amount not specified";
      refundCertainty = "estimated";
    }
  } catch (err) {
    console.warn(`[RecallIngestion] LLM extraction failed for ${r.RecallNumber}:`, err);
    // Fall back to regex result
  }

  return {
    recallNumber: r.RecallNumber || r.RecallID,
    agency: "CPSC",
    title: r.Title || r.Description?.slice(0, 200) || "Unknown",
    productName: product?.Name || "",
    manufacturer,
    category: product?.Type || product?.CategoryID || "",
    description: r.Description || "",
    hazard,
    remedy,
    rawNotice,
    refundValue: finalRefundValue !== null ? String(finalRefundValue) : null,
    refundExtracted: finalRefundExtracted,
    refundNotes: finalRefundNotes || null,
    recallDate: r.RecallDate ? new Date(r.RecallDate) : null,
    recallUrl: r.URL || null,
    imageUrl: r.Images?.[0]?.URL || null,
    isActive: true,
  };
}

function mapNhtsaRecall(r: NhtsaRecall): InsertRecall {
  const rawNotice = [
    `Summary: ${r.Summary}`,
    `Consequence: ${r.Consequence}`,
    `Remedy: ${r.Remedy}`,
    r.Notes ? `Notes: ${r.Notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { value: refundValue, notes: refundNotes } = extractNhtsaRefundValue(
    r.Remedy || "",
    r.Notes || ""
  );

  const productName = [r.ModelYear, r.Make, r.Model].filter(Boolean).join(" ");

  return {
    recallNumber: r.NHTSACampaignNumber,
    agency: "NHTSA",
    title: r.Component || productName || "Vehicle Recall",
    productName,
    manufacturer: r.Manufacturer || r.Make || "",
    category: "Vehicle",
    description: r.Summary || "",
    hazard: r.Consequence || "",
    remedy: r.Remedy || "",
    rawNotice,
    refundValue: refundValue !== null ? String(refundValue) : null,
    refundExtracted: refundValue !== null,
    refundNotes: refundNotes || null,
    recallDate: r.ReportReceivedDate ? new Date(r.ReportReceivedDate) : null,
    recallUrl: `https://www.nhtsa.gov/vehicle/${encodeURIComponent(r.Make || "")}/${encodeURIComponent(r.Model || "")}/${r.ModelYear}/recalls`,
    imageUrl: null,
    isActive: true,
  };
}

// ─── Database upsert ─────────────────────────────────────────────────────────

async function upsertRecall(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, data: InsertRecall): Promise<boolean> {
  const existing = await db
    .select({ id: recalls.id })
    .from(recalls)
    .where(eq(recalls.recallNumber, data.recallNumber))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(recalls)
      .set({
        title: data.title,
        description: data.description,
        hazard: data.hazard,
        remedy: data.remedy,
        rawNotice: data.rawNotice,
        refundValue: data.refundValue,
        refundExtracted: data.refundExtracted,
        refundNotes: data.refundNotes,
        isActive: true,
      })
      .where(eq(recalls.recallNumber, data.recallNumber));
    return false; // updated
  } else {
    await db.insert(recalls).values(data);
    return true; // inserted
  }
}

// ─── Main ingestion functions ─────────────────────────────────────────────────

export async function ingestCpscRecalls(): Promise<{ inserted: number; updated: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const logEntry = await db.insert(syncLog).values({
    agency: "CPSC",
    status: "running",
    startedAt: new Date(),
  });
  const logId = Number((logEntry as unknown as { insertId: number }).insertId);

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  try {
    const cpscRecalls = await fetchAllCpscRecalls();

    for (const raw of cpscRecalls) {
      try {
        const mapped = await mapCpscRecall(raw);
        const wasInserted = await upsertRecall(db, mapped);
        if (wasInserted) inserted++;
        else updated++;
        // Small delay to avoid hammering LLM/MSRP APIs
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        errors++;
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        recordsIngested: inserted + updated,
        completedAt: new Date(),
      })
      .where(eq(syncLog.id, logId));
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        status: "error",
        errorMessage: String(err),
        completedAt: new Date(),
      })
      .where(eq(syncLog.id, logId));
    throw err;
  }

  return { inserted, updated, errors };
}

export async function ingestNhtsaRecalls(): Promise<{ inserted: number; updated: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const logEntry = await db.insert(syncLog).values({
    agency: "NHTSA",
    status: "running",
    startedAt: new Date(),
  });
  const logId = Number((logEntry as unknown as { insertId: number }).insertId);

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  try {
    const nhtsaRecalls = await fetchRecentNhtsaRecalls(3);

    for (const raw of nhtsaRecalls) {
      try {
        const mapped = mapNhtsaRecall(raw);
        const wasInserted = await upsertRecall(db, mapped);
        if (wasInserted) inserted++;
        else updated++;
      } catch {
        errors++;
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        recordsIngested: inserted + updated,
        completedAt: new Date(),
      })
      .where(eq(syncLog.id, logId));
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        status: "error",
        errorMessage: String(err),
        completedAt: new Date(),
      })
      .where(eq(syncLog.id, logId));
    throw err;
  }

  return { inserted, updated, errors };
}

export async function ingestAllRecalls(): Promise<{
  cpsc: { inserted: number; updated: number; errors: number };
  nhtsa: { inserted: number; updated: number; errors: number };
}> {
  const [cpsc, nhtsa] = await Promise.allSettled([
    ingestCpscRecalls(),
    ingestNhtsaRecalls(),
  ]);

  return {
    cpsc: cpsc.status === "fulfilled" ? cpsc.value : { inserted: 0, updated: 0, errors: 1 },
    nhtsa: nhtsa.status === "fulfilled" ? nhtsa.value : { inserted: 0, updated: 0, errors: 1 },
  };
}
