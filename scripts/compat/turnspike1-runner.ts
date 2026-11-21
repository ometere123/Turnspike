// Child of turnspike1-diff.mjs. Runs one fixed sequence of turnspike/1 requests against the middleware whose source entry is
// MW_ENTRY (origin/main or this branch), default configuration, on the local Hardhat chain at RPC_URL (31337 only).
// Prints one JSON line: the raw observations (status, headers, body) of every step. Normalisation is done by the parent.
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";

const RPC = process.env.RPC_URL!;
const ROOT = resolve(__dirname, "../..");
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const SECRET = "c".repeat(40);
const art = (p: string) => JSON.parse(readFileSync(join(ROOT, "artifacts/contracts", p), "utf8"));
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");

async function main() {
  const { turnspike } = await import(pathToFileURL(process.env.MW_ENTRY!).href);
  const provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  const net = await provider.getNetwork();
  if (net.chainId !== 31337n) throw new Error("local Hardhat chain (31337) only");
  const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
  const owner = new NonceManager(w(0)), agent = new NonceManager(w(1));
  const ownerAddr = await owner.getAddress(), merchant = w(2).address;
  const mk = async (a: any, ...args: any[]) => { const c = await new ContractFactory(a.abi, a.bytecode, owner).deploy(...args); await c.waitForDeployment(); return c as unknown as ethers.Contract; };
  const token = await mk(art("test-helpers/MockERC20.sol/MockERC20.json"));
  const vault = await mk(art("TurnpikeAllowance.sol/TurnpikeAllowance.json"), await token.getAddress(), 5_000_000n);
  await (await (token as any).mint(ownerAddr, 100_000_000n)).wait();
  await (await (token.connect(owner) as any).approve(vault.target, 10n ** 12n)).wait();
  await (await (vault.connect(owner) as any).deposit(2_000_000n)).wait();
  await (await (vault.connect(owner) as any).setPolicy(await agent.getAddress(), 100_000n, 1_000_000n)).wait();
  await (await (vault.connect(owner) as any).setMerchant(merchant, true)).wait();
  const pay = async (requestId: string) => {
    const tx = await (vault.connect(agent) as any).pay(ownerAddr, merchant, requestId, 1000n); await tx.wait();
    await provider.send("hardhat_mine", ["0x5"]); // default confirmations (2) reached
    return tx.hash as string;
  };

  // Default configuration: only the required fields, plus a validated route for the 400 step.
  const start = async () => {
    const mw = turnspike({
      rpcUrls: [RPC], chainId: 31337, contract: vault.target, token: token.target, merchant, hmacSecrets: [SECRET],
      dbPath: join(mkdtempSync(join(tmpdir(), "ts1compat-")), "s.sqlite"),
      prices: { "/a": 1000, "/b": 1000, "/q": { priceBase: 1000, validate: (req: any) => (/^[0-9]+$/.test(String(req.query.n ?? "")) ? null : "n_must_be_digits") } },
    });
    let n = 0;
    const app = express();
    app.use("/paid", mw);
    app.get("/paid/a", (_q, r) => r.json({ resource: "a", n: ++n }));
    app.get("/paid/b", (_q, r) => r.json({ resource: "b", n: ++n }));
    app.get("/paid/q", (q, r) => r.json({ n: q.query.n }));
    const server = await new Promise<any>((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    return { mw, base, stop: () => { server.closeAllConnections?.(); server.close(); try { mw.close(); } catch { /* db closed */ } } };
  };

  const out: { step: string; status: number; headers: Record<string, string>; body: unknown }[] = [];
  const get = async (step: string, url: string, proof?: object) => {
    const r = await fetch(url, { headers: proof ? { "x-payment": b64(proof) } : {} });
    const text = await r.text();
    let body: unknown = text; try { body = JSON.parse(text); } catch { /* not JSON */ }
    out.push({ step, status: r.status, headers: Object.fromEntries(r.headers.entries()), body });
    return body as any;
  };

  const A = await start();
  const c = await get("01 unpaid GET /paid/a -> challenge", `${A.base}/paid/a`);
  await get("02 invalid input GET /paid/q?n=abc", `${A.base}/paid/q?n=abc`);
  const txHash = await pay(c.requestId);
  const proof = { requestId: c.requestId, txHash, sig: c.sig };
  await get("03 pay + proof GET /paid/a", `${A.base}/paid/a`, proof);
  await get("04 replay of the same proof", `${A.base}/paid/a`, proof);
  await get("05 proof for /a presented on /b (wrong resource)", `${A.base}/paid/b`, proof);
  await get("06 proof with a wrong sig", `${A.base}/paid/a`, { ...proof, sig: "0".repeat(64) });
  await get("07 proof with an unknown requestId", `${A.base}/paid/a`, { requestId: "0x" + "ee".repeat(32), txHash, sig: c.sig });
  await get("08 malformed X-PAYMENT header", `${A.base}/paid/a`, { nope: 1 });

  const B = await start();
  const cb = await get("09 storage failure: challenge", `${B.base}/paid/a`);
  const txb = await pay(cb.requestId);
  B.mw.store.db.close();
  await get("10 storage failure: proof with the database closed", `${B.base}/paid/a`, { requestId: cb.requestId, txHash: txb, sig: cb.sig });
  B.stop();

  const ce = await get("11 expired: challenge", `${A.base}/paid/a`);
  await provider.send("evm_increaseTime", [86_400]); await provider.send("hardhat_mine", ["0x1"]);
  const txe = await pay(ce.requestId); // mined a day after expiresAt + default grace
  await get("12 expired: payment mined after the deadline", `${A.base}/paid/a`, { requestId: ce.requestId, txHash: txe, sig: ce.sig });
  A.stop();
  provider.destroy();
  process.stdout.write("@@RESULT@@" + JSON.stringify(out) + "\n");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
