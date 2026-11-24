import { expect, test, type Page } from "@playwright/test";
import { CORS, env, gatewayStatus, patchRpc, rpc } from "./support";

const OTHER = "0x" + "ab".repeat(32);
const chain = (p: Page) => p.getByRole("region", { name: "1. Verify on-chain payment" });
const gw = (p: Page) => p.getByRole("region", { name: "2. Inspect gateway delivery" });
async function inspect(page: Page, hash: string) {
  await page.getByLabel("Transaction hash", { exact: true }).fill(hash);
  await page.getByRole("button", { name: "Inspect payment" }).click();
}
async function lookup(page: Page, id?: string) {
  if (id) await page.getByLabel("Request ID", { exact: true }).fill(id);
  await page.getByRole("button", { name: "Check delivery state" }).click();
}

test.beforeEach(async ({ page }) => { await page.goto("/operations"); });

test("OP-01 a real local payment (402, pay, 200 through the SDK) is verified, then correlated with the gateway's own record", async ({ page }) => {
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found", { exact: true })).toBeVisible();
  await expect(chain(page).getByText("0.001")).toBeVisible();
  await expect(chain(page).getByText(env.merchant)).toBeVisible();
  await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue(env.paidId);
  await lookup(page);
  await expect(gw(page).getByText("DELIVERED", { exact: true })).toBeVisible();
  await expect(gw(page).getByText("This is a gateway claim, not an on-chain delivery proof.", { exact: false })).toBeVisible();
  await expect(gw(page).locator('[data-tone="success"]')).toContainText("agree on the request ID and the transaction");
});

test("OP-02 unknown, unrelated and reverted transactions are never shown as payments", async ({ page }) => {
  await inspect(page, OTHER);
  await expect(chain(page).getByText("Not found", { exact: true })).toBeVisible();
  await inspect(page, env.plainTx);
  await expect(chain(page).getByText("No Turnspike Paid event", { exact: true })).toBeVisible();
  await inspect(page, env.revertTx);
  await expect(chain(page).getByText("Reverted", { exact: true })).toBeVisible();
  await expect(chain(page).locator(".text-success")).toHaveCount(0);
});

test("OP-03 a known but unmined transaction is pending, not missing", async ({ page }) => {
  await patchRpc(page, { eth_getTransactionReceipt: null, eth_getTransactionByHash: { hash: OTHER } });
  await inspect(page, OTHER);
  await expect(chain(page).getByText("Pending", { exact: true })).toBeVisible();
});

test("OP-04 an RPC on another chain is refused", async ({ page }) => {
  await patchRpc(page, { eth_chainId: "0x1" });
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("answered for chain 1, not 1990")).toBeVisible();
  await expect(chain(page).locator(".text-success")).toHaveCount(0);
});

test("OP-05 a receipt from a replaced block, more than one Paid event, and a wrong-hash receipt are uncertain", async ({ page }) => {
  let mode = "reorg";
  await patchRpc(page, {
    eth_getBlockByNumber: (real: any, p: any[]) => (mode === "reorg" && p[0] !== "latest" ? { ...real, hash: OTHER } : real),
    eth_getTransactionReceipt: (real: any) => (mode === "double" ? { ...real, logs: [...real.logs, real.logs.at(-1)] } : mode === "hash" ? { ...real, transactionHash: OTHER } : real),
  });
  for (const [m, text] of [["reorg", "not the canonical block"], ["double", "More than one Turnspike Paid event"], ["hash", "does not match this transaction hash"]]) {
    mode = m;
    await inspect(page, env.paidTx);
    await expect(chain(page).getByText(text)).toBeVisible();
    await expect(chain(page).getByText("Uncertain", { exact: true })).toBeVisible();
    await expect(chain(page).locator(".text-success")).toHaveCount(0);
  }
});

test("OP-06 a Paid event from any other contract does not count", async ({ page }) => {
  await patchRpc(page, { eth_getTransactionReceipt: (real: any) => ({ ...real, logs: real.logs.map((l: any) => ({ ...l, address: env.token })) }) });
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("No Turnspike Paid event", { exact: true })).toBeVisible();
});

