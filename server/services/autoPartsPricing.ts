/**
 * Auto Parts Pricing Service
 * Fetches used/salvage auto part prices from national used auto parts platforms.
 * Used specifically for NHTSA vehicle/component recalls.
 *
 * Platforms:
 *   - eBay Motors (completed/sold listings for auto parts)
 *   - RockAuto (new/remanufactured pricing — useful as MSRP baseline)
 *   - Car-Part.com (salvage yard / used OEM parts)
 *   - LKQ Corporation / Pick-n-Pull (used OEM parts network)
 */

export type AutoPartsPlatform = "ebaymotors" | "rockauto" | "carpart" | "lkq";

export interface AutoPartsListing {
  title: string;
  price: number;
  condition: string;
  url: string;
  quantity: number;
  partNumber?: string;
  location?: string;
}

export interface AutoPartsPricingResult {
  platform: AutoPartsPlatform;
  listings: AutoPartsListing[];
  avgPrice: number | null;
  count: number;
  error?: string;
}

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function fetchHtml(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function avgPrices(listings: AutoPartsListing[]): number | null {
  const prices = listings.map((l) => l.price).filter((p) => p > 0);
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

// ─── eBay Motors ──────────────────────────────────────────────────────────────

/**
 * Search eBay Motors completed/sold listings for auto parts.
 * Category 6030 = Auto Parts & Accessories on eBay.
 */
export async function fetchEbayMotorsPrices(query: string): Promise<AutoPartsPricingResult> {
  const q = encodeURIComponent(query);
  // LH_Complete=1&LH_Sold=1 = completed sold listings; sacat=6030 = Auto Parts
  const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&sacat=6030&LH_Complete=1&LH_Sold=1&_sop=13`;

  try {
    const html = await fetchHtml(url);
    const listings = parseEbayMotorsHtml(html, query);
    return {
      platform: "ebaymotors",
      listings,
      avgPrice: avgPrices(listings),
      count: listings.length,
    };
  } catch (err) {
    return { platform: "ebaymotors", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseEbayMotorsHtml(html: string, query: string): AutoPartsListing[] {
  const listings: AutoPartsListing[] = [];

  // Extract sold prices
  const priceRe = /\$\s*([\d,]+\.?\d*)/g;
  const titleRe = /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(.*?)<\/h3>/gi;
  const urlRe = /href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+)/g;

  const prices: number[] = [];
  const titles: string[] = [];
  const urls: string[] = [];

  let m;
  while ((m = priceRe.exec(html)) !== null && prices.length < 20) {
    const p = parseFloat(m[1].replace(/,/g, ""));
    if (p > 1 && p < 100_000) prices.push(p);
  }
  while ((m = titleRe.exec(html)) !== null && titles.length < 20) {
    const t = m[1].replace(/<[^>]+>/g, "").trim();
    if (t && t !== "Shop on eBay") titles.push(t);
  }
  while ((m = urlRe.exec(html)) !== null && urls.length < 20) {
    urls.push(m[1]);
  }

  for (let i = 0; i < Math.min(prices.length, 10); i++) {
    listings.push({
      title: titles[i] || `${query} (eBay Motors)`,
      price: prices[i],
      condition: "Used",
      url: urls[i] || `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&sacat=6030`,
      quantity: 1,
    });
  }
  return listings;
}

// ─── RockAuto ─────────────────────────────────────────────────────────────────

/**
 * Fetch RockAuto pricing for a part.
 * RockAuto is primarily new/remanufactured — useful as a retail price baseline.
 */
export async function fetchRockAutoPrices(query: string): Promise<AutoPartsPricingResult> {
  const q = encodeURIComponent(query);
  const url = `https://www.rockauto.com/en/partsearch/?query=${q}`;

  try {
    const html = await fetchHtml(url, { Referer: "https://www.rockauto.com/" });
    const listings = parseRockAutoHtml(html, query);
    return {
      platform: "rockauto",
      listings,
      avgPrice: avgPrices(listings),
      count: listings.length,
    };
  } catch (err) {
    return { platform: "rockauto", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseRockAutoHtml(html: string, query: string): AutoPartsListing[] {
  const listings: AutoPartsListing[] = [];

  // RockAuto embeds prices in JSON-like structures and data attributes
  const priceRe = /\$\s*([\d,]+\.?\d*)/g;
  const partRe = /part[_-]?(?:number|num|no)[:\s"]*([A-Z0-9\-]{4,20})/gi;

  const prices: number[] = [];
  const parts: string[] = [];

  let m;
  while ((m = priceRe.exec(html)) !== null && prices.length < 15) {
    const p = parseFloat(m[1].replace(/,/g, ""));
    if (p > 0.5 && p < 10_000) prices.push(p);
  }
  while ((m = partRe.exec(html)) !== null && parts.length < 15) {
    parts.push(m[1]);
  }

  for (let i = 0; i < Math.min(prices.length, 8); i++) {
    listings.push({
      title: `${query} - New/Reman (RockAuto)`,
      price: prices[i],
      condition: "New/Remanufactured",
      url: `https://www.rockauto.com/en/partsearch/?query=${encodeURIComponent(query)}`,
      quantity: 1,
      partNumber: parts[i],
    });
  }
  return listings;
}

// ─── Car-Part.com ─────────────────────────────────────────────────────────────

/**
 * Fetch Car-Part.com salvage/used OEM parts pricing.
 * Car-Part.com aggregates inventory from hundreds of salvage yards nationwide.
 */
export async function fetchCarPartPrices(query: string): Promise<AutoPartsPricingResult> {
  // Car-Part.com search endpoint
  const q = encodeURIComponent(query);
  const url = `https://www.car-part.com/cgi-bin/search.cgi?q=${q}&searchtype=0`;

  try {
    const html = await fetchHtml(url, { Referer: "https://www.car-part.com/" });
    const listings = parseCarPartHtml(html, query);
    return {
      platform: "carpart",
      listings,
      avgPrice: avgPrices(listings),
      count: listings.length,
    };
  } catch (err) {
    return { platform: "carpart", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseCarPartHtml(html: string, query: string): AutoPartsListing[] {
  const listings: AutoPartsListing[] = [];

  const priceRe = /\$\s*([\d,]+\.?\d*)/g;
  const locationRe = /([A-Z][a-z]+,\s*[A-Z]{2})/g;

  const prices: number[] = [];
  const locations: string[] = [];

  let m;
  while ((m = priceRe.exec(html)) !== null && prices.length < 15) {
    const p = parseFloat(m[1].replace(/,/g, ""));
    if (p > 1 && p < 50_000) prices.push(p);
  }
  while ((m = locationRe.exec(html)) !== null && locations.length < 15) {
    locations.push(m[1]);
  }

  for (let i = 0; i < Math.min(prices.length, 8); i++) {
    listings.push({
      title: `${query} - Used OEM (Car-Part.com)`,
      price: prices[i],
      condition: "Used OEM",
      url: `https://www.car-part.com/cgi-bin/search.cgi?q=${encodeURIComponent(query)}&searchtype=0`,
      quantity: 1,
      location: locations[i],
    });
  }
  return listings;
}

// ─── LKQ / Pick-n-Pull ────────────────────────────────────────────────────────

/**
 * Fetch LKQ/Pick-n-Pull pricing for used OEM parts.
 * LKQ is the largest used auto parts network in North America.
 */
export async function fetchLkqPrices(query: string): Promise<AutoPartsPricingResult> {
  const q = encodeURIComponent(query);
  const url = `https://www.lkqonline.com/search?query=${q}&category=auto-parts`;

  try {
    const html = await fetchHtml(url, { Referer: "https://www.lkqonline.com/" });
    const listings = parseLkqHtml(html, query);
    return {
      platform: "lkq",
      listings,
      avgPrice: avgPrices(listings),
      count: listings.length,
    };
  } catch (err) {
    return { platform: "lkq", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseLkqHtml(html: string, query: string): AutoPartsListing[] {
  const listings: AutoPartsListing[] = [];

  const priceRe = /\$\s*([\d,]+\.?\d*)/g;
  const titleRe = /"name"\s*:\s*"([^"]{5,100})"/g;

  const prices: number[] = [];
  const titles: string[] = [];

  let m;
  while ((m = priceRe.exec(html)) !== null && prices.length < 15) {
    const p = parseFloat(m[1].replace(/,/g, ""));
    if (p > 1 && p < 50_000) prices.push(p);
  }
  while ((m = titleRe.exec(html)) !== null && titles.length < 15) {
    titles.push(m[1]);
  }

  for (let i = 0; i < Math.min(prices.length, 8); i++) {
    listings.push({
      title: titles[i] || `${query} - Used OEM (LKQ)`,
      price: prices[i],
      condition: "Used OEM",
      url: `https://www.lkqonline.com/search?query=${encodeURIComponent(query)}`,
      quantity: 1,
    });
  }
  return listings;
}

// ─── Combined auto parts fetch ────────────────────────────────────────────────

export interface AllAutoPartsPrices {
  ebayMotors: AutoPartsPricingResult;
  rockAuto: AutoPartsPricingResult;
  carPart: AutoPartsPricingResult;
  lkq: AutoPartsPricingResult;
  blendedAvg: number | null;
  totalCount: number;
}

export async function fetchAllAutoPartsPrices(query: string): Promise<AllAutoPartsPrices> {
  const [ebayMotors, rockAuto, carPart, lkq] = await Promise.allSettled([
    fetchEbayMotorsPrices(query),
    fetchRockAutoPrices(query),
    fetchCarPartPrices(query),
    fetchLkqPrices(query),
  ]);

  const results = {
    ebayMotors: ebayMotors.status === "fulfilled" ? ebayMotors.value : { platform: "ebaymotors" as const, listings: [], avgPrice: null, count: 0, error: "Failed" },
    rockAuto: rockAuto.status === "fulfilled" ? rockAuto.value : { platform: "rockauto" as const, listings: [], avgPrice: null, count: 0, error: "Failed" },
    carPart: carPart.status === "fulfilled" ? carPart.value : { platform: "carpart" as const, listings: [], avgPrice: null, count: 0, error: "Failed" },
    lkq: lkq.status === "fulfilled" ? lkq.value : { platform: "lkq" as const, listings: [], avgPrice: null, count: 0, error: "Failed" },
  };

  // Blend only used-market sources (eBay Motors, Car-Part, LKQ) — exclude RockAuto (new parts)
  const usedAvgs = [results.ebayMotors.avgPrice, results.carPart.avgPrice, results.lkq.avgPrice]
    .filter((p): p is number => p !== null);

  const blendedAvg = usedAvgs.length > 0
    ? usedAvgs.reduce((a, b) => a + b, 0) / usedAvgs.length
    : null;

  const totalCount = results.ebayMotors.count + results.carPart.count + results.lkq.count;

  return { ...results, blendedAvg, totalCount };
}
