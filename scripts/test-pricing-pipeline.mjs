/**
 * Diagnostic: test the full pricing pipeline for one recall.
 * Run: node scripts/test-pricing-pipeline.mjs
 */
import "dotenv/config";

// Test eBay API directly
async function testEbay(query) {
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  console.log("\n=== eBay API Test ===");
  console.log("App ID:", appId ? appId.slice(0, 20) + "..." : "MISSING");
  console.log("Cert ID:", certId ? certId.slice(0, 10) + "..." : "MISSING");

  const isSandbox = appId?.toUpperCase().includes("SBX") || appId?.includes("-SBX-");
  console.log("Environment:", isSandbox ? "SANDBOX" : "PRODUCTION");

  const oauthUrl = isSandbox
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";

  // Get token
  const credentials = Buffer.from(`${appId}:${certId}`).toString("base64");
  const tokenRes = await fetch(oauthUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.log("Token ERROR:", tokenRes.status, err.slice(0, 200));
    return;
  }

  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  console.log("Token acquired:", token.slice(0, 20) + "...");

  // Test Finding API (completed items)
  const findingUrl = isSandbox
    ? "https://svcs.sandbox.ebay.com/services/search/FindingService/v1"
    : "https://svcs.ebay.com/services/search/FindingService/v1";

  const params = new URLSearchParams({
    "OPERATION-NAME": "findCompletedItems",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "",
    keywords: query,
    "paginationInput.entriesPerPage": "5",
    "sortOrder": "PricePlusShippingHighest",
    "itemFilter(0).name": "SoldItemsOnly",
    "itemFilter(0).value": "true",
  });

  const findRes = await fetch(`${findingUrl}?${params}`, {
    headers: { "X-EBAY-SOA-SECURITY-TOKEN": token },
  });

  console.log("\nFinding API status:", findRes.status);
  const findData = await findRes.json();
  const items = findData.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];
  console.log("Finding API items returned:", items.length);
  items.slice(0, 3).forEach(item => {
    const price = item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
    console.log(" -", item.title?.[0]?.slice(0, 50), "| $" + price);
  });

  // Test Browse API (active listings)
  const browseUrl = isSandbox
    ? "https://api.sandbox.ebay.com/buy/browse/v1"
    : "https://api.ebay.com/buy/browse/v1";

  const browseParams = new URLSearchParams({
    q: query,
    limit: "5",
    filter: "conditions:{USED|VERY_GOOD|GOOD|ACCEPTABLE}",
  });

  const browseRes = await fetch(`${browseUrl}/item_summary/search?${browseParams}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  console.log("\nBrowse API status:", browseRes.status);
  if (browseRes.ok) {
    const browseData = await browseRes.json();
    const summaries = browseData.itemSummaries ?? [];
    console.log("Browse API items returned:", summaries.length, "| total:", browseData.total);
    summaries.slice(0, 3).forEach(item => {
      console.log(" -", item.title?.slice(0, 50), "| $" + item.price?.value);
    });
  } else {
    const errText = await browseRes.text();
    console.log("Browse API ERROR:", errText.slice(0, 300));
  }
}

// Test Amazon scraping
async function testAmazon(query) {
  console.log("\n=== Amazon Test ===");
  const searchQuery = encodeURIComponent(`${query} used`);
  const url = `https://www.amazon.com/s?k=${searchQuery}&rh=p_n_condition-type%3A2224371011`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });
    console.log("Amazon HTTP status:", res.status);
    const html = await res.text();
    const prices = [...html.matchAll(/\$\s*([\d,]+\.?\d*)/g)]
      .map(m => parseFloat(m[1].replace(/,/g, "")))
      .filter(p => p > 0.5 && p < 50000)
      .slice(0, 5);
    console.log("Prices found:", prices);
    const captcha = html.includes("captcha") || html.includes("robot");
    if (captcha) console.log("WARNING: Amazon returned CAPTCHA/bot detection page");
  } catch (err) {
    console.log("Amazon ERROR:", err.message);
  }
}

// Test Facebook Marketplace
async function testFacebook(query) {
  console.log("\n=== Facebook Marketplace Test ===");
  const url = `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });
    console.log("Facebook HTTP status:", res.status);
    const html = await res.text();
    const prices = [...html.matchAll(/"listing_price":\{"amount":"([\d.]+)"/g)]
      .map(m => parseFloat(m[1]))
      .filter(p => p > 0)
      .slice(0, 5);
    console.log("Prices found:", prices);
    const loginWall = html.includes("login") && prices.length === 0;
    if (loginWall) console.log("WARNING: Facebook requires login — returns no data without auth");
  } catch (err) {
    console.log("Facebook ERROR:", err.message);
  }
}

const query = "LED lights recalled";
console.log("Testing pricing pipeline for query:", JSON.stringify(query));

await testEbay(query);
await testAmazon(query);
await testFacebook(query);

console.log("\n=== Done ===");
