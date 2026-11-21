// Two-sided x402 v2 demo on a LOCAL Hardhat chain (started by ../run-local.mjs, which passes RPC_URL).
// Deploys the real TurnpikeAllowance contract and MockERC20 (a labelled test token), starts the example seller, and pays
// through createX402Fetch. Uses only the public Hardhat test mnemonic. Nothing touches a public network.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, type Contract } from "ethers";
import { createSeller } from "../../x402-seller/src/seller";
import { createAgent } from "./agent";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN = 31337;
const ROOT = join(__dirname, "../../..");
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));
const step = (s: string) => console.log(s);
const fmt = (b: bigint) => (Number(b) / 1e6).toFixed(4);
const decode = (h: string | null) => (h ? JSON.parse(Buffer.from(h, "base64").toString("utf8")) : null);
const check = (cond: unknown, msg: string) => { if (!cond) throw new Error(`check failed: ${msg}`); };

async function main() {
  const provider = new JsonRpcProvider(RPC, CHAIN, { staticNetwork: true, cacheTimeout: -1 });
  const phrase = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
  const w = (i: number) => HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
  const owner = new NonceManager(w(0)), agentWallet = w(1), merchant = w(2).address;
  const ownerAddr = await owner.getAddress();

  // ---- deploy and configure (in production the owner does this in the web console)
  const t = art("test-helpers/MockERC20.sol/MockERC20.json"), v = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  const token = (await (await new ContractFactory(t.abi, t.bytecode, owner).deploy()).waitForDeployment()) as unknown as Contract;
  const vault = (await (await new ContractFactory(v.abi, v.bytecode, owner).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as unknown as Contract;
  const contract = await vault.getAddress(), tokenAddr = await token.getAddress();
  await (await token.mint(ownerAddr, 10_000_000n)).wait();
  await (await token.approve(contract, 10n ** 12n)).wait();
  await (await vault.deposit(1_000_000n)).wait();
  await (await vault.setPolicy(agentWallet.address, 10_000n, 100_000n)).wait();
  await (await vault.setMerchant(merchant, true)).wait();
  step(`1. local chain ${CHAIN}: TurnpikeAllowance ${contract}, MockERC20 (test token) ${tokenAddr}`);
  step(`   owner deposited 1.0000, agent per-call cap 0.0100, daily cap 0.1000, merchant ${merchant} allowlisted`);

  // ---- seller
  const dir = mkdtempSync(join(tmpdir(), "x402-local-"));
  // Listen first so the seller can be given its real public origin (O4: x402.publicOrigin, as in production) instead of
  // the development fallback.
  const server: Server = await new Promise((r) => { const s = createServer().listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const { app, mw } = createSeller({
    rpcUrl: RPC, chainId: CHAIN, contract, token: tokenAddr, merchant, hmacSecret: randomBytes(32).toString("hex"),
    dbPath: join(dir, "seller.sqlite"), priceBase: 2500, confirmations: 1, publicOrigin: base,
  });
  server.on("request", app);
  step(`2. seller listening on ${base}; GET /v1/report costs 0.0025 (scheme turnspike-allowance)`);

  try {
    // ---- the 402 an x402 v2 client sees
    const unpaid = await fetch(`${base}/v1/report`);
    const pr = decode(unpaid.headers.get("payment-required"));
    await unpaid.body?.cancel();
    const acc = pr.accepts[0];
    step(`3. unpaid request -> ${unpaid.status}; PAYMENT-REQUIRED: x402Version ${pr.x402Version}, scheme ${acc.scheme}, network ${acc.network}, amount ${acc.amount}, payTo ${acc.payTo}`);

    // ---- agent with restart-safe state (FileJournal + FileProofStore)
    const files = { journalPath: join(dir, "journal.json"), proofStorePath: join(dir, "proofs.json") };
    const agentCfg = {
      signer: new NonceManager(agentWallet), owner: ownerAddr, rpcUrl: RPC, chainId: CHAIN, contract, token: tokenAddr,
      payees: [{ origin: base, merchant }], maxPriceBase: 5_000n, confirmations: 1, ...files,
    };
    const { pay, proofStore } = await createAgent(agentCfg);
    const balance = async () => (await vault.account(ownerAddr)).balance as bigint;

    // ---- paid call
    const b0 = await balance();
    const r1 = await pay(`${base}/v1/report`);
    check(r1.ok && r1.kind === "paid", `paid call: ${JSON.stringify(r1)}`);
    if (!r1.ok) return;
    const body1 = await r1.response.json();
    step(`4. paid call -> ${r1.response.status} ${JSON.stringify(body1)}`);
    step(`   PAYMENT-RESPONSE: ${JSON.stringify(decode(r1.response.headers.get("payment-response")))}`);
    step(`   owner charged ${fmt(b0 - (await balance()))}`);

    // ---- replay: same request again, and the raw PAYMENT-SIGNATURE presented again
    const r2 = await pay(`${base}/v1/report`);
    check(r2.ok && r2.resumed, "same request should resume");
    const body2 = r2.ok ? await r2.response.json() : null;
    const header = (await proofStore.get(r1.purchaseKey))?.header;
    check(header, "proof header recorded");
    const raw = await fetch(`${base}/v1/report`, { headers: { "payment-signature": header! } });
    const body3 = await raw.json();
    check(raw.status === 200 && body3.generatedAt === body1.generatedAt, "raw replay returns the stored response");
    check(b0 - (await balance()) === 2500n, "charged once");
    step(`5. replay: same request -> resumed=${r2.ok && r2.resumed}, same body=${body2?.generatedAt === body1.generatedAt}; raw PAYMENT-SIGNATURE re-sent -> ${raw.status}, stored response replayed; owner still charged ${fmt(b0 - (await balance()))} in total`);

    // ---- owner cap refusal: the owner lowers the per-call cap below the price
    await (await vault.setPolicy(agentWallet.address, 1_000n, 100_000n)).wait();
    const b1 = await balance();
    const r3 = await pay(`${base}/v1/report?n=cap`);
    check(!r3.ok && r3.error === "over_per_call_cap" && !r3.paid && !r3.maybePaid, `cap refusal: ${JSON.stringify(r3)}`);
    check((await balance()) === b1, "nothing charged on cap refusal");
    if (!r3.ok) step(`6. owner cap 0.0010 < price 0.0025 -> refused before paying: error=${r3.error}, paid=${r3.paid}, maybePaid=${r3.maybePaid}`);
    await (await vault.setPolicy(agentWallet.address, 10_000n, 100_000n)).wait();

    // ---- merchant allowlist refusal: the owner removes the merchant
    await (await vault.setMerchant(merchant, false)).wait();
    const r4 = await pay(`${base}/v1/report?n=allowlist`);
    check(!r4.ok && r4.error === "merchant_not_allowed" && !r4.paid, `allowlist refusal: ${JSON.stringify(r4)}`);
    check((await balance()) === b1, "nothing charged on allowlist refusal");
    if (!r4.ok) step(`7. merchant removed from the owner's allowlist -> refused before paying: error=${r4.error}, paid=${r4.paid}, maybePaid=${r4.maybePaid}`);
    await (await vault.setMerchant(merchant, true)).wait();

    // ---- safe retry / recovery: the paid proof never reaches the seller (network down), the process "restarts"
    const down: typeof fetch = async (input, init) => {
      const req = new Request(input as any, init);
      if (req.headers.get("payment-signature")) throw new Error("simulated network failure");
      return fetch(req);
    };
    const flaky = await createAgent({ ...agentCfg, fetch: down, retry: { attempts: 2, baseDelayMs: 100, totalMs: 2_000 } });
    const b2 = await balance();
    const r5 = await flaky.pay(`${base}/v1/report?n=recover`);
    check(!r5.ok && r5.paid, `expected paid-not-delivered: ${JSON.stringify(r5)}`);
    if (!r5.ok) step(`8. paid, then the proof could not be delivered -> error=${r5.error}, paid=${r5.paid}, maybePaid=${r5.maybePaid}`);
    const restarted = await createAgent(agentCfg); // same journal and proof-store files, as a restarted process would
    const pending = await restarted.client.pendingPurchases();
    const r6 = await restarted.pay(`${base}/v1/report?n=recover`);
    check(r6.ok && r6.resumed, `recovery: ${JSON.stringify(r6)}`);
    check(b2 - (await balance()) === 2500n, "recovery charged once");
    if (r6.ok) step(`   restarted agent: ${pending.length} unfinished purchase(s) in the journal; same request -> ${r6.response.status}, resumed=${r6.resumed}; owner charged ${fmt(b2 - (await balance()))} once`);

    step("X402 LOCAL DEMO OK");
  } finally {
    server.closeAllConnections?.();
    server.close();
    mw.close();
    provider.destroy();
  }
}

main().then(() => process.exit(0), (e) => { console.error("X402 LOCAL DEMO FAILED:", e?.message ?? e); process.exit(1); });
