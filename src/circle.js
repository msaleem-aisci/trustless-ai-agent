import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";

/* =========================
   ENV HELPERS
========================= */
function must(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

function getClient() {
  const apiKey = must("CIRCLE_API_KEY");
  const entitySecret = must("CIRCLE_ENTITY_SECRET");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

/* =========================
   WALLET HELPERS
========================= */

// SDK-based (works if your SDK method exists)
export async function getWalletBalances(walletId) {
  const client = getClient();
  const resp = await client.getWalletTokenBalance({ id: walletId });
  return resp?.data?.tokenBalances || [];
}

/**
 * REST-based Circle balances fetch (more reliable than Node fetch on Windows)
 * GET https://api.circle.com/v1/w3s/wallets/{walletId}/balances
 */
export async function getWalletBalancesRest(walletId) {
  const apiKey = must("CIRCLE_API_KEY");
  if (!walletId) throw new Error("Missing walletId");

  const url = `https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(walletId)}/balances`;

  try {
    const resp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      timeout: 15000, // 15s timeout
    });

    return resp.data;
  } catch (e) {
    // Circle responded (HTTP error)
    if (e?.response) {
      const err = new Error(
        e.response?.data?.message || `Circle API error: ${e.response.status}`
      );
      err.status = e.response.status;
      err.details = e.response.data;
      throw err;
    }

    // Network-level failure (DNS/TLS/Proxy/etc)
    const err = new Error(e?.message || "Circle balances fetch failed (network error)");
    err.status = 502;
    err.details = { message: e?.message || "axios network error" };
    throw err;
  }
}

/**
 * Convenience helper: fetch both balances via REST
 * Useful for endpoint: GET /wallets/balances
 */
export async function getAgentAndMerchantBalancesRest() {
  const agentId = must("CIRCLE_AGENT_WALLET_ID");
  const merchantId = must("CIRCLE_MERCHANT_WALLET_ID");

  // Sequential calls are slightly more reliable in some environments
  const agent = await getWalletBalancesRest(agentId);
  const merchant = await getWalletBalancesRest(merchantId);

  return { agent, merchant };
}

export function findUsdcTokenId(tokenBalances) {
  const blockchain = must("CIRCLE_BLOCKCHAIN").toUpperCase();

  // Prefer tokens on the configured blockchain
  const filtered = tokenBalances.filter(
    (b) => String(b?.token?.blockchain || "").toUpperCase() === blockchain
  );

  // Match USDC / USDC-TESTNET / USDC.e
  const usdc = filtered.find((b) =>
    String(b?.token?.symbol || "").toUpperCase().includes("USDC")
  );

  return usdc?.token?.id || null;
}

/* =========================
   TRANSFER (SDK-VERSION SAFE)
========================= */
export async function transferUsdc({ fromWalletId, toAddress, amountUsdc }) {
  const client = getClient();
  const blockchain = must("CIRCLE_BLOCKCHAIN");

  // 1️⃣ Fetch balances and locate USDC tokenId
  const balances = await getWalletBalances(fromWalletId);
  const usdcTokenId = findUsdcTokenId(balances);

  if (!usdcTokenId) {
    const symbols = balances.map((b) => b?.token?.symbol).filter(Boolean);
    throw new Error(
      `USDC tokenId not found. Wallet tokens: ${JSON.stringify(symbols)}`
    );
  }

  // 2️⃣ Prepare payload
  const payload = {
    idempotencyKey: uuidv4(),
    walletId: fromWalletId,
    blockchain,
    destinationAddress: toAddress,
    tokenId: usdcTokenId,
    amounts: [String(amountUsdc)],
    // Some SDK versions expect a `fee` object with a nested `config`.
    // Include both for maximum compatibility.
    fee: { config: { feeLevel: "MEDIUM" } },
    feeLevel: "MEDIUM",
  };

  // 3️⃣ SDK compatibility layer (works for ALL versions)
  const methodCandidates = [
    "createDeveloperTransaction",
    "createDeveloperTransactionTransfer",
    "createTransaction",
    "createTransfer",
    "transfer",
  ];

  for (const method of methodCandidates) {
    if (typeof client[method] === "function") {
      const resp = await client[method](payload);
      return resp?.data || resp;
    }
  }

  // 4️⃣ Fail loudly with SDK diagnostics
  const availableMethods = Object.keys(client).filter(
    (k) => typeof client[k] === "function"
  );

  throw new Error(
    `No compatible transfer method found in Circle SDK.\n` +
      `Tried: ${methodCandidates.join(", ")}\n` +
      `Available: ${availableMethods.join(", ")}`
  );
}

/* =========================
   OPTIONAL HELPERS
========================= */
export async function getTransaction(transactionId) {
  const client = getClient();
  if (typeof client.getTransaction === "function") {
    const resp = await client.getTransaction({ id: transactionId });
    return resp?.data || resp;
  }
  return { id: transactionId };
}

export async function getWallet(walletId) {
  const client = getClient();
  if (!walletId) throw new Error("Missing walletId");

  if (typeof client.getWallet === "function") {
    const resp = await client.getWallet({ id: walletId });
    return resp?.data?.wallet || resp?.data || resp;
  }

  if (typeof client.getWalletById === "function") {
    const resp = await client.getWalletById({ id: walletId });
    return resp?.data?.wallet || resp?.data || resp;
  }

  throw new Error("Wallet getter not supported by this SDK version");
}
