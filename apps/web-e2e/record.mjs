// Records the demo as genuine browser video (no wallet extension, no payment, no signature). Two parts, joined with ffmpeg:
//   LIVE_URL=https://… [LIVE_SHARE_URL=…] node apps/web-e2e/record.mjs live   # deployed site, QIE Mainnet reads only
//   node apps/web-e2e/run.mjs record                                          # local chain: owner console with a mock wallet
// Captions and the source tag in the corner are drawn over the page and say where each scene runs. The 402 signature is never shown.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "results/video");
mkdirSync(out, { recursive: true });
const part = process.argv[2];
const size = { width: 1600, height: 900 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: out, size }, colorScheme: "light", baseURL: part === "live" ? process.env.LIVE_URL : process.env.E2E_BASE_URL });
if (part === "live" && process.env.LIVE_SHARE_URL) { const p = await ctx.newPage(); await p.goto(process.env.LIVE_SHARE_URL); await p.close(); }
const page = await ctx.newPage();
const wait = (s) => page.waitForTimeout(s * 1000);
async function say(tag, text) {
  await page.evaluate(([tag, text]) => {
    document.getElementById("__cap")?.remove();
    const d = document.createElement("div");
    d.id = "__cap"; d.setAttribute("aria-hidden", "true");
    d.style.cssText = "position:fixed;inset:auto 0 0 0;z-index:9999;pointer-events:none;font-family:inherit";
    const t = document.createElement("div"), c = document.createElement("div");
    t.textContent = tag; c.textContent = text;
    t.style.cssText = "display:inline-block;background:#F2B705;color:#1B1F24;font-weight:700;font-size:17px;padding:6px 16px";
    c.style.cssText = "background:#1B1F24;color:#E6EAE3;font-size:25px;line-height:1.35;padding:16px 40px 20px;font-weight:500";
    d.append(t, c);
    document.body.append(d);
  }, [tag, text]);
}
async function glide(sel, offset = 120) {
  await page.evaluate(([sel, offset]) => { const e = document.querySelector(sel); if (e) scrollTo({ top: e.getBoundingClientRect().top + scrollY - offset, behavior: "smooth" }); }, [sel, offset]);
  await wait(1.2);
}

