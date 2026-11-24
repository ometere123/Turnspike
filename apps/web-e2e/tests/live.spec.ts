import { expect, test } from "@playwright/test";

// Read-only checks of a deployed site against QIE Mainnet and the public gateway. Sends no transaction, connects no wallet and
// never runs a demo scenario. LIVE_URL selects the site; LIVE_LABEL names the screenshots.
const REFERENCE_TX = "0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7";
const REFERENCE_ID = "0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa";
const label = process.env.LIVE_LABEL ?? "live";

test.beforeEach(async ({ page }) => {
  // A protected preview redirects this link to a page that sets its access cookie.
  if (process.env.LIVE_SHARE_URL) await page.goto(process.env.LIVE_SHARE_URL);
});

test("LIVE-01 every public route renders without a script error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const r of ["/", "/product", "/playground", "/operations", "/developers", "/security", "/evidence", "/about", "/app"]) {
    const res = await page.goto(r);
    expect(res?.status(), r).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test("LIVE-02 the historical payment of 19 November 2026 is read from mainnet and matches the gateway's record", async ({ page }) => {
  await page.goto("/operations");
  await page.getByRole("button", { name: "Load recorded example" }).click();
  await expect(page.getByLabel("Transaction hash", { exact: true })).toHaveValue(REFERENCE_TX);
  await page.getByRole("button", { name: "Inspect payment" }).click();
  await expect(page.getByText("Paid event found", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue(REFERENCE_ID);
  await expect(page.getByText("12,015,683", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Check delivery state" }).click();
  await expect(page.getByText("DELIVERED", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-tone="success"]')).toBeVisible();
  await page.screenshot({ path: `results/screens/${label}-operations-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `results/screens/${label}-operations-390.png`, fullPage: true });
});

test("LIVE-03 the home page shows a real unpaid 402 quote from the public gateway", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Quote valid for")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `results/screens/${label}-home-1440.png` });
});

test("LIVE-04 an unknown transaction stays not found on mainnet", async ({ page }) => {
  await page.goto("/operations");
  await page.getByLabel("Transaction hash", { exact: true }).fill("0x" + "0".repeat(63) + "1");
  await page.getByRole("button", { name: "Inspect payment" }).click();
  await expect(page.getByText("Not found", { exact: true })).toBeVisible({ timeout: 30_000 });
});

test("LIVE-05 the first QIE RPC is down: the payment is still verified, through the second", async ({ page }) => {
  await page.route("https://rpc1mainnet.qie.digital/**", (r) => r.abort("connectionfailed"));
  await page.goto("/operations");
  await page.getByRole("button", { name: "Load recorded example" }).click();
  await page.getByRole("button", { name: "Inspect payment" }).click();
  await expect(page.getByText("Paid event found", { exact: true })).toBeVisible({ timeout: 40_000 });
});

test("LIVE-06 the console reads balances when the first QIE RPC is down (a read-only stub wallet, no signature)", async ({ page }) => {
  await page.route("https://rpc1mainnet.qie.digital/**", (r) => r.abort("connectionfailed"));
  await page.addInitScript(() => { (window as any).ethereum = { on() {}, removeListener() {}, request: async ({ method }: any) => method === "eth_chainId" ? "0x7c6" : method === "eth_accounts" ? ["0x77918289D518303DDE4f84098B507bdB1dc73E4C"] : Promise.reject(new Error("read only")) }; });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Posted limits" })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("Could not read from the QIE RPC.")).toHaveCount(0);
});

test("LIVE-07 the demo owner's full history loads from QIE Mainnet (a read-only stub wallet, no signature)", async ({ page }) => {
  await page.addInitScript(() => { (window as any).ethereum = { on() {}, removeListener() {}, request: async ({ method }: any) => method === "eth_chainId" ? "0x7c6" : method === "eth_accounts" ? ["0x77918289D518303DDE4f84098B507bdB1dc73E4C"] : Promise.reject(new Error("read only")) }; });
  await page.goto("/app");
  await expect(page.getByRole("list", { name: "On-chain history" })).toContainText("Agent paid", { timeout: 80_000 });
});
