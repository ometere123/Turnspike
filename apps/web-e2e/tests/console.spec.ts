import { expect, test, type Page } from "@playwright/test";
import { CORS, env, injectWallet, rpc, wallet } from "./support";

let accounts: string[] = [];
test.beforeAll(async () => { accounts = await rpc("eth_accounts"); });

const open = async (page: Page, init = {}) => {
  await injectWallet(page, { connected: true, ...init });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Posted limits" })).toBeVisible();
};
const gate = (p: Page) => p.getByRole("region", { name: "Posted limits" });
const dialog = (p: Page) => p.getByRole("dialog");
const session = (p: Page) => p.getByRole("list", { name: "This session" });
const sent = (p: Page) => p.evaluate(() => (window as any).__wallet.sent);
/** Review, sign and wait for this session's receipt row. */
async function sign(page: Page, title: string) {
  await expect(dialog(page)).toContainText(title);
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(session(page).getByRole("listitem").first()).toContainText(title);
  await expect(session(page).getByRole("listitem").first()).toContainText("Confirmed");
}

test("AP-01 no wallet: explained, and trying to connect says what to install", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByText("No injected wallet detected")).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(page.getByText("No injected wallet found", { exact: false }).first()).toBeVisible();
});

test("AP-02 connecting is explicit, and rejecting the connection changes nothing", async ({ page }) => {
  await injectWallet(page, { reject: ["eth_requestAccounts"] });
  await page.goto("/app");
  expect(await page.evaluate(() => (window as any).__wallet.calls)).not.toContain("eth_requestAccounts");
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(page.getByText("Connection request was rejected in your wallet.")).toBeVisible();
  await wallet(page, "st.reject = [];");
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(page.getByRole("heading", { name: "Your gate" })).toBeVisible();
  expect(await sent(page)).toEqual([]);
});

test("AP-03 owner lifecycle: approve exactly, deposit, policy, merchant, pause, withdraw, revoke, history", async ({ page }) => {
  await open(page);
  await expect(gate(page)).toContainText("No agent");

  await page.getByLabel("Amount (QUSDC)").fill("2");
  await page.getByRole("button", { name: "Step 1: approve QUSDC" }).click();
  await expect(dialog(page)).toContainText("QIE Mainnet, chain 1990");
  await expect(dialog(page)).toContainText(accounts[0], { ignoreCase: true });
  await expect(dialog(page)).toContainText(env.token);
  await expect(dialog(page)).toContainText(env.vault);
  await sign(page, "Approve QUSDC");
  await page.getByRole("button", { name: "Deposit 2 QUSDC" }).click();
  await expect(dialog(page)).toContainText(env.vault);
  await sign(page, "Deposit");
  await expect(gate(page)).toContainText("Deposit cap 5 QUSDC");
  await expect(gate(page).locator("dd").first()).toContainText("2 QUSDC");

  const txs = await sent(page);
  expect(txs[0].to.toLowerCase()).toBe(env.token.toLowerCase());
  // approve(vault, exactly 2 QUSDC)
  expect(txs[0].data).toBe("0x095ea7b3" + env.vault.slice(2).toLowerCase().padStart(64, "0") + (2_000_000).toString(16).padStart(64, "0"));
  expect(txs[1].to.toLowerCase()).toBe(env.vault.toLowerCase());

  await page.getByLabel("Authorised agent address").fill(accounts[1]);
  await page.getByLabel("Per-call limit (QUSDC)").fill("0.01");
  await page.getByLabel("Daily limit (QUSDC)").fill("0.05");
  await page.getByRole("button", { name: "Save policy" }).click();
  await sign(page, "Set policy");
  await expect(gate(page)).toContainText("Active");

  await page.getByRole("button", { name: "Allow merchant" }).click();
  await expect(dialog(page)).toContainText(env.merchant);
  await sign(page, "Allow merchant");
  expect((await sent(page)).at(-1).data.toLowerCase()).toContain(env.merchant.slice(2).toLowerCase()); // the address shown is the address sent
  await expect(page.locator("#merchants").getByText("Allowed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Pause account" }).click();
  await sign(page, "Pause");
  await expect(gate(page)).toContainText("Paused");
  await page.getByLabel("Amount (QUSDC)").fill("0.5");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await sign(page, "Withdraw");
  await expect(gate(page).locator("dd").first()).toContainText("1.5 QUSDC");
  await page.getByRole("button", { name: "Unpause account" }).click();
  await sign(page, "Unpause");
  await page.getByRole("button", { name: "Revoke agent" }).click();
  await sign(page, "Revoke agent");
  await expect(gate(page)).toContainText("No agent");

  await page.reload();
  const history = page.getByRole("list", { name: "On-chain history" });
  await expect(history).toContainText("Agent revoked");
  await expect(history).toContainText("Deposited 2 QUSDC");
  await expect(history).toContainText("Withdrew 0.5 QUSDC");
});

