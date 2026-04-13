/**
 * LLM-based Refund Value Extractor
 * Uses gpt-4.1-mini to extract refund dollar amounts from recall remedy text.
 * Falls back gracefully if the LLM is unavailable.
 */

import { invokeLLM } from "../_core/llm";

export type RefundExtractionResult = {
  refundValue: number | null;
  refundCertainty: "explicit" | "msrp" | "estimated";
  refundNotes: string;
  isReplacementOnly: boolean;
  isFullPurchasePrice: boolean;
};

const SYSTEM_PROMPT = `You are a recall refund analyst. Given a recall's remedy text and description, extract refund information.

Return a JSON object with these fields:
- refundValue: number or null — the explicit dollar amount of the refund (e.g. 29.99). null if no specific amount is stated.
- isFullPurchasePrice: boolean — true if the remedy says "full refund", "full purchase price refund", "full retail price", or similar full-price language
- isReplacementOnly: boolean — true if the remedy is ONLY a replacement/repair with no cash refund option
- refundNotes: string — brief explanation of what was found (1 sentence max)

Rules:
- If a specific dollar amount is mentioned (e.g. "$25 refund", "refund of $49.99"), set refundValue to that number
- If the remedy says "full refund" or "full purchase price" without a specific amount, set isFullPurchasePrice=true and refundValue=null
- If the remedy is only "repair", "replacement", "free repair", or "free replacement" with no refund option, set isReplacementOnly=true
- Some recalls offer BOTH replacement AND refund — in that case, set isReplacementOnly=false and extract the refund value
- Do not guess or estimate dollar amounts — only extract explicitly stated values`;

export async function extractRefundWithLLM(
  remedy: string,
  description: string
): Promise<RefundExtractionResult> {
  const defaultResult: RefundExtractionResult = {
    refundValue: null,
    refundCertainty: "estimated",
    refundNotes: "",
    isReplacementOnly: false,
    isFullPurchasePrice: false,
  };

  if (!remedy && !description) return defaultResult;

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Remedy: ${remedy}\n\nDescription: ${description?.slice(0, 500) || ""}`,
        },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "refund_extraction",
          schema: {
            type: "object",
            properties: {
              refundValue: { type: ["number", "null"] },
              isFullPurchasePrice: { type: "boolean" },
              isReplacementOnly: { type: "boolean" },
              refundNotes: { type: "string" },
            },
            required: ["refundValue", "isFullPurchasePrice", "isReplacementOnly", "refundNotes"],
            additionalProperties: false,
          },
          strict: true,
        },
      },
      maxTokens: 256,
    });

    const content = result.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return defaultResult;

    const parsed = JSON.parse(content) as {
      refundValue: number | null;
      isFullPurchasePrice: boolean;
      isReplacementOnly: boolean;
      refundNotes: string;
    };

    let certainty: "explicit" | "msrp" | "estimated" = "estimated";
    if (parsed.refundValue !== null) {
      certainty = "explicit";
    } else if (parsed.isFullPurchasePrice) {
      certainty = "msrp";
    }

    return {
      refundValue: parsed.refundValue ?? null,
      refundCertainty: certainty,
      refundNotes: parsed.refundNotes || "",
      isReplacementOnly: parsed.isReplacementOnly ?? false,
      isFullPurchasePrice: parsed.isFullPurchasePrice ?? false,
    };
  } catch (err) {
    console.warn("[RefundExtractor] LLM extraction failed:", err);
    return defaultResult;
  }
}
