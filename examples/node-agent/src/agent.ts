// A buyer-side agent that pays for a Turnspike API with @turnspike-qie/client.
// It holds only the AGENT key (from an encrypted keystore). The owner's key is never needed: the owner set the limits on chain.
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { FileJournal, QIE_MAINNET, TurnspikeClient, idempotencyKey, parseUnits, type Network } from "@turnspike-qie/client";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See README.md.`);
  return v;
}

async function main() {
  const url = need("TARGET_URL"); // e.g. https://turnspike-qie.fly.dev/v1/block-summary
  const network: Network = process.env.CHAIN_ID
    ? { ...QIE_MAINNET, name: "custom", chainId: Number(process.env.CHAIN_ID), contract: need("ALLOWANCE_ADDRESS"), token: need("QUSDC_ADDRESS"), rpcUrls: [need("RPC_URL")] }
    : QIE_MAINNET;
  const provider = new JsonRpcProvider(network.rpcUrls[0], network.chainId, { staticNetwork: true });
  const signer = (await Wallet.fromEncryptedJson(readFileSync(need("AGENT_KEYSTORE"), "utf8"), need("TURNSPIKE_KEYSTORE_PASSWORD"))).connect(provider);

  const client = new TurnspikeClient({
    signer,
    owner: need("OWNER_ADDRESS"),
    network,
    // Only this origin, and only this merchant, may ever be paid. Everything else is refused.
    policy: { payees: [{ origin: new URL(url).origin, merchant: need("MERCHANT_ADDRESS") }], maxPriceBase: parseUnits(process.env.MAX_PRICE ?? "0.002") },
    // Your own spending rule. Here: log the quote and approve only if gas is under 0.001 QIE.
    approve: (q) => {
      console.error(`paying ${q.price} ${q.symbol} to ${q.merchant} for ${q.resourceId} (gas ~${q.gasCostWei} wei)`);
      return q.gasCostWei < 10n ** 15n;
    },
    journal: new FileJournal(process.env.JOURNAL_PATH ?? ".turnspike/journal.json"), // restart-safe
    confirmations: Number(process.env.CONFIRMATIONS ?? 2),
    onEvent: (e) => console.error(JSON.stringify(e)),
  });

  // The key identifies this purchase. Rerunning with the same key after a crash finishes it instead of paying again.
  const key = process.env.PURCHASE_KEY ?? idempotencyKey("GET", url, new Date().toISOString().slice(0, 16));
  const r = await client.fetch(url, {}, { idempotencyKey: key, dryRun: process.env.DRY_RUN === "1" });
  if (r.ok && r.kind === "dry_run") return console.log(JSON.stringify(r.quote, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  if (r.ok) {
    console.log(await r.response.text());
    if (r.kind === "paid") console.error(`paid: ${r.payment.explorerUrl ?? r.payment.txHash}${r.replayed ? " (stored response replayed)" : ""}`);
    return;
  }
  console.error(`${r.paid ? "PAID but not delivered" : "not paid"}: ${r.error}: ${r.message}`);
  if (r.paid) console.error(`rerun with PURCHASE_KEY=${key} to collect it`);
  process.exitCode = r.paid ? 4 : 3;
}

main().catch((e) => { console.error(e?.shortMessage ?? e?.message ?? e); process.exitCode = 1; });