test("AP-04 limits are checked before any signature: deposit cap, wallet balance, malformed numbers and addresses", async ({ page }) => {
  await open(page, { acct: 2 });
  const amount = page.getByLabel("Amount (QUSDC)");
  for (const [v, text] of [["5.000001", "Over the per-account deposit cap of 5 QUSDC."], ["1000", "More than your wallet QUSDC balance."], ["1.0000001", "Enter a number with up to 6 decimals."], ["-1", "Enter a number with up to 6 decimals."]]) {
    await amount.fill(v);
    await expect(page.getByText(text)).toBeVisible();
    await page.locator("#fund form button[type=submit]").click();
  }
  const merchant = page.getByLabel("Merchant address");
  // Un-prefixed and ICAP forms are silently converted by ethers; a wrong checksum is a likely typo. None may be sent.
  const badChecksum = env.merchant.replace(/[a-z](?=[^a-z]*$)/, (c) => c.toUpperCase());
  for (const v of [env.merchant.slice(2), "XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS", "0x123", badChecksum]) {
    await merchant.fill(v);
    await page.getByRole("button", { name: "Allow merchant" }).click();
    await expect(page.locator("#m-err")).toBeVisible();
  }
  // A review always starts with a gas estimate in the wallet, so no estimate means no submit got through.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__wallet.calls)).not.toContain("eth_estimateGas");
  await expect(dialog(page)).toHaveCount(0);
  // The same check would notice a submit that does get through.
  await amount.fill("1");
  await page.locator("#fund form button[type=submit]").click();
  await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__wallet.calls)).toContain("eth_estimateGas");
  expect(await sent(page)).toEqual([]);
});

test("AP-05 wallet rejection at signing sends nothing and says so; Escape closes the review", async ({ page }) => {
  await open(page, { reject: ["eth_sendTransaction"] });
  await page.getByRole("button", { name: "Pause account" }).click();
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByText("You rejected the request in your wallet. Nothing was sent.")).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Pause account" }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause account" })).toBeFocused();
  expect(await sent(page)).toEqual([]);
});

test("AP-06 wrong network: warned, blocked, and a rejected or accepted switch is handled", async ({ page }) => {
  await open(page, { chain: "0x1", reject: ["wallet_switchEthereumChain"] });
  await expect(page.getByText("Your wallet is on the wrong network.")).toBeVisible();
  await page.getByRole("button", { name: "Pause account" }).click();
  await expect(page.getByText("Wrong network. Switch to QIE Mainnet (1990) first.")).toBeVisible();
  await page.getByRole("button", { name: "Switch network" }).click();
  await expect(page.getByText("Network switch was rejected in your wallet.")).toBeVisible();
  await wallet(page, "st.reject = [];");
  await page.getByRole("button", { name: "Switch network" }).click();
  await expect(page.getByText("Your wallet is on the wrong network.")).toHaveCount(0);
  expect(await sent(page)).toEqual([]);
});

test("AP-07 a network or account change during the review cancels it; nothing is sent", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Pause account" }).click();
  await expect(dialog(page)).toBeVisible();
  await wallet(page, "st.chain = '0x1'; emit('chainChanged', '0x1');");
  await expect(dialog(page)).toHaveCount(0);
  await wallet(page, "st.chain = '0x7c6'; emit('chainChanged', '0x7c6');");
  // The same, but the wallet changes account without telling the page.
  await page.getByRole("button", { name: "Pause account" }).click();
  await expect(dialog(page)).toBeVisible();
  await wallet(page, "st.acct = 1;");
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByText("account or network changed after this review")).toBeVisible();
  expect(await sent(page)).toEqual([]);
});

test("AP-08 switching accounts clears the previous owner's form values, balances and session receipts", async ({ page }) => {
  await open(page, { acct: 1 });
  await page.getByRole("button", { name: "Pause account" }).click();
  await sign(page, "Pause");
  await expect(gate(page)).toContainText("Paused");
  await page.getByLabel("Authorised agent address").fill(accounts[7]);
  await page.getByLabel("Amount (QUSDC)").fill("3");
  await wallet(page, `st.acct = 2; emit('accountsChanged', ['${accounts[2]}']);`);
  await expect(gate(page)).toBeVisible();
  await expect(gate(page)).not.toContainText("Paused");
  await expect(page.getByLabel("Authorised agent address")).toHaveValue("");
  await expect(page.getByLabel("Amount (QUSDC)")).toHaveValue("");
  await expect(session(page)).toHaveCount(0);
});

