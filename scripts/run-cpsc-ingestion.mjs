/**
 * Run CPSC ingestion directly and report results.
 * Uses the same logic as the server-side service.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const CPSC_BASE = "https://www.saferproducts.gov/RestWebServices/Recall";
const PAGE_SIZE = 100;

function extractRefundValue(text) {
  if (!text) return { value: null, notes: "" };
  const refundPatterns = [
    /refund[^.]*?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)[^.]*?refund/i,
    /full\s+(?:purchase\s+)?(?:price|refund)/i,
    /reimburse[^.]*?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:cash\s+)?refund/i,
  ];
  for (const pattern of refundPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[1]) return { value: parseFloat(match[1].replace(/,/g, "")), notes: match[0].trim() };
      return { value: null, notes: match[0].trim() };
    }
  }
  return { value: null, notes: "" };
}

function isRefundRemedy(remedies) {
  return remedies?.some(r => /refund|reimburse|money back|cash back/i.test(r.Name)) ?? false;
}

async function fetchCpscPage(offset) {
  const url = new URL(CPSC_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("RecallDateStart", "2024-01-01");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`CPSC API error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

let inserted = 0, updated = 0, errors = 0, offset = 0;

console.log("Starting CPSC ingestion...");

while (true) {
  const page = await fetchCpscPage(offset);
  if (page.length === 0) break;
  console.log(`  Fetched page at offset ${offset}: ${page.length} records`);

  for (const r of page) {
    try {
      const product = r.Products?.[0];
      const hazard = r.Hazards?.[0]?.Name || "";
      const remedy = r.Remedies?.map(rem => rem.Name).join(", ") || "";
      const manufacturer = r.Manufacturers?.[0]?.Name || "";
      const rawNotice = [r.Description, `Hazard: ${hazard}`, `Remedy: ${remedy}`].filter(Boolean).join("\n\n");
      const hasRefund = isRefundRemedy(r.Remedies || []);
      const { value: refundValue, notes: refundNotes } = hasRefund ? extractRefundValue(rawNotice) : { value: null, notes: "" };

      const recallNumber = String(r.RecallNumber || r.RecallID);
      const title = (r.Title || r.Description?.slice(0, 200) || "Unknown").slice(0, 500);
      const productName = (product?.Name || "").slice(0, 255);
      const category = (product?.Type || product?.CategoryID || "").slice(0, 100);
      const recallDate = r.RecallDate ? new Date(r.RecallDate) : null;

      // Check if exists
      const [existing] = await db.execute("SELECT id FROM recalls WHERE recallNumber = ?", [recallNumber]);
      
      if (existing.length > 0) {
        await db.execute(
          "UPDATE recalls SET title=?, description=?, hazard=?, remedy=?, rawNotice=?, refundValue=?, refundExtracted=?, refundNotes=?, isActive=1 WHERE recallNumber=?",
          [title, (r.Description||"").slice(0,2000), hazard.slice(0,1000), remedy.slice(0,1000), rawNotice.slice(0,5000), refundValue !== null ? String(refundValue) : null, hasRefund && refundValue !== null ? 1 : 0, refundNotes?.slice(0,500)||null, recallNumber]
        );
        updated++;
      } else {
        await db.execute(
          `INSERT INTO recalls (recallNumber, agency, title, productName, manufacturer, category, description, hazard, remedy, rawNotice, refundValue, refundExtracted, refundNotes, recallDate, recallUrl, imageUrl, isActive)
           VALUES (?, 'CPSC', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [recallNumber, title, productName, manufacturer.slice(0,255), category, (r.Description||"").slice(0,2000), hazard.slice(0,1000), remedy.slice(0,1000), rawNotice.slice(0,5000), refundValue !== null ? String(refundValue) : null, hasRefund && refundValue !== null ? 1 : 0, refundNotes?.slice(0,500)||null, recallDate, r.URL?.slice(0,500)||null, r.Images?.[0]?.URL?.slice(0,500)||null]
        );
        inserted++;
      }
    } catch (e) {
      errors++;
      console.error("  Error on recall", r.RecallNumber, ":", e.message.slice(0, 100));
    }
  }

  if (page.length < PAGE_SIZE) break;
  offset += PAGE_SIZE;
  await new Promise(r => setTimeout(r, 300));
}

const [countRows] = await db.execute("SELECT COUNT(*) as cnt FROM recalls");
console.log(`\nDone! Inserted: ${inserted}, Updated: ${updated}, Errors: ${errors}`);
console.log(`Total recalls in DB: ${countRows[0].cnt}`);

await db.end();
