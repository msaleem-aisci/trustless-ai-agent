import { safeJsonParse } from "./utils.js";

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

function buildPrompt(text) {
  return `
You are a backend pricing + analysis engine.

ABSOLUTE OUTPUT RULES (MUST FOLLOW):
- Output ONLY a single valid JSON object.
- Do NOT include markdown.
- Do NOT include any text before or after JSON.
- JSON must be COMPLETE (all braces closed).
- Do NOT truncate.

JSON SCHEMA (EXACT KEYS):
{
  "complexity": "LOW" | "MEDIUM" | "HIGH",
  "payment_required": boolean,
  "amount_usdc": number,
  "reason": string,
  "analysis": string
}

PRICING (SERVER WILL ENFORCE ANYWAY):
LOW => 0.00 (payment_required false)
MEDIUM => 0.05
HIGH => 0.10

USER TEXT:
${text}

RETURN ONLY JSON.
`.trim();
}

function extractJsonLoose(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = raw.slice(start, end + 1);
  return safeJsonParse(candidate);
}

function parseDecisionLoose(raw) {
  // Try to extract expected fields even when JSON is malformed (unescaped newlines, etc.)
  const getString = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,\\s*"|\\s*\\}|\\s*$)`, "m");
    const m = raw.match(re);
    return m ? m[1].replace(/\r/g, "").trim() : null;
  };

  const complexity = getString("complexity");
  const reason = getString("reason");
  const analysis = getString("analysis");

  const paymentM = raw.match(/"payment_required"\s*:\s*(true|false)/i);
  const amountM = raw.match(/"amount_usdc"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);

  const payment_required = paymentM ? paymentM[1].toLowerCase() === "true" : null;
  const amount_usdc = amountM ? parseFloat(amountM[1]) : null;

  if (complexity || reason || analysis || paymentM || amountM) {
    return {
      complexity: complexity || null,
      payment_required,
      amount_usdc,
      reason: reason || null,
      analysis: analysis || null
    };
  }
  return null;
}

function looksTruncatedJson(raw) {
  // Heuristic: starts with "{" but missing "}" OR ends mid-key/quote
  const hasOpen = raw.includes("{");
  const hasClose = raw.includes("}");
  if (hasOpen && !hasClose) return true;

  const trimmed = raw.trim();
  // ends with quote, colon, underscore, comma etc often indicates truncation
  if (trimmed.startsWith("{") && /["_:,]$/.test(trimmed) && !trimmed.endsWith("}")) return true;

  return false;
}

async function callGeminiOnce({ apiKey, model, prompt }) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,          // ✅ deterministic
      maxOutputTokens: 1024    // ✅ reduce truncation
    }
  };

  const resp = await fetch(GEMINI_URL(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return raw;
}

export async function getDecisionAndAnalysis(text, { analysisOnly = false } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY in .env");

  const prompt = buildPrompt(text);

  // ✅ Try up to 2 attempts (retry fixes truncation most of the time)
  let raw = await callGeminiOnce({ apiKey, model, prompt });

  let decision = safeJsonParse(raw) || extractJsonLoose(raw);

  if (!decision && looksTruncatedJson(raw)) {
    // Retry once if truncated
    raw = await callGeminiOnce({ apiKey, model, prompt });
    decision = safeJsonParse(raw) || extractJsonLoose(raw);
  }

  if (!decision) {
    // Final fallback: try to pull out fields individually from malformed output
    decision = parseDecisionLoose(raw);
  }

  if (!decision) {
    const preview = raw && raw.length > 200 ? raw.slice(0, 200) + "..." : raw;
    throw new Error(`Gemini output was not valid JSON. Raw preview:\n${preview}`);
  }

  if (analysisOnly) {
    return {
      complexity: decision.complexity,
      payment_required: decision.payment_required,
      amount_usdc: decision.amount_usdc,
      reason: decision.reason,
      analysis: decision.analysis || ""
    };
  }

  return decision;
}
