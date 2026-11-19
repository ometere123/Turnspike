// M3 mainnet integration (TEST-E01 subset): real gateway middleware against the deployed contract on QIE mainnet.
// Spends 1000 base units (0.001 QUSDC) plus gas. Secrets: keystore path and password FILE path via env, never stored.
//   AGENT_KEYSTORE=... PW_FILE=... OWNER=0x... npx ts-node scripts/mainnet-integration.ts
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { turnspike } from "../packages/middleware/src";

const RPC = "https://rpc1mainnet.qie.digital";
const VAULT = "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c";
const TOKEN = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const MERCHANT = "0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761";
const OWNER = process.env.OWNER!;

async function main() {
  const provider = new JsonRpcProvider(RPC, 1990, { staticNetwork: true });
  const agent = (await Wallet.fromEncryptedJson(readFileSync(process.env.AGENT_KEYSTORE!, "utf8"), readFileSync(process.env.PW_FILE!, "utf8").trim())).connect(provider);
  const vault = new Contract(VAULT, ["function pay(address,address,bytes32,uint256)", "function isUsed(address,bytes32) view returns (bool)"], agent);
  const dir = mkdtempSync(join(tmpdir(), "tp-main-"));
  const mw = turnspike({
    rpcUrls: [RPC, "https://rpc2mainnet.qie.digital"], chainId: 1990, contract: VAULT, token: TOKEN, merchant: MERCHANT,
    hmacSecrets: ["integration-test-secret-not-for-production-0123456789"], dbPath: join(dir, "m.sqlite"), confirmations: 2, prices: { "/block-stub": 1000 },
  });
  let handlerRuns = 0;
  const app = express();
  app.use("/paid", mw);
  app.get("/paid/block-stub", (_q, r) => r.json({ ok: true, run: ++handlerRuns }));
  const log: Record<string, unknown> = {};

  const ch = (await request(app).get("/paid/block-stub")).body;
  log.challenge = { status: 402, requestId: ch.requestId, priceBase: ch.priceBase, chainId: ch.chainId };

  const tx = await vault.pay(OWNER, MERCHANT, ch.requestId, BigInt(ch.priceBase));
  log.payTx = tx.hash;
  const t0 = Date.now();
  await tx.wait();
  log.receiptSeconds = (Date.now() - t0) / 1000;

  const header = Buffer.from(JSON.stringify({ requestId: ch.requestId, txHash: tx.hash, sig: ch.sig })).toString("base64");
  const polls: unknown[] = [];
  let res;
  for (let i = 0; i < 30; i++) {
    res = await request(app).get("/paid/block-stub").set("X-Payment", header);
    polls.push({ status: res.status, why: res.body.why, confirmations: res.body.confirmations });
    if (res.status !== 202) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  log.polls = polls;
  log.final = { status: res!.status, body: res!.body };
  const again = await request(app).get("/paid/block-stub").set("X-Payment", header);
  log.idempotentReplay = { status: again.status, sameBody: JSON.stringify(again.body) === JSON.stringify(res!.body), handlerRuns };
  try { await vault.pay.staticCall(OWNER, MERCHANT, ch.requestId, 1000n); log.onChainReplay = "UNEXPECTEDLY ALLOWED"; } catch (e: any) { log.onChainReplay = "reverted: " + (e.revert?.name ?? e.shortMessage); }
  log.isUsed = await vault.isUsed(MERCHANT, ch.requestId);
  mw.close();
  console.log(JSON.stringify(log, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