test("OP-07 a lagging RPC and a single confirmation are warnings, never green", async ({ page }) => {
  let mode = "stale";
  await patchRpc(page, { eth_getBlockByNumber: async (real: any, p: any[]) => {
    if (p[0] !== "latest") return real;
    if (mode === "stale") return { ...real, timestamp: "0x" + (Math.floor(Date.now() / 1000) - 1200).toString(16) };
    const rc = await rpc("eth_getTransactionReceipt", [env.paidTx]);
    return { ...real, number: mode === "behind" ? "0x" + (BigInt(rc.blockNumber) - 1n).toString(16) : rc.blockNumber };
  } });
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found, RPC is behind")).toBeVisible();
  await expect(chain(page).locator(".text-success")).toHaveCount(0);
  mode = "shallow";
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found, still settling")).toBeVisible();
  await expect(chain(page).locator(".text-success")).toHaveCount(0);
  mode = "behind";
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("behind the transaction's block")).toBeVisible();
});

test("OP-08 a stalled RPC times out with a message, and the page recovers", async ({ page }) => {
  let stall = true;
  await page.route(`${env.rpc}/**`, async (r) => { if (stall) return; await r.continue(); });
  await inspect(page, env.paidTx);
  await expect(page.getByRole("button", { name: "Reading the chain…" })).toBeVisible();
  await expect(chain(page).getByText("did not answer in time")).toBeVisible({ timeout: 20_000 });
  await expect(chain(page).locator(".text-success")).toHaveCount(0);
  stall = false;
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found", { exact: true })).toBeVisible();
});

test("OP-09 editing the hash while a read is in flight discards that read", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(`${env.rpc}/**`, async (r) => {
    if (r.request().postData()?.includes("eth_getTransactionReceipt")) await gate;
    await r.continue().catch(() => {});
  });
  await inspect(page, env.paidTx);
  await page.getByLabel("Transaction hash", { exact: true }).fill(OTHER);
  release();
  await page.waitForTimeout(1500);
  await expect(chain(page).getByText("Paid event found")).toHaveCount(0);
  await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Inspect payment" })).toBeEnabled();
});

test("OP-10 editing either field clears the answer that belonged to the old value", async ({ page }) => {
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found", { exact: true })).toBeVisible();
  await lookup(page);
  await expect(gw(page).getByText("DELIVERED", { exact: true })).toBeVisible();
  await page.getByLabel("Request ID", { exact: true }).fill(OTHER);
  await expect(gw(page).getByText("DELIVERED", { exact: true })).toHaveCount(0);
  await page.getByLabel("Transaction hash", { exact: true }).fill(OTHER);
  await expect(chain(page).getByText("Paid event found")).toHaveCount(0);
});

test("OP-11 a late gateway answer for an edited request ID is dropped", async ({ page }) => {
  await gatewayStatus(page, { json: { state: "DELIVERED", txHash: env.paidTx, expiresAt: 1 }, delayMs: 1200 });
  await lookup(page, env.paidId);
  await page.getByLabel("Request ID", { exact: true }).fill(OTHER);
  await page.waitForTimeout(2000);
  await expect(gw(page).getByText("DELIVERED", { exact: true })).toHaveCount(0);
});

test("OP-12 mismatched hash and mismatched request ID are errors, not notes", async ({ page }) => {
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found", { exact: true })).toBeVisible();
  await gatewayStatus(page, { json: { state: "DELIVERED", txHash: OTHER, expiresAt: 1 } });
  await lookup(page);
  await expect(gw(page).locator('[data-tone="danger"]')).toContainText("recorded a different transaction");
  await page.unroute(`${env.gw}/v1/payments/**`);
  await gatewayStatus(page, { json: { state: "DELIVERED", txHash: env.paidTx, expiresAt: 1 } });
  await lookup(page, OTHER);
  await expect(gw(page).locator('[data-tone="danger"]')).toContainText("different request ID");
  await expect(gw(page).locator('[data-tone="success"]')).toHaveCount(0);
});

