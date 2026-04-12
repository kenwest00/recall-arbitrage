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
const PAGE_SIZE = 100;

/**
 * Extract refund value from CPSC remedy/description text.
 * Looks for patterns like "$25", "full purchase price", "refund of $X", etc.
 */
export function extractRefundValue(text: string): { value: number | null; notes: string } {
  if (!text) return { value: null, notes: "" };

  // Match explicit dollar amounts near refund keywords
  const refundPatterns = [
    /refund[^.]*?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)[^.]*?refund/i,
    /full\s+(?:purchase\s+)?(?:price|refund)/i,
    /reimburse[^.]*?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:cash\s+)?refund/i,
  ];

  for (const pattern of refundPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[1]) {
        const value = parseFloat(match[1].replace(/,/g, ""));
        return { value, notes: `Extracted from notice: "${match[0].trim()}"` };
      }
      // "full purchase price" — no specific dollar amount
      return { value: null, notes: `Full purchase price refund indicated: "${match[0].trim()}"` };
    }
  }

  return { value: null, notes: "" };
}

/**
 * Determine if a recall remedy includes a refund.
 */
export function isRefundRemedy(remedies: CpscRecallRemedy[]): boolean {
  return remedies.some((r) =>
    /refund|reimburse|money back|cash back/i.test(r.Name)
  );
}

/**
 * Fetch a page of CPSC recalls.
 */
async function fetchCpscPage(startIndex: number): Promise<CpscRecall[]> {
  const url = new URL(CPSC_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("RecallDateStart", "2020-01-01");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(startIndex));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`CPSC API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch all CPSC recalls (paginated).
 */
export async function fetchAllCpscRecalls(): Promise<CpscRecall[]> {
  const all: CpscRecall[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchCpscPage(offset);
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    // Throttle to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
}
