/**
 * Re-process all existing recalls in the database with corrected refund detection.
 * This fixes the refundExtracted and refundNotes fields for all 896 records.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const db = await mysql.createConnection(process.env.DATABASE_URL);

/**
 * Determine if a recall remedy is a CASH REFUND (not exchange/replacement/repair).
 * Mirrors the updated server-side logic.
 */
function isRefundRemedy(remedyText) {
  if (!remedyText) return false;
  const fullText = remedyText;

  // Must contain an explicit refund/reimburse/money-back signal
  const hasRefundSignal = /\bfull\s+refund\b|\brefund\b|\breimburse\b|\bmoney\s+back\b|\bcash\s+back\b|\bpurchase\s+price\b/i.test(fullText);
  if (!hasRefundSignal) return false;

  // Exclude if the ONLY remedy is store credit (no cash option)
  const hasStoreCreditOnly =
    /\bstore\s+credit\b/i.test(fullText) &&
    !/\bfull\s+refund\b|\bcash\s+refund\b|\bpurchase\s+price\b|\breimburse\b/i.test(fullText);
  if (hasStoreCreditOnly) return false;

  return true;
}

/**
 * Extract refund value from remedy text.
 */
function extractRefundValue(text) {
  if (!text) return { value: null, notes: "" };

  const refundPatterns = [
    /refund[^.]{0,60}?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)[^.]{0,60}?refund/i,
    /reimburse[^.]{0,60}?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:cash\s+)?refund/i,
    /full\s+(?:purchase\s+)?(?:price|refund)/i,
  ];

  for (const pattern of refundPatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[1]) {
        const value = parseFloat(match[1].replace(/,/g, ""));
        return { value, notes: `Extracted from notice: "${match[0].trim()}"` };
      }
      return { value: null, notes: `Full purchase price refund: "${match[0].trim()}"` };
    }
  }

  return { value: null, notes: "Refund indicated in notice (amount not specified)" };
}

// Fetch all recalls
const [rows] = await db.execute("SELECT id, remedy, rawNotice FROM recalls");
console.log(`Processing ${rows.length} recalls...`);

let flaggedRefund = 0;
let flaggedNoRefund = 0;
let updated = 0;

for (const row of rows) {
  const remedyText = row.remedy || "";
  const rawNotice = row.rawNotice || "";

  const hasRefund = isRefundRemedy(remedyText);

  let refundValue = null;
  let refundNotes = null;

  if (hasRefund) {
    const extracted = extractRefundValue(remedyText || rawNotice);
    refundValue = extracted.value !== null ? String(extracted.value) : null;
    refundNotes = extracted.notes || null;
    flaggedRefund++;
  } else {
    flaggedNoRefund++;
  }

  await db.execute(
    "UPDATE recalls SET refundExtracted = ?, refundValue = ?, refundNotes = ? WHERE id = ?",
    [hasRefund ? 1 : 0, refundValue, refundNotes, row.id]
  );
  updated++;
}

console.log(`\nDone!`);
console.log(`  Total processed: ${updated}`);
console.log(`  Flagged as REFUND: ${flaggedRefund}`);
console.log(`  Flagged as NON-REFUND: ${flaggedNoRefund}`);

// Show sample of refund recalls
const [refundSample] = await db.execute(
  "SELECT recallNumber, title, remedy, refundValue, refundNotes FROM recalls WHERE refundExtracted = 1 LIMIT 10"
);
console.log("\nSample refund recalls:");
refundSample.forEach(r => {
  console.log(`  #${r.recallNumber} | refundValue: ${r.refundValue || 'full price'} | ${r.title?.slice(0, 60)}`);
});

// Show sample of excluded recalls
const [excludedSample] = await db.execute(
  "SELECT recallNumber, title, remedy FROM recalls WHERE refundExtracted = 0 LIMIT 5"
);
console.log("\nSample NON-refund recalls (excluded):");
excludedSample.forEach(r => {
  console.log(`  #${r.recallNumber} | remedy: ${r.remedy?.slice(0, 80)}`);
});

await db.end();