test("AP-09 the wallet loses its connection right after sending: the review closes and the chain, not the wallet, confirms it", async ({ page }) => {
  await open(page, { acct: 2, drop: true });
  await page.getByRole("button", { name: "Pause account" }).click();
  await sign(page, "Pause");
  expect(await sent(page)).toHaveLength(1);
  await expect(gate(page)).toContainText("Paused", { timeout: 25_000 });
});

test("AP-09b confirmation lost: the outcome is unknown with no Retry, and checking again settles it without sending", async ({ page }) => {
  await open(page, { acct: 4 });
  let cut = false;
  await page.route(`${env.rpc}/**`, async (r) => {
    const b = r.request().postData() ?? "";
    if (cut && /eth_getTransactionReceipt/.test(b)) return r.fulfill({ headers: CORS, contentType: "application/json", body: JSON.stringify([].concat(JSON.parse(b)).map((x: any) => ({ jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "upstream lost" } })).concat()) });
    return r.continue();
  });
  cut = true;
  await page.getByRole("button", { name: "Pause account" }).click();
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  const row = session(page).getByRole("listitem").first();
  await expect(row).toContainText("Outcome unknown", { timeout: 40_000 });
  await expect(row).toContainText("It may still confirm");
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await row.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("The outcome is still unknown.", { exact: false })).toBeVisible();
  cut = false;
  await row.getByRole("button", { name: "Check again" }).click();
  await expect(row).toContainText("Confirmed");
  expect(await sent(page)).toHaveLength(1);
});

const noMining = async <T>(f: () => Promise<T>): Promise<T> => {
  await rpc("evm_setAutomine", [false]);
  await rpc("evm_setIntervalMining", [0]);
  try { return await f(); } finally { await rpc("evm_setAutomine", [true]); await rpc("evm_setIntervalMining", [10_000]); await rpc("hardhat_mine", ["0x1"]); }
};

