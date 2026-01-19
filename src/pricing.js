import { clamp } from "./utils.js";

const PRICE_TABLE = {
  LOW: 0.0,
  MEDIUM: 0.05,
  HIGH: 0.1
};

export function enforceGuardrails(modelDecision) {
  const allowed = new Set(["LOW", "MEDIUM", "HIGH"]);

  const complexity = String(modelDecision?.complexity || "").toUpperCase();
  const analysis = String(modelDecision?.analysis || "");
  const reason = String(modelDecision?.reason || "");

  if (!allowed.has(complexity)) {
    return {
      complexity: "LOW",
      payment_required: false,
      amount_usdc: 0,
      reason: "Invalid complexity from model; forced safe default",
      analysis
    };
  }

  const amount = PRICE_TABLE[complexity];
  const safeAmount = clamp(Number(amount), 0, 1);

  return {
    complexity,
    payment_required: safeAmount > 0,
    amount_usdc: safeAmount,
    reason: reason || `Pricing applied for ${complexity}`,
    analysis
  };
}
