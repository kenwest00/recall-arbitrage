/**
 * Validates eBay API credentials by requesting an OAuth2 client credentials token.
 * Run: node scripts/test-ebay-credentials.mjs
 */
import "dotenv/config";

const APP_ID = process.env.EBAY_APP_ID;
const CERT_ID = process.env.EBAY_CERT_ID;

if (!APP_ID || !CERT_ID) {
  console.error("❌ EBAY_APP_ID or EBAY_CERT_ID not set in environment.");
  process.exit(1);
}

const credentials = Buffer.from(`${APP_ID}:${CERT_ID}`).toString("base64");

try {
  const res = await fetch("https://api.sandbox.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  const data = await res.json();

  if (res.ok && data.access_token) {
    console.log("✅ eBay credentials valid!");
    console.log(`   Token type: ${data.token_type}`);
    console.log(`   Expires in: ${data.expires_in}s`);
    console.log(`   Token prefix: ${data.access_token.substring(0, 20)}...`);
    process.exit(0);
  } else {
    console.error("❌ eBay credential validation failed:");
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Network error:", err.message);
  process.exit(1);
}
