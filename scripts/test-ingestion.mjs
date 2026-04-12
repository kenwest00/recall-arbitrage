/**
 * Quick diagnostic: fetch CPSC recalls and check DB state
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);

// Check current recall count
const [rows] = await db.execute("SELECT COUNT(*) as cnt FROM recalls");
console.log("Current recall count:", rows[0].cnt);

// Check sync log
const [logs] = await db.execute("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 5");
console.log("Recent sync logs:", JSON.stringify(logs, null, 2));

// Test CPSC API directly
console.log("\nTesting CPSC API...");
const res = await fetch("https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2025-01-01&limit=5&offset=0");
const data = await res.json();
console.log("CPSC API status:", res.status);
console.log("CPSC records returned:", Array.isArray(data) ? data.length : "not an array");
if (Array.isArray(data) && data.length > 0) {
  console.log("First recall:", data[0].Title, "| Remedy:", data[0].Remedies?.[0]?.Name?.slice(0, 80));
}

await db.end();
