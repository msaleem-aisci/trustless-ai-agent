import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import crypto from "crypto";

function must(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

// 32 bytes => 64 hex chars
function validateEntitySecretHex(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("CIRCLE_ENTITY_SECRET must be 64 hex characters (32 bytes).");
  }
}

async function getEntityPublicKey(apiKey) {
  const url = "https://api.circle.com/v1/w3s/config/entity/publicKey";
  const res = await axios.get(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
  });

  const pk = res?.data?.data?.publicKey || res?.data?.publicKey;

  if (!pk) {
    console.log("Unexpected response:", JSON.stringify(res.data, null, 2));
    throw new Error("Could not find publicKey in response.");
  }

  return pk; // PEM format public key
}

function encryptEntitySecret(entitySecretHex, publicKeyPem) {
  validateEntitySecretHex(entitySecretHex);

  const secretBytes = Buffer.from(entitySecretHex, "hex");

  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    secretBytes
  );

  return encrypted.toString("base64"); // ciphertext (this goes in console)
}

async function main() {
  const apiKey = must("CIRCLE_API_KEY");
  const entitySecretHex = must("CIRCLE_ENTITY_SECRET");

  const publicKeyPem = await getEntityPublicKey(apiKey);
  const ciphertext = encryptEntitySecret(entitySecretHex, publicKeyPem);

  console.log("\n✅ ENTITY SECRET CIPHERTEXT (paste into Circle Console TEST env):\n");
  console.log(ciphertext);
  console.log("\nGo to Circle Console → (TEST/Sandbox) → W3S/Wallets Configurator → Entity Secret → paste → Register/Set\n");
}

main().catch((e) => {
  console.error("\n❌ make_entity_ciphertext failed:");
  console.error(e?.response?.data || e?.message || e);
  process.exit(1);
});
