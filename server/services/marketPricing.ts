/**
 * Market Pricing Service
 * Fetches used market prices from eBay (official API), Amazon, Facebook Marketplace,
 * and Craigslist for recalled CPSC consumer products.
 *
 * eBay now uses the official Finding API + Browse API via ebayApiClient.ts.
 * Amazon, Facebook Marketplace, and Craigslist use best-effort HTML parsing (no paid API required).
 */

import { fetchEbayPrices as fetchEbayApiPrices } from "./ebayApiClient";
import { fetchCraigslistPrices, type CraigslistResult } from "./craigslistClient";

export interface PricingResult {
  platform: "ebay" | "amazon" | "facebook" | "craigslist";
  listings: Array<{
    title: string;
    price: number;
    condition: string;
    url: string;
    quantity: number;
  }>;
  avgPrice: number | null;
  count: number;
  error?: string;
  /** true when results come from eBay Sandbox (simulated data) */
  isSandbox?: boolean;
}

// ─── eBay — Official API ──────────────────────────────────────────────────────

/**
 * Fetch eBay sold/completed listings using the official Finding API.
 * Falls back gracefully if credentials are missing.
 */
export async function fetchEbayPrices(query: string): Promise<PricingResult> {
  try {
    const result = await fetchEbayApiPrices(query, false);

    // Prefer sold listings for pricing; fall back to active
    const source = result.sold.listings.length > 0 ? result.sold : result.active;

    return {
      platform: "ebay",
      listings: source.listings.map((l) => ({
        title: l.title,
        price: l.price,
        condition: l.condition,
        url: l.listingUrl,
        quantity: l.quantity,
      })),
      avgPrice: result.blendedAvg,
      count: source.listings.length,
      isSandbox: result.isSandbox,
      error: source.error,
    };
  } catch (err) {
    return { platform: "ebay", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

// ─── Amazon Scraping ──────────────────────────────────────────────────────────

export async function fetchAmazonPrices(query: string): Promise<PricingResult> {
  const searchQuery = encodeURIComponent(`${query} used`);
  const url = `https://www.amazon.com/s?k=${searchQuery}&rh=p_n_condition-type%3A2224371011`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return { platform: "amazon", listings: [], avgPrice: null, count: 0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const listings = parseAmazonListings(html, query);

    const prices = listings.map((l) => l.price).filter((p) => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

    return { platform: "amazon", listings, avgPrice, count: listings.length };
  } catch (err) {
    return { platform: "amazon", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseAmazonListings(html: string, query: string): PricingResult["listings"] {
  const listings: PricingResult["listings"] = [];
  const pricePattern = /\$\s*([\d,]+\.?\d*)/g;
  const asinPattern = /\/dp\/([A-Z0-9]{10})/g;

  const prices: number[] = [];
  const asins: string[] = [];

  let match;
  while ((match = pricePattern.exec(html)) !== null && prices.length < 15) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price > 0.5 && price < 50000) prices.push(price);
  }

  while ((match = asinPattern.exec(html)) !== null && asins.length < 15) {
    if (!asins.includes(match[1])) asins.push(match[1]);
  }

  const count = Math.min(prices.length, 8);
  for (let i = 0; i < count; i++) {
    listings.push({
      title: `${query} - Used (Amazon)`,
      price: prices[i],
      condition: "Used",
      url: asins[i]
        ? `https://www.amazon.com/dp/${asins[i]}?condition=used`
        : `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
      quantity: 1,
    });
  }

  return listings;
}

// ─── Facebook Marketplace ─────────────────────────────────────────────────────

export async function fetchFacebookPrices(query: string): Promise<PricingResult> {
  const searchQuery = encodeURIComponent(query);
  const url = `https://www.facebook.com/marketplace/search/?query=${searchQuery}&exact=false`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return { platform: "facebook", listings: [], avgPrice: null, count: 0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const listings = parseFacebookListings(html, query);

    const prices = listings.map((l) => l.price).filter((p) => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

    return { platform: "facebook", listings, avgPrice, count: listings.length };
  } catch (err) {
    return { platform: "facebook", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseFacebookListings(html: string, query: string): PricingResult["listings"] {
  const listings: PricingResult["listings"] = [];
  const pricePattern = /"listing_price":\{"amount":"([\d.]+)"/g;
  const titlePattern = /"name":"([^"]{5,100})"/g;
  const idPattern = /"id":"(\d{15,20})"/g;

  const prices: number[] = [];
  const titles: string[] = [];
  const ids: string[] = [];

  let match;
  while ((match = pricePattern.exec(html)) !== null && prices.length < 15) {
    const price = parseFloat(match[1]);
    if (price > 0.5 && price < 50000) prices.push(price);
  }

  while ((match = titlePattern.exec(html)) !== null && titles.length < 15) {
    const title = match[1];
    if (!title.includes("\\") && title.length > 3) titles.push(title);
  }

  while ((match = idPattern.exec(html)) !== null && ids.length < 15) {
    ids.push(match[1]);
  }

  const count = Math.min(prices.length, 8);
  for (let i = 0; i < count; i++) {
    listings.push({
      title: titles[i] || `${query} - Used (Facebook)`,
      price: prices[i],
      condition: "Used",
      url: ids[i]
        ? `https://www.facebook.com/marketplace/item/${ids[i]}/`
        : `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`,
      quantity: 1,
    });
  }

  return listings;
}

// ─── Craigslist ───────────────────────────────────────────────────────────────

export async function fetchCraigslistPricesWrapped(query: string): Promise<PricingResult> {
  try {
    const result: CraigslistResult = await fetchCraigslistPrices(query);
    return {
      platform: "craigslist",
      listings: result.listings,
      avgPrice: result.avgPrice,
      count: result.count,
      error: result.error,
    };
  } catch (err) {
    return { platform: "craigslist", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

// ─── MSRP Lookup ─────────────────────────────────────────────────────────────

export interface MsrpResult {
  source: string;
  price: number | null;
  url: string;
  title: string;
  error?: string;
}

export async function fetchMsrpPrice(query: string): Promise<MsrpResult[]> {
  const results: MsrpResult[] = [];

  try {
    const googleResult = await fetchGoogleShoppingPrice(query);
    if (googleResult) results.push(googleResult);
  } catch { /* continue */ }

  try {
    const amazonResult = await fetchAmazonCurrentPrice(query);
    if (amazonResult) results.push(amazonResult);
  } catch { /* continue */ }

  return results;
}

async function fetchGoogleShoppingPrice(query: string): Promise<MsrpResult | null> {
  const searchQuery = encodeURIComponent(`${query} buy new price`);
  const url = `https://www.google.com/search?q=${searchQuery}&tbm=shop`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;
  const html = await res.text();

  const priceMatch = html.match(/\$\s*([\d,]+\.?\d*)/);
  if (!priceMatch) return null;

  const price = parseFloat(priceMatch[1].replace(/,/g, ""));
  if (price <= 0 || price > 100000) return null;

  return {
    source: "Google Shopping",
    price,
    url: `https://www.google.com/search?q=${searchQuery}&tbm=shop`,
    title: `${query} (New)`,
  };
}

async function fetchAmazonCurrentPrice(query: string): Promise<MsrpResult | null> {
  const searchQuery = encodeURIComponent(query);
  const url = `https://www.amazon.com/s?k=${searchQuery}&rh=p_n_condition-type%3A1294423011`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) return null;
  const html = await res.text();

  const priceMatch = html.match(/\$\s*([\d,]+\.?\d*)/);
  if (!priceMatch) return null;

  const price = parseFloat(priceMatch[1].replace(/,/g, ""));
  if (price <= 0 || price > 100000) return null;

  const asinMatch = html.match(/\/dp\/([A-Z0-9]{10})/);

  return {
    source: "Amazon",
    price,
    url: asinMatch
      ? `https://www.amazon.com/dp/${asinMatch[1]}`
      : `https://www.amazon.com/s?k=${searchQuery}`,
    title: `${query} (New - Amazon)`,
  };
}

// ─── Combined fetch for a recall ─────────────────────────────────────────────

export async function fetchAllPricesForProduct(productName: string): Promise<{
  ebay: PricingResult;
  amazon: PricingResult;
  facebook: PricingResult;
  craigslist: PricingResult;
  msrp: MsrpResult[];
}> {
  const [ebay, amazon, facebook, craigslist, msrp] = await Promise.allSettled([
    fetchEbayPrices(productName),
    fetchAmazonPrices(productName),
    fetchFacebookPrices(productName),
    fetchCraigslistPricesWrapped(productName),
    fetchMsrpPrice(productName),
  ]);

  return {
    ebay: ebay.status === "fulfilled" ? ebay.value : { platform: "ebay", listings: [], avgPrice: null, count: 0, error: "Failed" },
    amazon: amazon.status === "fulfilled" ? amazon.value : { platform: "amazon", listings: [], avgPrice: null, count: 0, error: "Failed" },
    facebook: facebook.status === "fulfilled" ? facebook.value : { platform: "facebook", listings: [], avgPrice: null, count: 0, error: "Failed" },
    craigslist: craigslist.status === "fulfilled" ? craigslist.value : { platform: "craigslist", listings: [], avgPrice: null, count: 0, error: "Failed" },
    msrp: msrp.status === "fulfilled" ? msrp.value : [],
  };
}
