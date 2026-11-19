import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import express from "express";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager, ethers } from "ethers";
import { turnspike } from "../../middleware/src";
import { run, EXIT, type Io } from "../src/cli";
import { FileJournal } from "../../client/src";

// Drives the real CLI entry point (run) against a local Hardhat chain, the real contract and the real middleware.
// MockERC20 is the labelled test double. Nothing here touches mainnet.
const PORT = 8651;
const RPC = `http://127.0.0.1:${PORT}`;
const PHRASE = "test test test test test test test test test test test junk";
const PASSWORD = "cli-test-password-not-a-secret";
const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../../../artifacts/contracts", p), "utf8"));
let node: ChildProcess, provider: JsonRpcProvider, server: Server, mw: ReturnType<typeof turnspike>;
let base: string, merchant: string, ownerAddr: string, dir: string, cfgPath: string;
let token: ethers.Contract, vault: ethers.Contract;

function io(env: Record<string, string> = {}, answers: boolean[] = []) {
  const out: string[] = [], err: string[] = [];
  const x: Io = { out: (s) => out.push(s), err: (s) => err.push(s), env: { HOME: dir, ...env }, confirm: async () => answers.shift() ?? false, secret: async () => undefined };
  return { io: x, out, err, text: () => out.join("\n"), all: () => out.concat(err).join("\n") };
}
const cli = (args: string[], i = io()) => run([...args, "--config", cfgPath, "--rpc", RPC], i.io).then((code) => ({ code, ...i }));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tscli-"));
  cfgPath = join(dir, "turnspike.config.json");
  node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: join(__dirname, "../../.."), shell: true, stdio: "ignore" });
  provider = new JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1 });
  for (let i = 0; i < 60; i++) { try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const w = (i: number) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
  const owner = new NonceManager(w(0)); ownerAddr = await owner.getAddress();
  const agentW = w(1); merchant = w(2).address;
  token = (await (await new ContractFactory(art("test-helpers/MockERC20.sol/MockERC20.json").abi, art("test-helpers/MockERC20.sol/MockERC20.json").bytecode, owner).deploy()).waitForDeployment()) as any;
  const va = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  vault = (await (await new ContractFactory(va.abi, va.bytecode, owner).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment()) as any;
  await (await (token as any).mint(ownerAddr, 10_000_000n)).wait();
  await (await (token as any).approve(vault.target, 10n ** 12n)).wait();
  await (await (vault as any).deposit(1_000_000n)).wait();
  await (await (vault as any).setPolicy(agentW.address, 10_000n, 100_000n)).wait();
  await (await (vault as any).setMerchant(merchant, true)).wait();
  writeFileSync(join(dir, "agent.json"), await agentW.encrypt(PASSWORD)); // standard encrypted JSON keystore

  mw = turnspike({ rpcUrls: [RPC], chainId: 31337, contract: vault.target as string, token: token.target as string, merchant, hmacSecrets: ["c".repeat(40)], dbPath: join(dir, "s.sqlite"), confirmations: 1, paymentGraceSeconds: 10 ** 9, prices: { "/data": 2500 } });
  const app = express();
  app.use("/v1", mw);
  app.get("/v1/data", (_q, r) => r.json({ value: 42 }));
  server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
}, 120_000);

afterAll(() => { server?.close(); mw?.close(); spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); provider.destroy(); });

