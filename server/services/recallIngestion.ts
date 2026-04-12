/**
 * Recall Ingestion Service
 * Orchestrates fetching from CPSC and NHTSA APIs and persisting to the database.
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

// ─── CPSC Ingestion ──────────────────────────────────────────────────────────

function mapCpscRecall(r: CpscRecall): InsertRecall {
  const product = r.Products?.[0];
  const hazard = r.Hazards?.[0]?.Name || "";
  const remedy = r.Remedies?.map((rem) => rem.Name).join(", ") || "";
  const manufacturer = r.Manufacturers?.[0]?.Name || "";
  const rawNotice = [r.Description, `Hazard: ${hazard}`, `Remedy: ${remedy}`]
    .filter(Boolean)
    .join("\n\n");

  // isRefundRemedy now accepts the full remedy text string
  const hasRefund = isRefundRemedy(r.Remedies || []);
  const { value: refundValue, notes: refundNotes } = hasRefund
    ? extractRefundValue(remedy)
    : { value: null, notes: "" };

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
    refundValue: refundValue !== null ? String(refundValue) : null,
    refundExtracted: hasRefund,
    refundNotes: refundNotes || null,
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
        const mapped = mapCpscRecall(raw);
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
