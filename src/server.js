import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { getDecisionAndAnalysis } from "./gemini.js";
import { enforceGuardrails } from "./pricing.js";
import { safeJsonParse } from "./utils.js";
import {
  transferUsdc,
  getTransaction,
  getWalletBalances,
  getWallet,
  getAgentAndMerchantBalancesRest
} from "./circle.js";

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_, res) => res.json({ ok: true }));

/* =========================
   DEBUG / UTILS
========================= */
app.get("/test", (req, res) => {
  return res.json({"simple": "This is just test"})
}
// ✅ Agent wallet balances via SDK
app.get("/balance", async (_req, res) => {
  try {
    const walletId = process.env.CIRCLE_AGENT_WALLET_ID?.trim();
    if (!walletId) throw new Error("Missing CIRCLE_AGENT_WALLET_ID in .env");

    const balances = await getWalletBalances(walletId);
    res.json({ walletId, balances });
  } catch (e) {
    console.error("SERVER ERROR FULL (/balance):", e);
    res.status(500).json({
      error: e?.message || String(e),
      stack: e?.stack || null
    });
  }
});

// ✅ Wallet details by agent wallet id
app.get("/wallet", async (_req, res) => {
  try {
    const id = process.env.CIRCLE_AGENT_WALLET_ID?.trim();
    if (!id) throw new Error("Missing CIRCLE_AGENT_WALLET_ID in .env");
    const w = await getWallet(id);
    res.json(w);
  } catch (e) {
    console.error("SERVER ERROR FULL (/wallet):", e);
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* =========================
   CORE FLOW
========================= */

app.post("/quote", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "text is required" });

    const decision = await getDecisionAndAnalysis(text, { analysisOnly: true });
    const guarded = enforceGuardrails(decision);

    res.json({
      payment_required: guarded.payment_required,
      amount_usdc: guarded.amount_usdc,
      complexity: guarded.complexity,
      reason: guarded.reason
    });
  } catch (e) {
    console.error("SERVER ERROR FULL (/quote):", e);
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.post("/run", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "text is required" });

    const decision = await getDecisionAndAnalysis(text, { analysisOnly: false });
    const guarded = enforceGuardrails(decision);

    let tx_id = null;
    let tx_link = null;

    if (guarded.payment_required && Number(guarded.amount_usdc) > 0) {
      const fromWalletId = process.env.CIRCLE_AGENT_WALLET_ID?.trim();
      const toAddress = process.env.MERCHANT_WALLET_ADDRESS?.trim();

      if (!fromWalletId) throw new Error("Missing CIRCLE_AGENT_WALLET_ID in .env");
      if (!toAddress) throw new Error("Missing MERCHANT_WALLET_ADDRESS in .env");

      const tx = await transferUsdc({
        fromWalletId,
        toAddress,
        amountUsdc: guarded.amount_usdc
      });

      tx_id = tx?.id || null;

      const explorerBase = process.env.EXPLORER_TX_BASE?.trim() || "";
      if (explorerBase && tx?.txHash) tx_link = `${explorerBase}${tx.txHash}`;
    }

    res.json({
      payment_required: guarded.payment_required,
      amount_usdc: guarded.amount_usdc,
      complexity: guarded.complexity,
      reason: guarded.reason,
      analysis: guarded.analysis,
      tx_id,
      tx_link
    });
  } catch (e) {
    // Keep your safeJsonParse (even if not used elsewhere)
    safeJsonParse(e?.message || "");
    console.error("SERVER ERROR FULL (/run):", e);
    res.status(500).json({
      error: e?.message || String(e),
      stack: e?.stack || null
    });
  }
});

app.get("/status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const tx = await getTransaction(id);
    res.json({ transaction: tx });
  } catch (e) {
    console.error("SERVER ERROR FULL (/status/:id):", e);
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* =========================
   ✅ BALANCES ENDPOINT (Agent + Merchant)
========================= */

app.get("/wallets/balances", async (_req, res) => {
  try {
    const data = await getAgentAndMerchantBalancesRest();
    return res.json(data);
  } catch (e) {
    console.error("SERVER ERROR FULL (/wallets/balances):", e);
    return res.status(e?.status || 502).json({
      error: e?.message || "Balances fetch failed",
      details: e?.details || e?.data || null
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));