const UNKNOWN: [string, Parameters<typeof gatewayStatus>[1], string][] = [
  ["404", { status: 404, json: { error: "unknown_request" } }, "no matching request record"],
  ["429", { status: 429, json: {} }, "rate limiting this connection"],
  ["500", { status: 500, json: {} }, "answered HTTP 500"],
  ["unreachable", { abort: true }, "could not be reached"],
  ["malformed hash", { json: { state: "DELIVERED", txHash: "0x12" } }, "transaction reference was malformed"],
  ["no state", { json: {} }, "unexpected status record"],
];
for (const [name, reply, text] of UNKNOWN) {
  test(`OP-13 gateway ${name}: delivery stays unknown`, async ({ page }) => {
    await gatewayStatus(page, reply);
    await lookup(page, env.paidId);
    await expect(gw(page).getByText("Unknown", { exact: true })).toBeVisible();
    await expect(gw(page).getByText(text)).toBeVisible();
    await expect(gw(page).locator(".text-success")).toHaveCount(0);
  });
}

test("OP-14 an unknown gateway state is neutral and paid-but-undelivered is a warning", async ({ page }) => {
  await gatewayStatus(page, { json: { state: "SOMETHING_NEW", txHash: null } });
  await lookup(page, env.paidId);
  await expect(gw(page).getByText("draws no conclusion")).toBeVisible();
  await expect(gw(page).locator(".text-success")).toHaveCount(0);
  await page.unroute(`${env.gw}/v1/payments/**`);
  await gatewayStatus(page, { json: { state: "PAID_CONFIRMED", txHash: env.paidTx } });
  await inspect(page, env.paidTx);
  await expect(chain(page).getByText("Paid event found", { exact: true })).toBeVisible();
  await lookup(page);
  await expect(gw(page).locator('[data-tone="warn"]')).toContainText("does not report completed delivery");
});

test("OP-15 service status: healthy, unhealthy, unreachable, wrong vault and malformed statistics", async ({ page }) => {
  const status = page.getByRole("region", { name: "Service status" });
  await expect(status.getByText("Responding", { exact: true })).toBeVisible();
  await expect(status.getByText("QIE, chain 1990")).toBeVisible();
  const refresh = () => page.getByRole("button", { name: "Refresh status" }).click();

  await page.route(`${env.gw}/v1/config`, (r) => r.fulfill({ headers: CORS, json: { chainId: 1990, contract: env.token, token: env.token } }));
  await page.route(`${env.gw}/v1/stats`, (r) => r.fulfill({ headers: CORS, json: { delivered: "many" } }));
  await refresh();
  await expect(status.getByText("Configuration mismatch")).toBeVisible();
  await expect(status.getByText("Unknown", { exact: true })).toBeVisible();

  await page.route(`${env.gw}/healthz`, (r) => r.fulfill({ status: 503, headers: CORS, json: { error: "starting" } }));
  await refresh();
  await expect(status.getByText("Responding, not healthy")).toBeVisible();

  await page.unrouteAll();
  await page.route(`${env.gw}/**`, (r) => r.abort("connectionfailed"));
  await refresh();
  await expect(status.getByText("Unreachable", { exact: true })).toBeVisible();
  await expect(status.locator(".text-success")).toHaveCount(0);
  await page.unrouteAll();
  await refresh();
  await expect(status.getByText("Responding", { exact: true })).toBeVisible();
});

test("OP-16 invalid input is explained, focused and sends nothing", async ({ page }) => {
  let reads = 0;
  await page.route(`${env.rpc}/**`, (r) => { reads++; return r.continue(); });
  await inspect(page, "0x1234");
  await expect(page.getByRole("alert").filter({ hasText: "complete transaction hash" })).toBeVisible();
  await expect(page.getByLabel("Transaction hash", { exact: true })).toBeFocused();
  expect(reads).toBe(0);
});

test("OP-17 keyboard only: fill, submit and reach the copy control", async ({ page }) => {
  await page.getByLabel("Transaction hash", { exact: true }).focus();
  await page.keyboard.type(env.paidTx);
  await page.keyboard.press("Enter");
  await expect(chain(page).getByText("Paid event found", { exact: true })).toBeVisible();
  const copy = chain(page).getByRole("button", { name: /^Copy request ID/ });
  await copy.focus();
  await expect(copy).toBeFocused();
});