if (part === "live") {
  const LIVE = "LIVE SITE, QIE MAINNET, READ ONLY";
  const go = async (path, tag, text) => { await page.goto(path); await say(tag, text); };
  await go("/", LIVE, "An AI agent that can pay for APIs needs a budget it cannot break. Turnspike puts a toll gate in front of an API.");
  await page.getByText("Quote valid for").waitFor({ timeout: 30_000 });
  await wait(6);
  await say(LIVE, "This unpaid request just got a real HTTP 402 from the public gateway: a price, a countdown and one request ID.");
  await wait(7);
  await go("/operations", LIVE, "Operations: check a payment without a wallet. Settlement and delivery are read as two separate facts.");
  await wait(5);
  await page.getByRole("button", { name: "Load recorded example" }).click();
  await say("HISTORICAL PAYMENT, 19 NOV 2026, PROJECT OPERATED", "This hash is a purchase the project itself made on 19 November 2026. Nothing is being paid now.");
  await glide("#chain-h");
  await wait(4);
  await page.getByRole("button", { name: "Inspect payment" }).click();
  await page.getByText("Paid event found", { exact: true }).waitFor({ timeout: 30_000 });
  await say("HISTORICAL PAYMENT, 19 NOV 2026, PROJECT OPERATED", "The browser reads the receipt from QIE: chain ID, canonical block, and exactly one Paid event from the deployed vault.");
  await wait(8);
  await page.getByRole("button", { name: "Check delivery state" }).click();
  await page.locator("[data-tone]").waitFor({ timeout: 20_000 });
  await say("HISTORICAL PAYMENT, 19 NOV 2026, PROJECT OPERATED", "The gateway's record matches on both identifiers. It says DELIVERED: that is the gateway's claim, not proof on chain.");
  await wait(8);
  await go("/evidence", "HISTORICAL MAINNET TRANSACTIONS, PROJECT OPERATED", "Refusals are real reverted transactions: over the cap, a reused request ID. No external users yet, and the page says so.");
  await wait(3); await glide("h2:nth-of-type(1)", 0); await page.mouse.wheel(0, 900); await wait(6);
  await go("/security", LIVE, "Unaudited. The deployed bytecode is a coverage-instrumented build. Late or undelivered payments are not refunded automatically.");
  await wait(3); await glide("#limitations"); await wait(6);
} else if (part === "local") {
  const LOCAL = "LOCAL CHAIN, TEST TOKEN, MOCK WALLET: NOT MAINNET";
  const rpcUrl = process.env.E2E_RPC;
  await page.addInitScript(({ rpcUrl }) => {
    const rpc = async (method, params = []) => (await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
    window.ethereum = { on() {}, removeListener() {}, request: async ({ method, params }) => method === "eth_requestAccounts" || method === "eth_accounts" ? [(await rpc("eth_accounts"))[1]] : method === "eth_chainId" ? "0x7c6" : rpc(method, params) };
  }, { rpcUrl });
  const confirm = async () => { await wait(4); await page.getByRole("button", { name: "Confirm in wallet" }).click(); await page.getByRole("list", { name: "This session" }).getByText("Confirmed").first().waitFor(); await wait(1.5); };
  await page.goto("/app");
  await page.getByRole("heading", { name: "Posted limits" }).waitFor();
  await say(LOCAL, "The owner console, shown on a local chain with a test token. The owner posts the rules; the contract enforces them.");
  await wait(5);
  await page.getByLabel("Amount (QUSDC)").fill("2");
  await page.getByRole("button", { name: "Step 1: approve QUSDC" }).click();
  await say(LOCAL, "Every write has a review: the network, your account, the exact contract and the exact amount. Then the wallet signs.");
  await confirm();
  await page.getByRole("button", { name: "Deposit 2 QUSDC" }).click();
  await confirm();
  await page.getByLabel("Authorised agent address").fill("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  await page.getByLabel("Per-call limit (QUSDC)").fill("0.01");
  await page.getByLabel("Daily limit (QUSDC)").fill("0.05");
  await page.getByRole("button", { name: "Save policy" }).click();
  await say(LOCAL, "One agent key, a per-call cap and a daily cap. The agent cannot change them.");
  await confirm();
  await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
  await say(LOCAL, "The limits are posted on chain. The owner can pause, revoke or withdraw at any time.");
  await wait(5);
  await page.getByRole("button", { name: "Pause account" }).click();
  await confirm();
  await page.evaluate(() => scrollTo({ top: 0, behavior: "smooth" }));
  await wait(3);
  // The real output of the two-sided example, replayed as text.
  const text = readFileSync(process.env.RECORD_TERMINAL, "utf8").split("\n").filter((l) => /^\d\.|END-TO-END/.test(l));
  await page.setContent('<body style="margin:0;background:#14171B;color:#E6EAE3;font:20px/1.7 ui-monospace,Consolas,monospace;padding:48px"><div style="color:#F2B705">$ node examples/end-to-end/run.mjs</div><pre id="t" style="white-space:pre-wrap;font:inherit"></pre></body>');
  await say("LOCAL HARDHAT CHAIN, MOCK TOKEN: RECORDED OUTPUT", "Seller middleware and agent SDK together: 402, pay, 200, then a replay with one charge, and two refusals.");
  for (const l of text) { await page.evaluate((l) => { document.getElementById("t").textContent += l + "\n"; }, l); await wait(2.2); }
  await wait(5);
} else throw new Error("say live or local");
const video = page.video();
await ctx.close();
renameSync(await video.path(), join(out, `${part}.webm`));
await browser.close();
console.log(join(out, `${part}.webm`));
