/**
 * Report Generator Service
 * Generates CSV and PDF reports from recall + profit analysis data.
 */

import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { recalls, profitAnalysis, reports } from "../../drizzle/schema";
import { storagePut } from "../storage";

export interface ReportFilters {
  agency?: string[];
  dateFrom?: string;
  dateTo?: string;
  minProfitThreshold?: number;
  category?: string;
  onlyWithRefund?: boolean;
}

interface ReportRow {
  recallNumber: string;
  agency: string;
  title: string;
  productName: string;
  manufacturer: string;
  category: string;
  recallDate: string;
  refundValue: string;
  avgUsedPrice: string;
  ebayAvg: string;
  amazonAvg: string;
  fbAvg: string;
  totalListings: string;
  profitAmount: string;
  profitMargin: string;
  meetsThreshold: string;
  recallUrl: string;
}

// ─── Query report data ────────────────────────────────────────────────────────

export async function queryReportData(filters: ReportFilters): Promise<ReportRow[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];

  if (filters.agency && filters.agency.length > 0) {
    conditions.push(inArray(recalls.agency, filters.agency as ("CPSC" | "NHTSA")[]));
  }

  if (filters.dateFrom) {
    conditions.push(gte(recalls.recallDate, new Date(filters.dateFrom)));
  }

  if (filters.dateTo) {
    conditions.push(lte(recalls.recallDate, new Date(filters.dateTo)));
  }

  if (filters.category) {
    conditions.push(eq(recalls.category, filters.category));
  }

  const rows = await db
    .select({
      recallNumber: recalls.recallNumber,
      agency: recalls.agency,
      title: recalls.title,
      productName: recalls.productName,
      manufacturer: recalls.manufacturer,
      category: recalls.category,
      recallDate: recalls.recallDate,
      refundValue: recalls.refundValue,
      recallUrl: recalls.recallUrl,
      avgUsedPrice: profitAnalysis.avgUsedPrice,
      ebayAvgPrice: profitAnalysis.ebayAvgPrice,
      amazonAvgPrice: profitAnalysis.amazonAvgPrice,
      fbAvgPrice: profitAnalysis.fbAvgPrice,
      totalCount: profitAnalysis.totalCount,
      profitAmount: profitAnalysis.profitAmount,
      profitMargin: profitAnalysis.profitMargin,
      meetsThreshold: profitAnalysis.meetsThreshold,
    })
    .from(recalls)
    .leftJoin(profitAnalysis, eq(recalls.id, profitAnalysis.recallId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Apply profit threshold filter in memory
  const filtered = rows.filter((row) => {
    if (filters.minProfitThreshold !== undefined && filters.minProfitThreshold > 0) {
      const margin = row.profitMargin ? parseFloat(String(row.profitMargin)) : null;
      if (margin === null || margin < filters.minProfitThreshold) return false;
    }
    if (filters.onlyWithRefund) {
      if (!row.refundValue) return false;
    }
    return true;
  });

  return filtered.map((row) => ({
    recallNumber: row.recallNumber,
    agency: row.agency,
    title: row.title || "",
    productName: row.productName || "",
    manufacturer: row.manufacturer || "",
    category: row.category || "",
    recallDate: row.recallDate ? new Date(row.recallDate).toLocaleDateString() : "",
    refundValue: row.refundValue ? `$${parseFloat(String(row.refundValue)).toFixed(2)}` : "N/A",
    avgUsedPrice: row.avgUsedPrice ? `$${parseFloat(String(row.avgUsedPrice)).toFixed(2)}` : "N/A",
    ebayAvg: row.ebayAvgPrice ? `$${parseFloat(String(row.ebayAvgPrice)).toFixed(2)}` : "N/A",
    amazonAvg: row.amazonAvgPrice ? `$${parseFloat(String(row.amazonAvgPrice)).toFixed(2)}` : "N/A",
    fbAvg: row.fbAvgPrice ? `$${parseFloat(String(row.fbAvgPrice)).toFixed(2)}` : "N/A",
    totalListings: String(row.totalCount || 0),
    profitAmount: row.profitAmount ? `$${parseFloat(String(row.profitAmount)).toFixed(2)}` : "N/A",
    profitMargin: row.profitMargin ? `${parseFloat(String(row.profitMargin)).toFixed(1)}%` : "N/A",
    meetsThreshold: row.meetsThreshold ? "Yes" : "No",
    recallUrl: row.recallUrl || "",
  }));
}

// ─── CSV Generation ───────────────────────────────────────────────────────────

export function generateCsv(rows: ReportRow[]): string {
  const headers = [
    "Recall Number",
    "Agency",
    "Product Name",
    "Manufacturer",
    "Category",
    "Recall Date",
    "Refund Value",
    "Avg Used Price",
    "eBay Avg",
    "Amazon Avg",
    "Facebook Avg",
    "Total Listings",
    "Profit Amount",
    "Profit Margin",
    "Meets Threshold",
    "Recall URL",
  ];

  const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const lines = [
    headers.map(escape).join(","),
    ...rows.map((row) =>
      [
        row.recallNumber,
        row.agency,
        row.productName || row.title,
        row.manufacturer,
        row.category,
        row.recallDate,
        row.refundValue,
        row.avgUsedPrice,
        row.ebayAvg,
        row.amazonAvg,
        row.fbAvg,
        row.totalListings,
        row.profitAmount,
        row.profitMargin,
        row.meetsThreshold,
        row.recallUrl,
      ]
        .map(escape)
        .join(",")
    ),
  ];

  return lines.join("\n");
}

// ─── PDF Generation (HTML-based) ──────────────────────────────────────────────

export function generatePdfHtml(rows: ReportRow[], filters: ReportFilters): string {
  const date = new Date().toLocaleDateString();
  const filterDesc = [
    filters.agency?.length ? `Agency: ${filters.agency.join(", ")}` : null,
    filters.dateFrom ? `From: ${filters.dateFrom}` : null,
    filters.dateTo ? `To: ${filters.dateTo}` : null,
    filters.minProfitThreshold ? `Min Margin: ${filters.minProfitThreshold}%` : null,
    filters.category ? `Category: ${filters.category}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const tableRows = rows
    .map(
      (row) => `
    <tr class="${row.meetsThreshold === "Yes" ? "opportunity" : ""}">
      <td>${row.recallNumber}</td>
      <td>${row.agency}</td>
      <td>${row.productName || row.title}</td>
      <td>${row.recallDate}</td>
      <td>${row.refundValue}</td>
      <td>${row.avgUsedPrice}</td>
      <td>${row.profitAmount}</td>
      <td class="margin ${row.meetsThreshold === "Yes" ? "positive" : ""}">${row.profitMargin}</td>
      <td>${row.totalListings}</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>RecallArb Report - ${date}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; margin: 20px; }
  h1 { color: #1e3a5f; font-size: 18px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #1e3a5f; color: white; padding: 6px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  tr:nth-child(even) { background: #f8f9fa; }
  tr.opportunity { background: #f0fdf4 !important; }
  .margin.positive { color: #16a34a; font-weight: bold; }
  .summary { display: flex; gap: 24px; margin-bottom: 16px; }
  .stat { background: #f1f5f9; padding: 10px 16px; border-radius: 6px; }
  .stat-value { font-size: 20px; font-weight: bold; color: #1e3a5f; }
  .stat-label { font-size: 10px; color: #666; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>RecallArb — Profit Opportunity Report</h1>
  <div class="meta">Generated: ${date} | Filters: ${filterDesc || "None"} | Total Records: ${rows.length}</div>
  <div class="summary">
    <div class="stat">
      <div class="stat-value">${rows.length}</div>
      <div class="stat-label">Total Recalls</div>
    </div>
    <div class="stat">
      <div class="stat-value">${rows.filter((r) => r.meetsThreshold === "Yes").length}</div>
      <div class="stat-label">Opportunities Found</div>
    </div>
    <div class="stat">
      <div class="stat-value">${rows.filter((r) => r.refundValue !== "N/A").length}</div>
      <div class="stat-label">With Refund Value</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Recall #</th>
        <th>Agency</th>
        <th>Product</th>
        <th>Date</th>
        <th>Refund</th>
        <th>Avg Used</th>
        <th>Profit</th>
        <th>Margin</th>
        <th>Listings</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}

// ─── Create and store a report ────────────────────────────────────────────────

export async function createReport(
  userId: number,
  name: string,
  filters: ReportFilters,
  format: "csv" | "pdf"
): Promise<{ reportId: number; fileUrl: string; rowCount: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Insert pending report record
  const result = await db.insert(reports).values({
    userId,
    name,
    filters,
    format,
    status: "pending",
  });
  const reportId = Number((result as unknown as { insertId: number }).insertId);

  try {
    const rows = await queryReportData(filters);

    let content: string;
    let contentType: string;
    let ext: string;

    if (format === "csv") {
      content = generateCsv(rows);
      contentType = "text/csv";
      ext = "csv";
    } else {
      content = generatePdfHtml(rows, filters);
      contentType = "text/html";
      ext = "html"; // Store as HTML; browser can print-to-PDF
    }

    const fileKey = `reports/${userId}/${reportId}-${Date.now()}.${ext}`;
    const { url } = await storagePut(fileKey, Buffer.from(content, "utf-8"), contentType);

    await db
      .update(reports)
      .set({ status: "ready", fileUrl: url, rowCount: rows.length })
      .where(eq(reports.id, reportId));

    return { reportId, fileUrl: url, rowCount: rows.length };
  } catch (err) {
    await db
      .update(reports)
      .set({ status: "error", errorMessage: String(err) })
      .where(eq(reports.id, reportId));
    throw err;
  }
}
