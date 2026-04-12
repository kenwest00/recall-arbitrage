/**
 * NHTSA Recall API Client
 * Base URL: https://api.nhtsa.gov/recalls/
 * Public API — no authentication required.
 */

export interface NhtsaRecall {
  NHTSACampaignNumber: string;
  parkIt: boolean;
  parkOutSide: boolean;
  ReportReceivedDate: string;
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  Notes: string;
  ModelYear: string;
  Make: string;
  Model: string;
  Manufacturer?: string;
}

export interface NhtsaRecallsResponse {
  Count: number;
  Message: string;
  results: NhtsaRecall[];
}

const NHTSA_BASE = "https://api.nhtsa.gov";

/**
 * Extract refund value from NHTSA remedy text.
 */
export function extractNhtsaRefundValue(remedy: string, notes: string): {
  value: number | null;
  notes: string;
} {
  const combined = `${remedy} ${notes}`;

  const refundPatterns = [
    /refund[^.]*?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)[^.]*?refund/i,
    /reimburse[^.]*?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:cash\s+)?refund/i,
    /full\s+(?:purchase\s+)?(?:price|refund)/i,
  ];

  for (const pattern of refundPatterns) {
    const match = combined.match(pattern);
    if (match) {
      if (match[1]) {
        const value = parseFloat(match[1].replace(/,/g, ""));
        return { value, notes: `Extracted from NHTSA notice: "${match[0].trim()}"` };
      }
      return { value: null, notes: `Full purchase price refund: "${match[0].trim()}"` };
    }
  }

  return { value: null, notes: "" };
}

/**
 * Fetch recalls for a specific vehicle (make/model/year).
 */
export async function fetchRecallsByVehicle(
  make: string,
  model: string,
  modelYear: string
): Promise<NhtsaRecall[]> {
  const url = `${NHTSA_BASE}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(modelYear)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`NHTSA API error: ${res.status} ${res.statusText}`);
  }

  const data: NhtsaRecallsResponse = await res.json();
  return data.results || [];
}

/**
 * Fetch all model years that have recalls.
 */
export async function fetchRecallModelYears(): Promise<string[]> {
  const url = `${NHTSA_BASE}/products/vehicles/modelYears?issueType=r`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`NHTSA modelYears error: ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r: { modelYear: string }) => r.modelYear);
}

/**
 * Fetch all makes for a given model year with recalls.
 */
export async function fetchRecallMakes(modelYear: string): Promise<string[]> {
  const url = `${NHTSA_BASE}/products/vehicles/makes?modelYear=${encodeURIComponent(modelYear)}&issueType=r`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`NHTSA makes error: ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r: { make: string }) => r.make);
}

/**
 * Fetch all models for a given year+make with recalls.
 */
export async function fetchRecallModels(modelYear: string, make: string): Promise<string[]> {
  const url = `${NHTSA_BASE}/products/vehicle/models?modelYear=${encodeURIComponent(modelYear)}&make=${encodeURIComponent(make)}&issueType=r`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`NHTSA models error: ${res.status}`);
  const data = await res.json();
  return (data.results || []).map((r: { model: string }) => r.model);
}

/**
 * Fetch a broad set of recent NHTSA recalls by sampling recent model years.
 * This is a pragmatic approach since NHTSA doesn't have a "get all recalls" endpoint.
 */
export async function fetchRecentNhtsaRecalls(maxYears = 5): Promise<NhtsaRecall[]> {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: maxYears }, (_, i) =>
    String(currentYear - i)
  );

  const allRecalls: NhtsaRecall[] = [];
  const seen = new Set<string>();

  for (const year of years) {
    try {
      const makes = await fetchRecallMakes(year);
      await new Promise((r) => setTimeout(r, 200));

      for (const make of makes.slice(0, 20)) {
        // Limit to top 20 makes per year to avoid excessive API calls
        try {
          const models = await fetchRecallModels(year, make);
          await new Promise((r) => setTimeout(r, 100));

          for (const model of models.slice(0, 10)) {
            try {
              const recalls = await fetchRecallsByVehicle(make, model, year);
              for (const recall of recalls) {
                if (!seen.has(recall.NHTSACampaignNumber)) {
                  seen.add(recall.NHTSACampaignNumber);
                  allRecalls.push({ ...recall, Make: make, Model: model, ModelYear: year });
                }
              }
              await new Promise((r) => setTimeout(r, 100));
            } catch {
              // Skip individual model errors
            }
          }
        } catch {
          // Skip individual make errors
        }
      }
    } catch {
      // Skip individual year errors
    }
  }

  return allRecalls;
}
