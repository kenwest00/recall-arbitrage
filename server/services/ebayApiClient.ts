/**
 * eBay API Client
 *
 * Supports both Sandbox and Production environments.
 * Uses OAuth2 Client Credentials flow (no user login required).
 *
 * APIs used:
 *   - Finding API (findCompletedItems): sold/completed listings
 *   - Browse API (search): current active listings + quantity
 *
 * Environment detection:
 *   Set EBAY_SANDBOX=true to use sandbox endpoints (default when App ID contains "SBX" or sandbox token prefix).
 */

import { ENV } from "../_core/env";

// ─── Environment detection ────────────────────────────────────────────────────

function isSandbox(): boolean {
  const appId = process.env.EBAY_APP_ID || "";
  // Sandbox App IDs typically contain "SBX" or end in sandbox-style suffixes
  return (
    process.env.EBAY_SANDBOX === "true" ||
    appId.toUpperCase().includes("SBX") ||
    appId.includes("-SBX-") ||
    appId.includes("sandbox")
  );
}

const EBAY_OAUTH_URL = isSandbox()
  ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
  : "https://api.ebay.com/identity/v1/oauth2/token";

const EBAY_FINDING_URL = isSandbox()
  ? "https://svcs.sandbox.ebay.com/services/search/FindingService/v1"
  : "https://svcs.ebay.com/services/search/FindingService/v1";

const EBAY_BROWSE_URL = isSandbox()
  ? "https://api.sandbox.ebay.com/buy/browse/v1"
  : "https://api.ebay.com/buy/browse/v1";

// ─── Token cache ──────────────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix ms
}

let _tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (_tokenCache && _tokenCache.expiresAt - 60_000 > now) {
    return _tokenCache.accessToken;
  }

  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;

  if (!appId || !certId) {
    throw new Error("EBAY_APP_ID and EBAY_CERT_ID must be set in environment.");
  }

  const credentials = Buffer.from(`${appId}:${certId}`).toString("base64");

  const res = await fetch(EBAY_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`eBay OAuth failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return _tokenCache.accessToken;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EbayListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  condition: string;
  listingUrl: string;
  imageUrl?: string;
  soldDate?: string;
  quantity: number;
  location?: string;
}

export interface EbaySearchResult {
  listings: EbayListing[];
  totalCount: number;
  avgPrice: number | null;
  error?: string;
}

// ─── Finding API — Completed/Sold Listings ────────────────────────────────────

/**
 * Search eBay completed (sold) listings using the Finding API.
 * @param query     Product search keywords
 * @param categoryId  Optional eBay category ID (6030 = Auto Parts & Accessories)
 * @param maxResults  Max listings to return (default 20)
 */
export async function findCompletedItems(
  query: string,
  categoryId?: string,
  maxResults = 20
): Promise<EbaySearchResult> {
  try {
    const token = await getAccessToken();
    const appId = process.env.EBAY_APP_ID!;

    const params = new URLSearchParams({
      "OPERATION-NAME": "findCompletedItems",
      "SERVICE-VERSION": "1.13.0",
      "SECURITY-APPNAME": appId,
      "RESPONSE-DATA-FORMAT": "JSON",
      "REST-PAYLOAD": "",
      "keywords": query,
      "paginationInput.entriesPerPage": String(Math.min(maxResults, 100)),
      "sortOrder": "PricePlusShippingHighest",
      // Only sold items
      "itemFilter(0).name": "SoldItemsOnly",
      "itemFilter(0).value": "true",
      // Condition: Used (3000) or any
      "itemFilter(1).name": "Condition",
      "itemFilter(1).value(0)": "3000",
      "itemFilter(1).value(1)": "2500",
      "itemFilter(1).value(2)": "2000",
    });

    if (categoryId) {
      params.set("categoryId", categoryId);
    }

    const url = `${EBAY_FINDING_URL}?${params.toString()}`;
    // Finding API uses App ID in URL only — no OAuth token header needed
    // Retry up to 3 times with exponential backoff on rate limit / server errors
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok || res.status === 404) break;
      // On rate limit or server error, wait and retry
      const body = await res.text();
      if (body.includes('10001') || body.includes('RateLimiter')) {
        console.warn(`[eBay Finding API] Rate limited on attempt ${attempt + 1}, backing off...`);
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      throw new Error(`Finding API HTTP ${res.status}`);
    }
    if (!res || !res.ok) {
      throw new Error(`Finding API failed after retries: HTTP ${res?.status}`);
    }

    const data = await res.json() as FindingApiResponse;
    return parseFindingApiResponse(data);
  } catch (err) {
    console.error("[eBay Finding API] Error:", err);
    return { listings: [], totalCount: 0, avgPrice: null, error: String(err) };
  }
}

// ─── Browse API — Current Active Listings ─────────────────────────────────────

/**
 * Search eBay current active listings using the Browse API.
 * Useful for checking current availability and quantity.
 * @param query       Product search keywords
 * @param categoryIds Optional comma-separated category IDs
 * @param maxResults  Max listings to return (default 20)
 */
export async function browseItems(
  query: string,
  categoryIds?: string,
  maxResults = 20
): Promise<EbaySearchResult> {
  try {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(maxResults, 200)),
      filter: "conditions:{USED|VERY_GOOD|GOOD|ACCEPTABLE}",
      sort: "price",
    });

    if (categoryIds) {
      params.set("category_ids", categoryIds);
    }

    const url = `${EBAY_BROWSE_URL}/item_summary/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Browse API HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as BrowseApiResponse;
    return parseBrowseApiResponse(data);
  } catch (err) {
    console.error("[eBay Browse API] Error:", err);
    return { listings: [], totalCount: 0, avgPrice: null, error: String(err) };
  }
}