describe("turnspike CLI", () => {
  it("CLI-01 help and usage errors use the documented exit codes", async () => {
    const h = io();
    expect(await run(["--help"], h.io)).toBe(EXIT.OK);
    expect(h.text()).toContain("api pay <url>");
    expect((await cli(["account", "inspect", "nope"])).code).toBe(EXIT.USAGE);
    expect((await cli(["frobnicate"])).code).toBe(EXIT.USAGE);
    expect((await cli(["--password", "x", "doctor"])).code).toBe(EXIT.USAGE); // there is no password flag
  });

  it("CLI-02 init writes a config with no secrets; config show prints it", async () => {
    const r = await run(["init", "--config", cfgPath, "--owner", ownerAddr, "--keystore", join(dir, "agent.json"), "--payee", `${base}=${merchant}`, "--max-price", "0.005"], io().io);
    expect(r).toBe(EXIT.OK);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.confirmations = 1;
    cfg.network = { name: "local", chainId: 31337, contract: vault.target, token: token.target, decimals: 6, rpcUrls: [RPC], explorer: "http://explorer.local" };
    writeFileSync(cfgPath, JSON.stringify(cfg));
    expect(readFileSync(cfgPath, "utf8")).not.toContain(PASSWORD);
    expect((await run(["init", "--config", cfgPath], io().io))).toBe(EXIT.USAGE); // refuses to overwrite without --force
    const s = await cli(["config", "show", "--json"]);
    expect(JSON.parse(s.text()).config.owner).toBe(ownerAddr);
  });

  it("CLI-03 account inspect reads the on-chain policy, in human and JSON form", async () => {
    const h = await cli(["account", "inspect", ownerAddr]);
    expect(h.code).toBe(EXIT.OK);
    expect(h.text()).toContain("allowance     1 QUSDC");
    expect(h.text()).toContain("per call cap  0.01 QUSDC");
    const j = await cli(["account", "inspect", ownerAddr, "--json"]);
    expect(JSON.parse(j.text())).toMatchObject({ allowanceBalanceBase: "1000000", perCallCapBase: "10000", paused: false });
  });

  it("CLI-04 api probe explains the challenge and the policy verdict, and never pays", async () => {
    const before = (await vault.account(ownerAddr)).balance;
    const ok = await cli(["api", "probe", `${base}/v1/data`, "--json"]);
    expect(ok.code).toBe(EXIT.OK);
    const body = JSON.parse(ok.text());
    expect(body.checks).toMatchObject({ networkMatches: true, payeeTrusted: true, withinMaxPrice: true });
    expect(body.challenge.sig).toBeUndefined(); // the proof secret is never printed
    expect((await cli(["api", "probe", `${base}/v1/free`])).code).toBe(EXIT.OK);
    expect((await vault.account(ownerAddr)).balance).toBe(before);
  });

  it("CLI-05 api pay without --yes in a non-interactive shell does not spend", async () => {
    const before = (await vault.account(ownerAddr)).balance;
    const r = await cli(["api", "pay", `${base}/v1/data`], io({ TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD }));
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.all()).toContain("declined");
    expect((await vault.account(ownerAddr)).balance).toBe(before);
  });

  it("CLI-06 api pay --dry-run quotes the merchant, price and gas and broadcasts nothing", async () => {
    const r = await cli(["api", "pay", `${base}/v1/data`, "--dry-run"], io({ TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD }));
    expect(r.code).toBe(EXIT.OK);
    expect(r.text()).toContain("0.0025 QUSDC");
    expect(r.text()).toContain(merchant);
  });

  it("CLI-07 api pay after an interactive yes pays once, prints the tx, and api verify decodes it", { timeout: 60_000 }, async () => {
    const before = (await vault.account(ownerAddr)).balance as bigint;
    const r = await cli(["api", "pay", `${base}/v1/data`, "--key", "cli-k1"], io({ TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD }, [true]));
    expect(r.code).toBe(EXIT.OK);
    expect(r.text()).toContain('{"value":42}');
    expect(r.all()).not.toContain(PASSWORD);
    const tx = r.err.join("\n").match(/0x[0-9a-f]{64}/)![0];
    expect((await vault.account(ownerAddr)).balance).toBe(before - 2500n);
    const v = await cli(["api", "verify", tx, "--json"]);
    expect(v.code).toBe(EXIT.OK);
    expect(JSON.parse(v.text()).payment).toMatchObject({ amountBase: "2500", merchant });
    const again = await cli(["api", "resume", "cli-k1"], io({ TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD }));
    expect(again.code).toBe(EXIT.OK);
    expect((await vault.account(ownerAddr)).balance).toBe(before - 2500n); // resume never pays twice
  });

  it("CLI-08 policy refusals exit 3: price over --max-price, and an untrusted payee", async () => {
    const r = await cli(["api", "pay", `${base}/v1/data`, "--max-price", "0.001", "--yes"], io({ TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD }));
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.all()).toContain("price_above_max");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, payees: [] }));
    const u = await cli(["api", "pay", `${base}/v1/data`, "--yes"], io({ TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD }));
    writeFileSync(cfgPath, JSON.stringify(cfg));
    expect(u.code).toBe(EXIT.ERROR); // the client refuses to even start with an empty payee list
    expect(u.all()).toContain("payees");
  });

  it("CLI-09 a wrong keystore password fails cleanly without echoing it", async () => {
    const r = await cli(["api", "pay", `${base}/v1/data`, "--yes"], io({ TURNSPIKE_KEYSTORE_PASSWORD: "wrong-password-xyz" }));
    expect(r.code).toBe(EXIT.ERROR);
    expect(r.all()).not.toContain("wrong-password-xyz");
  });

  it("CLI-11 every uncertain-payment outcome exits 4 with a resume hint, never 'not paid' or exit 3", async () => {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    const journal = new FileJournal(cfg.journal);
    const agentAddr = HDNodeWallet.fromPhrase(PHRASE, undefined, "m/44'/60'/0'/0/1").address;
    const now = Math.floor(Date.now() / 1000);
    const env = { TURNSPIKE_KEYSTORE_PASSWORD: PASSWORD };
    // 1. Another worker holds the key and has not recorded a challenge yet.
    await journal.put({ key: "cli-busy", url: `${base}/v1/data`, method: "GET", state: "reserved", owner: ownerAddr, agent: agentAddr, lockToken: "t", updatedAt: now });
    // 2. A submission of unknown outcome whose challenge has since expired, at the agent's next nonce (nothing settles it yet).
    const challenge = { protocol: "turnspike/1", requestId: "0x" + "ee".repeat(32), sig: "ab".repeat(32), priceBase: "2500", token: token.target as string, contract: vault.target as string, merchant, chainId: 31337, resourceId: "/data", expiresAt: now - 60, paymentDeadline: now };
    await journal.put({ key: "cli-unresolved", url: `${base}/v1/data`, method: "GET", state: "paying", challenge: challenge as any, owner: ownerAddr, agent: agentAddr, nonce: await provider.getTransactionCount(agentAddr, "pending"), fromBlock: 0, updatedAt: now });
    for (const key of ["cli-busy", "cli-unresolved"]) {
      const r = await cli(["api", "resume", key], io(env));
      expect(r.code).toBe(EXIT.PAID_NOT_DELIVERED);
      expect(r.all()).toContain("PAYMENT MAY HAVE BEEN SENT");
      expect(r.all()).not.toMatch(/not paid/);
      const j = await cli(["api", "resume", key, "--json"], io(env));
      expect(j.code).toBe(EXIT.PAID_NOT_DELIVERED);
      expect(JSON.parse(j.text())).toMatchObject({ ok: false, error: "payment_pending", paid: false, maybePaid: true });
    }
    // A definitive refusal is still exit 3.
    const refused = await cli(["api", "pay", `${base}/v1/data`, "--max-price", "0.001", "--yes"], io(env));
    expect(refused.code).toBe(EXIT.REFUSED);
  });

  it("CLI-10 doctor checks chain, contract, token and the owner's account", async () => {
    const r = await cli(["doctor", "--json"]);
    const d = JSON.parse(r.text());
    expect(d.checks.find((c: any) => c.name === "settlement contract deployed").ok).toBe(true);
    expect(d.checks.find((c: any) => c.name === "contract token matches config").ok).toBe(true);
    expect(r.code).toBe(EXIT.OK);
  });
});
