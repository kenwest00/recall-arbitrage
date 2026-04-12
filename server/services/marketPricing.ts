/**
 * Market Pricing Service
 * Fetches used market prices from eBay, Amazon, and Facebook Marketplace
 * for recalled products. Uses web scraping since most APIs require paid access.
 */

export interface PricingResult {
  platform: "ebay" | "amazon" | "facebook";
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
}

// ─── eBay Scraping ────────────────────────────────────────────────────────────

/**
 * Fetch eBay sold/completed listings for a product query.
 * Uses eBay's public search with LH_Complete=1&LH_Sold=1 filters.
 */
export async function fetchEbayPrices(query: string): Promise<PricingResult> {
  const searchQuery = encodeURIComponent(`${query} used`);
  // Search sold listings for accurate market pricing
  const url = `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}&LH_Complete=1&LH_Sold=1&_sop=13&LH_ItemCondition=3000`;

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
      return { platform: "ebay", listings: [], avgPrice: null, count: 0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const listings = parseEbayListings(html, query);

    const prices = listings.map((l) => l.price).filter((p) => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

    return { platform: "ebay", listings, avgPrice, count: listings.length };
  } catch (err) {
    return { platform: "ebay", listings: [], avgPrice: null, count: 0, error: String(err) };
  }
}

function parseEbayListings(html: string, query: string): PricingResult["listings"] {
  const listings: PricingResult["listings"] = [];

  // Extract price patterns from eBay HTML
  // Match sold price patterns: $XX.XX
  const pricePattern = /\$\s*([\d,]+\.?\d*)/g;
  const titlePattern = /<h3[^>]*class="[^"]*s-item__title[^"]*"[^>]*>(.*?)<\/h3>/gi;
  const urlPattern = /href="(https:\/\/www\.ebay\.com\/itm\/[^"]+)"/g;

  const prices: number[] = [];
  const titles: string[] = [];
  const urls: string[] = [];

  let match;
  while ((match = pricePattern.exec(html)) !== null && prices.length < 20) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price > 0.5 && price < 50000) {
      prices.push(price);
    }
  }

  while ((match = titlePattern.exec(html)) !== null && titles.length < 20) {
    const title = match[1].replace(/<[^>]+>/g, "").trim();
    if (title && title !== "Shop on eBay") {
      titles.push(title);
    }
  }

  while ((match = urlPattern.exec(html)) !== null && urls.length < 20) {
    urls.push(match[1].split("?")[0]);
  }

  const count = Math.min(prices.length, 10);
  for (let i = 0; i < count; i++) {
    listings.push({
      title: titles[i] || `${query} - Used`,
      price: prices[i],
      condition: "Used",
      url: urls[i] || `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
      quantity: 1,
    });
  }

  return listings;
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
        "Accept-Encoding": "gzip, deflate, br",
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

  // Extract prices from Amazon search results
  const pricePattern = /\$\s*([\d,]+\.?\d*)/g;
  const asinPattern = /\/dp\/([A-Z0-9]{10})/g;

  const prices: number[] = [];
  const asins: string[] = [];

  let match;
  while ((match = pricePattern.exec(html)) !== null && prices.length < 15) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price > 0.5 && price < 50000) {
      prices.push(price);
    }
  }

  while ((match = asinPattern.exec(html)) !== null && asins.length < 15) {
    if (!asins.includes(match[1])) {
      asins.push(match[1]);
    }
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
  // Facebook Marketplace requires JS rendering and login for full access.
  // We use a public search URL that returns some data without login.
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

  // Facebook embeds JSON data in __bbox and __data patterns
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

  // Try Google Shopping via a public search
  try {
    const googleResult = await fetchGoogleShoppingPrice(query);
    if (googleResult) results.push(googleResult);
  } catch {
    // continue
  }

  // Try Amazon current listing price
  try {
    const amazonResult = await fetchAmazonCurrentPrice(query);
    if (amazonResult) results.push(amazonResult);
  } catch {
    // continue
  }

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

  // Extract first price from Google Shopping results
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
  const searchQuery = encodeURIComponent(`${query}`);
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
  msrp: MsrpResult[];
}> {
  const [ebay, amazon, facebook, msrp] = await Promise.allSettled([
    fetchEbayPrices(productName),
    fetchAmazonPrices(productName),
    fetchFacebookPrices(productName),
    fetchMsrpPrice(productName),
  ]);

  return {
    ebay: ebay.status === "fulfilled" ? ebay.value : { platform: "ebay", listings: [], avgPrice: null, count: 0, error: "Failed" },
    amazon: amazon.status === "fulfilled" ? amazon.value : { platform: "amazon", listings: [], avgPrice: null, count: 0, error: "Failed" },
    facebook: facebook.status === "fulfilled" ? facebook.value : { platform: "facebook", listings: [], avgPrice: null, count: 0, error: "Failed" },
    msrp: msrp.status === "fulfilled" ? msrp.value : [],
  };
}
