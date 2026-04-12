/**
 * NHTSA Recall API Client
 * Base URL: https://api.nhtsa.gov/recalls/
 * Public API — no authentication required.
 *
 * Strategy: The NHTSA API requires make+model+year to look up recalls.
 * We use a curated list of top-selling makes/models across recent years
 * to efficiently pull a broad, representative set of active recalls.
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
 * Top-selling makes and their most common models.
 * Covers ~85% of US vehicle recall volume based on NHTSA historical data.
 */
const TOP_MAKES_MODELS: Record<string, string[]> = {
  FORD: ["F-150", "EXPLORER", "ESCAPE", "MUSTANG", "EDGE", "EXPEDITION", "RANGER", "BRONCO"],
  CHEVROLET: ["SILVERADO", "EQUINOX", "MALIBU", "TRAVERSE", "COLORADO", "TAHOE", "BLAZER", "TRAX"],
  TOYOTA: ["CAMRY", "RAV4", "COROLLA", "HIGHLANDER", "TACOMA", "TUNDRA", "PRIUS", "4RUNNER"],
  HONDA: ["ACCORD", "CIVIC", "CR-V", "PILOT", "ODYSSEY", "PASSPORT", "RIDGELINE", "HR-V"],
  NISSAN: ["ALTIMA", "ROGUE", "SENTRA", "PATHFINDER", "FRONTIER", "MURANO", "MAXIMA", "KICKS"],
  JEEP: ["GRAND CHEROKEE", "WRANGLER", "CHEROKEE", "COMPASS", "GLADIATOR", "RENEGADE"],
  RAM: ["1500", "2500", "3500", "PROMASTER"],
  GMC: ["SIERRA", "TERRAIN", "ACADIA", "YUKON", "CANYON"],
  HYUNDAI: ["ELANTRA", "TUCSON", "SANTA FE", "SONATA", "KONA", "PALISADE", "IONIQ"],
  KIA: ["SPORTAGE", "SORENTO", "FORTE", "TELLURIDE", "SOUL", "SELTOS", "CARNIVAL"],
  VOLKSWAGEN: ["JETTA", "TIGUAN", "ATLAS", "PASSAT", "GOLF"],
  BMW: ["3 SERIES", "5 SERIES", "X3", "X5", "X1"],
  MERCEDES: ["C CLASS", "E CLASS", "GLC", "GLE", "A CLASS"],
  SUBARU: ["OUTBACK", "FORESTER", "CROSSTREK", "IMPREZA", "LEGACY"],
  MAZDA: ["CX-5", "MAZDA3", "CX-9", "MAZDA6", "CX-30"],
  TESLA: ["MODEL 3", "MODEL Y", "MODEL S", "MODEL X"],
  DODGE: ["CHARGER", "CHALLENGER", "DURANGO", "JOURNEY"],
  CHRYSLER: ["PACIFICA", "300", "VOYAGER"],
  BUICK: ["ENCORE", "ENCLAVE", "ENVISION"],
  CADILLAC: ["ESCALADE", "XT5", "XT4", "CT5"],
};

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
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`NHTSA API error: ${res.status} ${res.statusText}`);
  }

  const data: NhtsaRecallsResponse = await res.json();
  return (data.results || []).map(r => ({ ...r, Make: make, Model: model, ModelYear: modelYear }));
}

/**
 * Fetch a broad set of recent NHTSA recalls using a curated make/model list.
 * Covers top-selling US vehicles across the last `maxYears` model years.
 * Much faster and more reliable than the discovery-based approach.
 */
export async function fetchRecentNhtsaRecalls(maxYears = 4): Promise<NhtsaRecall[]> {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: maxYears }, (_, i) => String(currentYear - i));

  const allRecalls: NhtsaRecall[] = [];
  const seen = new Set<string>();

  // Build a flat list of (make, model, year) combos to query
  const queries: Array<{ make: string; model: string; year: string }> = [];
  for (const year of years) {
    for (const [make, models] of Object.entries(TOP_MAKES_MODELS)) {
      for (const model of models) {
        queries.push({ make, model, year });
      }
    }
  }

  // Process in batches of 10 concurrent requests to avoid overwhelming the API
  const BATCH_SIZE = 10;
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ make, model, year }) => fetchRecallsByVehicle(make, model, year))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const recall of result.value) {
          if (recall.NHTSACampaignNumber && !seen.has(recall.NHTSACampaignNumber)) {
            seen.add(recall.NHTSACampaignNumber);
            allRecalls.push(recall);
          }
        }
      }
    }

    // Brief pause between batches
    if (i + BATCH_SIZE < queries.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return allRecalls;
}