// ─── eBay Motors specific wrappers ────────────────────────────────────────────

/** eBay Motors category ID for Auto Parts & Accessories */
const EBAY_MOTORS_CATEGORY = "6030";

/**
 * Search eBay Motors completed/sold listings for auto parts.
 */
export async function findCompletedMotorsParts(
  query: string,
  maxResults = 20
): Promise<EbaySearchResult> {
  return findCompletedItems(query, EBAY_MOTORS_CATEGORY, maxResults);
}

/**
 * Search eBay Motors current active listings for auto parts.
 */
export async function browseMotorsParts(
  query: string,
  maxResults = 20
): Promise<EbaySearchResult> {
  return browseItems(query, EBAY_MOTORS_CATEGORY, maxResults);
}

// ─── Response parsers ─────────────────────────────────────────────────────────

interface FindingApiResponse {
  findCompletedItemsResponse?: Array<{
    ack?: string[];
    searchResult?: Array<{
      "@count"?: string;
      item?: FindingApiItem[];
    }>;
    paginationOutput?: Array<{ totalEntries?: string[] }>;
  }>;
}

interface FindingApiItem {
  itemId?: string[];
  title?: string[];
  viewItemURL?: string[];
  sellingStatus?: Array<{
    currentPrice?: Array<{ __value__?: string; "@currencyId"?: string }>;
    soldDate?: string[];
  }>;
  condition?: Array<{ conditionDisplayName?: string[] }>;
  primaryCategory?: Array<{ categoryName?: string[] }>;
  location?: string[];
  quantity?: string[];
}

function parseFindingApiResponse(data: FindingApiResponse): EbaySearchResult {
  const response = data.findCompletedItemsResponse?.[0];
  if (!response) return { listings: [], totalCount: 0, avgPrice: null };

  const items = response.searchResult?.[0]?.item ?? [];
  const totalCount = parseInt(response.paginationOutput?.[0]?.totalEntries?.[0] ?? "0");

  const listings: EbayListing[] = [];

  for (const item of items) {
    const priceStr = item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
    const price = priceStr ? parseFloat(priceStr) : 0;
    if (price <= 0) continue;

    listings.push({
      itemId: item.itemId?.[0] ?? "",
      title: item.title?.[0] ?? "",
      price,
      currency: item.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"] ?? "USD",
      condition: item.condition?.[0]?.conditionDisplayName?.[0] ?? "Used",
      listingUrl: item.viewItemURL?.[0] ?? "",
      soldDate: item.sellingStatus?.[0]?.soldDate?.[0],
      quantity: parseInt(item.quantity?.[0] ?? "1"),
      location: item.location?.[0],
    });
  }

  const prices = listings.map((l) => l.price).filter((p) => p > 0);
  const avgPrice = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : null;

  return { listings, totalCount, avgPrice };
}

interface BrowseApiResponse {
  total?: number;
  itemSummaries?: BrowseApiItem[];
}

interface BrowseApiItem {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  condition?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  itemLocation?: { postalCode?: string; country?: string };
  availableCoupons?: boolean;
}

function parseBrowseApiResponse(data: BrowseApiResponse): EbaySearchResult {
  const items = data.itemSummaries ?? [];
  const totalCount = data.total ?? items.length;

  const listings: EbayListing[] = [];

  for (const item of items) {
    const price = item.price?.value ? parseFloat(item.price.value) : 0;
    if (price <= 0) continue;

    listings.push({
      itemId: item.itemId ?? "",
      title: item.title ?? "",
      price,
      currency: item.price?.currency ?? "USD",
      condition: item.condition ?? "Used",
      listingUrl: item.itemWebUrl ?? "",
      imageUrl: item.image?.imageUrl,
      quantity: 1,
      location: item.itemLocation?.country,
    });
  }

  const prices = listings.map((l) => l.price).filter((p) => p > 0);
  const avgPrice = prices.length > 0
    ? prices.reduce((a, b) => a + b, 0) / prices.length
    : null;

  return { listings, totalCount, avgPrice };
}

// ─── Combined: sold + active for a query ─────────────────────────────────────

export interface EbayCombinedResult {
  sold: EbaySearchResult;
  active: EbaySearchResult;
  /** Blended avg: prefers sold prices, falls back to active */
  blendedAvg: number | null;
  totalAvailable: number;
  isSandbox: boolean;
}

export async function fetchEbayPrices(
  query: string,
  isAutoPartQuery = false
): Promise<EbayCombinedResult> {
  const categoryId = isAutoPartQuery ? EBAY_MOTORS_CATEGORY : undefined;

  const [sold, active] = await Promise.allSettled([
    findCompletedItems(query, categoryId, 20),
    browseItems(query, categoryId, 20),
  ]);

  const soldResult = sold.status === "fulfilled" ? sold.value : { listings: [], totalCount: 0, avgPrice: null, error: "Failed" };
  const activeResult = active.status === "fulfilled" ? active.value : { listings: [], totalCount: 0, avgPrice: null, error: "Failed" };

  // Prefer sold prices for profit calculation (more accurate)
  const blendedAvg = soldResult.avgPrice ?? activeResult.avgPrice;

  return {
    sold: soldResult,
    active: activeResult,
    blendedAvg,
    totalAvailable: activeResult.totalCount,
    isSandbox: isSandbox(),
  };
}
