/**
 * Craigslist Client
 * Fetches used-market listings from Craigslist for recalled consumer products.
 * Uses best-effort HTML parsing (no paid API required).
 */

export interface CraigslistListing {
  title: string;
  price: number;
  condition: string;
  url: string;
  quantity: number;
}

export interface CraigslistResult {
  platform: "craigslist";
  listings: CraigslistListing[];
  avgPrice: number | null;
  count: number;
  error?: string;
}

// Top US Craigslist cities to search across
const CRAIGSLIST_CITIES = [
  "newyork",
  "losangeles",
  "chicago",
  "houston",
  "sfbay",
  "seattle",
  "denver",
  "atlanta",
  "dallas",
  "boston",
];

/**
 * Fetch Craigslist listings for a given search query across multiple cities.
 * Aggregates results and deduplicates by URL.
 */
export async function fetchCraigslistPrices(query: string): Promise<CraigslistResult> {
  const allListings: CraigslistListing[] = [];
  const seenUrls = new Set<string>();

  // Search a subset of cities concurrently (limit to 4 to avoid rate limiting)
  const citiesToSearch = CRAIGSLIST_CITIES.slice(0, 4);

  const results = await Promise.allSettled(
    citiesToSearch.map((city) => fetchCraigslistCity(city, query))
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const listing of result.value) {
        if (!seenUrls.has(listing.url)) {
          seenUrls.add(listing.url);
          allListings.push(listing);
        }
      }
    }
  }

  // Sort by price ascending and take top 10
  const sorted = allListings
    .filter((l) => l.price > 0)
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);

  const prices = sorted.map((l) => l.price);
  const avgPrice =
    prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;

  return {
    platform: "craigslist",
    listings: sorted,
    avgPrice,
    count: sorted.length,
  };
}

async function fetchCraigslistCity(
  city: string,
  query: string
): Promise<CraigslistListing[]> {
  const searchQuery = encodeURIComponent(query);
  const url = `https://${city}.craigslist.org/search/sss?query=${searchQuery}&sort=rel`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return [];

    const html = await res.text();
    return parseCraigslistListings(html, city, query);
  } catch {
    return [];
  }
}

function parseCraigslistListings(
  html: string,
  city: string,
  query: string
): CraigslistListing[] {
  const listings: CraigslistListing[] = [];

  // Match listing blocks: price and path patterns from Craigslist HTML
  const pricePattern = /\$\s*([\d,]+)/g;
  const pathPattern = /href="(\/[a-z]{3}\/d\/[^"]+\/\d+\.html)"/g;
  const titlePattern = /class="posting-title"[^>]*>\s*<span[^>]*>([^<]{5,120})<\/span>/g;

  const prices: number[] = [];
  const paths: string[] = [];
  const titles: string[] = [];

  let match;

  while ((match = pricePattern.exec(html)) !== null && prices.length < 15) {
    const price = parseFloat(match[1].replace(/,/g, ""));
    if (price > 0.5 && price < 50_000) prices.push(price);
  }

  while ((match = pathPattern.exec(html)) !== null && paths.length < 15) {
    if (!paths.includes(match[1])) paths.push(match[1]);
  }

  while ((match = titlePattern.exec(html)) !== null && titles.length < 15) {
    const title = match[1].trim();
    if (title.length > 3) titles.push(title);
  }

  const count = Math.min(prices.length, 5);
  for (let i = 0; i < count; i++) {
    listings.push({
      title: titles[i] || `${query} (Craigslist - ${city})`,
      price: prices[i],
      condition: "Used",
      url: paths[i]
        ? `https://${city}.craigslist.org${paths[i]}`
        : `https://${city}.craigslist.org/search/sss?query=${encodeURIComponent(query)}`,
      quantity: 1,
    });
  }

  return listings;
}