test("AP-14 a pending transaction never blocks the next review: pause and revoke stay reachable", async ({ page }) => {
  await open(page, { acct: 7 });
  await noMining(async () => {
    await page.getByRole("button", { name: "Pause account" }).click();
    await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
    await expect(session(page).getByRole("listitem").first()).toContainText("Pending");
    await page.getByRole("button", { name: "Allow merchant" }).click();
    await expect(dialog(page)).toContainText("Pause is still pending. Signing this sends another transaction.");
    await expect(dialog(page).getByRole("button", { name: "Confirm in wallet" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Allow merchant" }).click();
    await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
    await expect(session(page).getByRole("listitem")).toHaveCount(2);
  });
  await expect(session(page).getByText("Confirmed")).toHaveCount(2);
});

test("AP-15 a transaction dropped after it was seen becomes an unknown outcome within a bounded time, not Pending for ever", async ({ page }) => {
  await page.clock.install();
  await open(page, { acct: 7 });
  await noMining(async () => {
    await page.getByRole("button", { name: /^(Pause|Unpause) account$/ }).click();
    await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
    const row = session(page).getByRole("listitem").first();
    await expect(row).toContainText("Pending");
    await page.waitForTimeout(1000);
    const pending = await rpc("eth_getBlockByNumber", ["pending", false]);
    for (const h of pending.transactions) await rpc("hardhat_dropTransaction", [h]);
    await page.clock.fastForward(200_000);
    await expect(row).toContainText("Outcome unknown", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Check again" })).toBeVisible();
  });
});

test("AP-16 a silent network change, and a switch while the final check is running, send nothing", async ({ page }) => {
  await open(page, { acct: 7 });
  const button = page.getByRole("button", { name: /^(Pause|Unpause) account$/ });
  await button.click();
  await expect(dialog(page)).toBeVisible();
  await wallet(page, "st.chain = '0x1';");
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByText("account or network changed after this review")).toBeVisible();
  await wallet(page, "st.chain = '0x7c6';");
  await button.click();
  await expect(dialog(page)).toBeVisible();
  await wallet(page, "st.slow = 1500;");
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  await wallet(page, `st.acct = 8; emit('accountsChanged', ['${accounts[8]}']);`);
  await expect(dialog(page)).toHaveCount(0);
  await page.waitForTimeout(4000);
  expect(await sent(page)).toEqual([]);
});

test("AP-17 the request given to the wallet carries the chain and the reviewed call", async ({ page }) => {
  await open(page, { acct: 7 });
  await page.getByRole("button", { name: /^(Pause|Unpause) account$/ }).click();
  await dialog(page).getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(session(page).getByRole("listitem").first()).toContainText("Confirmed");
  const [tx] = await sent(page);
  expect(Number(tx.chainId)).toBe(1990);
  expect(tx.to.toLowerCase()).toBe(env.vault.toLowerCase());
  expect(tx.from.toLowerCase()).toBe(accounts[7].toLowerCase());
  expect(tx.data).toMatch(/^0x16c38b3c0{63}[01]$/); // setPaused(bool), and nothing else
  expect(Number(tx.gas ?? tx.gasLimit)).toBeGreaterThan(21_000);
});

test("AP-10 a contract refusal is explained before the review opens", async ({ page }) => {
  await open(page, { acct: 2 });
  await page.getByLabel("Authorised agent address").fill("0x0000000000000000000000000000000000000000");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("This would fail:", { exact: false })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("AP-11 no QIE for gas is refused before the review", async ({ page }) => {
  const balance = await rpc("eth_getBalance", [accounts[2], "latest"]);
  await rpc("hardhat_setBalance", [accounts[2], "0x0"]);
  try {
    await open(page, { acct: 2 });
    await page.getByRole("button", { name: /^(Pause|Unpause) account$/ }).click();
    await expect(page.getByText(/Not enough QIE/).first()).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  } finally { await rpc("hardhat_setBalance", [accounts[2], balance]); }
});

test("AP-12 RPC unavailable and wrong-chain RPC: no numbers are invented, and it recovers", async ({ page }) => {
  await injectWallet(page, { connected: true });
  let mode = "down";
  await page.route(`${env.rpc}/**`, async (r) => {
    const body = r.request().postData() ?? "";
    if (mode === "down" && !/eth_accounts/.test(body)) return r.abort("connectionfailed");
    if (mode === "wrong" && /eth_chainId/.test(body)) {
      const parsed = JSON.parse(body);
      const one = (x: any) => ({ jsonrpc: "2.0", id: x.id, result: "0x1" });
      return r.fulfill({ headers: CORS, json: Array.isArray(parsed) ? parsed.map(one) : one(parsed) });
    }
    return r.continue();
  });
  await page.goto("/app");
  const notice = page.getByText("Could not read from the QIE RPC.");
  await expect(notice).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("heading", { name: "Posted limits" })).toHaveCount(0);
  mode = "wrong";
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("heading", { name: "Posted limits" })).toHaveCount(0);
  mode = "up";
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Posted limits" })).toBeVisible({ timeout: 30_000 });
  await expect(notice).toHaveCount(0);
});

test.describe("AP-13 QIE ID hint never replaces or authorises the address", () => {
  const api = "https://sdk-live.qie.digital/**";
  const hint = (p: Page) => p.locator("#merchants");
  const one = (name: string) => ({ status: "SUCCESS", data: { address: env.merchant, totalDomains: 1, domains: [{ domainName: name }] } });
  const cases: [string, (url: string) => { status?: number; json?: any; abort?: boolean }, string][] = [
    ["no name", () => ({ json: { status: "SUCCESS", data: { address: env.merchant, totalDomains: 0, domains: [] } } }), "No QIE ID name is associated"],
    ["ambiguous", () => ({ json: { status: "SUCCESS", data: { address: env.merchant, totalDomains: 2, domains: [{ domainName: "a.qie" }, { domainName: "b.qie" }] } } }), "Multiple QIE ID names"],
    ["rate limited", () => ({ status: 429, json: {} }), "public request limit"],
    ["cross-record mismatch", (u) => (u.includes("/lookup/") ? { json: { status: "SUCCESS", data: { owner: env.token, domainName: "a.qie" } } } : { json: one("a.qie") }), "do not agree"],
    ["unreachable", () => ({ abort: true }), "could not be reached"],
  ];
  for (const [name, reply, text] of cases) {
    test(name, async ({ page }) => {
      await page.route(api, (r) => { const x = reply(r.request().url()); return x.abort ? r.abort("connectionfailed") : r.fulfill({ status: x.status ?? 200, headers: CORS, json: x.json }); });
      await open(page, { acct: 2 });
      await page.getByRole("button", { name: "Look up name" }).click();
      await expect(hint(page)).toContainText(text);
      await expect(hint(page)).toContainText("The address remains the payment and allowlist authority.");
      await expect(page.getByLabel("Merchant address")).toHaveValue(env.merchant);
    });
  }
  test("a match is a label only, and disappears when the address is edited", async ({ page }) => {
    await page.route(api, (r) => r.fulfill({ headers: CORS, json: r.request().url().includes("/lookup/") ? { status: "SUCCESS", data: { owner: env.merchant, domainName: "shop.qie" } } : one("shop.qie") }));
    await open(page, { acct: 2 });
    await page.getByRole("button", { name: "Look up name" }).click();
    await expect(hint(page)).toContainText("shop.qie");
    await expect(hint(page)).toContainText("not a verified business identity");
    await page.getByRole("button", { name: "Allow merchant" }).click();
    await expect(dialog(page)).toContainText(env.merchant);
    await expect(dialog(page)).not.toContainText("shop.qie");
    await page.keyboard.press("Escape");
    await page.getByLabel("Merchant address").fill(accounts[8]);
    await expect(hint(page)).not.toContainText("shop.qie");
  });
});
