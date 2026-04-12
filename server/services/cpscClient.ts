/**
 * CPSC Recall API Client
 * Base URL: https://www.saferproducts.gov/RestWebServices/Recall
 * Public API — no authentication required.
 */

export interface CpscRecallProduct {
  Name: string;
  Description?: string;
  Type?: string;
  CategoryID?: string;
  NumberOfUnits?: string;
  Model?: string;
  UPC?: string;
}

export interface CpscRecallRemedy {
  Name: string;
}

export interface CpscRecallHazard {
  Name: string;
  HazardType?: string;
}

export interface CpscRecallImage {
  URL: string;
  Caption?: string;
}

export interface CpscRecall {
  RecallID: string;
  RecallNumber: string;
  RecallDate: string;
  Description: string;
  URL: string;
  Title: string;
  ConsumerContact?: string;
  LastPublishDate?: string;
  Products: CpscRecallProduct[];
  Hazards: CpscRecallHazard[];
  Remedies: CpscRecallRemedy[];
  Images?: CpscRecallImage[];
  Manufacturers?: Array<{ Name: string }>;
  Retailers?: Array<{ Name: string }>;
}

const CPSC_BASE = "https://www.saferproducts.gov/RestWebServices/Recall";

/**
 * NOTE: The CPSC API ignores limit/offset parameters and returns ALL matching records
 * in a single response. We fetch once with a wide date range.
 */

/**
 * Determine if a recall remedy is a CASH REFUND (not exchange/replacement/repair).
 *
 * Rules:
 * - MUST contain a refund/reimburse/money-back keyword
 * - "store credit" alone does NOT qualify — only cash/purchase price refund
 * - If the remedy mentions BOTH refund AND replacement, it qualifies (consumer has refund option)
 * - Replacement-only, repair-only, or free-fix-only remedies are excluded
 */
export function isRefundRemedy(remedies: CpscRecallRemedy[]): boolean {
  const fullText = remedies.map((r) => r.Name).join(" ");

  // Must contain an explicit refund/reimburse/money-back signal
  const hasRefundSignal = /\bfull\s+refund\b|\brefund\b|\breimburse\b|\bmoney\s+back\b|\bcash\s+back\b|\bpurchase\s+price\b/i.test(fullText);
  if (!hasRefundSignal) return false;

  // Exclude if the ONLY remedy is store credit (no cash option)
  const hasStoreCreditOnly =
    /\bstore\s+credit\b/i.test(fullText) &&
    !/\bfull\s+refund\b|\bcash\s+refund\b|\bpurchase\s+price\b|\breimburse\b/i.test(fullText);
  if (hasStoreCreditOnly) return false;

  return true;
}

/**
 * Classify the remedy type for display purposes.
 */
export function classifyRemedy(remedyText: string): "refund" | "replacement" | "repair" | "other" {
  const t = remedyText.toLowerCase();
  const hasRefund = /\bfull\s+refund\b|\brefund\b|\breimburse\b|\bmoney\s+back\b|\bpurchase\s+price\b/.test(t);
  const hasReplacement = /\breplacement\b|\breplace\b|\bexchange\b/.test(t);
  const hasRepair = /\brepair\b|\bfix\b|\bservice\b/.test(t);

  if (hasRefund) return "refund";
  if (hasReplacement) return "replacement";
  if (hasRepair) return "repair";
  return "other";
}

/**
 * Extract refund value from CPSC remedy/description text.
 * Looks for patterns like "$25", "full purchase price", "refund of $X", etc.
 * Only call this AFTER confirming isRefundRemedy() is true.
 */
export function extractRefundValue(text: string): { value: number | null; notes: string } {
  if (!text) return { value: null, notes: "" };

  // Match explicit dollar amounts near refund keywords
  const refundPatterns = [
    /refund[^.]{0,60}?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)[^.]{0,60}?refund/i,
    /reimburse[^.]{0,60}?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:cash\s+)?refund/i,
    /full\s+(?:purchase\s+)?(?:price|refund)/i,
  ];

  for (const pattern of refundPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[1]) {
        const value = parseFloat(match[1].replace(/,/g, ""));
        return { value, notes: `Extracted from notice: "${match[0].trim()}"` };
      }
      // "full purchase price" — no specific dollar amount in notice
      return { value: null, notes: `Full purchase price refund: "${match[0].trim()}"` };
    }
  }

  // Has refund signal but no extractable dollar amount
  return { value: null, notes: "Refund indicated in notice (amount not specified)" };
}

/**
 * Fetch all CPSC recalls in a single API call.
 * The CPSC API ignores limit/offset and returns all matching records at once.
 */
export async function fetchAllCpscRecalls(): Promise<CpscRecall[]> {
  const url = new URL(CPSC_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("RecallDateStart", "2020-01-01");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    throw new Error(`CPSC API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const records = Array.isArray(data) ? data : [];
  console.log(`[CPSC] Fetched ${records.length} recalls from API`);
  return records;
}
