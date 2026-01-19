import dotenv from "dotenv";
dotenv.config();

import { randomBytes } from "crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

function genEntitySecretHex() {
  // 32 bytes => 64 hex chars
  return randomBytes(32).toString("hex");
}

async function main() {
  const apiKey = must("CIRCLE_API_KEY");
  const blockchain = must("CIRCLE_BLOCKCHAIN");

  let entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!entitySecret) {
    entitySecret = genEntitySecretHex();
    console.log("\n✅ Generated CIRCLE_ENTITY_SECRET (SAVE THIS IN .env):");
    console.log(entitySecret);
  } else {
    console.log("✅ Using existing CIRCLE_ENTITY_SECRET from .env");
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret
  });

  console.log("\n1) Creating Wallet Set...");
  // Wallet set endpoint exists in Circle DC wallets flow. :contentReference[oaicite:6]{index=6}
  const ws = await client.createWalletSet({ name: "trustless-agent-wallet-set" });
  const walletSetId = ws?.data?.walletSet?.id || ws?.data?.id;
  if (!walletSetId) throw new Error("Could not read walletSetId from response.");

  console.log("✅ Wallet Set ID:", walletSetId);

  console.log("\n2) Creating 2 wallets (agent + merchant)...");
  // Docs show createWallets with walletSetId, blockchains, count. :contentReference[oaicite:7]{index=7}
  const walletsResp = await client.createWallets({
    walletSetId,
    blockchains: [blockchain],
    count: 2,
    // accountType is used in examples; keep it safe to include.
    accountType: "SCA"
  });

  const wallets = walletsResp?.data?.wallets || [];
  if (wallets.length < 2) {
    console.log("Raw response:", JSON.stringify(walletsResp, null, 2));
    throw new Error("Expected 2 wallets in response but got less.");
  }

  const agentWallet = wallets[0];
  const merchantWallet = wallets[1];

  console.log("\n✅ Agent Wallet:");
  console.log("  ID:", agentWallet.id);
  console.log("  Address:", agentWallet.address);

  console.log("\n✅ Merchant Wallet:");
  console.log("  ID:", merchantWallet.id);
  console.log("  Address:", merchantWallet.address);

  console.log("\n➡️ Paste these into your .env:");
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log(`CIRCLE_AGENT_WALLET_ID=${agentWallet.id}`);
  console.log(`CIRCLE_MERCHANT_WALLET_ID=${merchantWallet.id}`);
  console.log("\nNext: Fund the AGENT wallet address using Arc testnet faucet, then run the app.");
}

main().catch((e) => {
  console.error("\n❌ init_circle failed:");
  try {
    // Axios-like error object: show status, headers, and body if available
    const resp = e?.response;
    if (resp) {
      console.error("Status:", resp.status);
      console.error("Headers:", resp.headers);
      console.error("Body:", JSON.stringify(resp.data, null, 2));
    } else {
      console.error(e?.message || e);
    }
  } catch (logErr) {
    console.error(e);
  }
  process.exit(1);
});
