import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { CORS, env, injectWallet } from "./support";

const ROUTES = ["/", "/product", "/playground", "/operations", "/developers", "/security", "/evidence", "/about", "/app"];
const WIDTHS = [390, 768, 1440];

/** Scroll through once so reveal-on-scroll content is in its final state. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); });
  await page.waitForTimeout(700);
}
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const scheme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`WEB-01 every route at ${width}px ${scheme}: no page overflow, one h1, no WCAG A/AA axe violation, no script error`, async ({ browser }) => {
      test.setTimeout(240_000);
      const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      for (const r of ROUTES) {
        const res = await page.goto(r);
        expect.soft(res?.status(), r).toBe(200);
        await settle(page);
        expect.soft(await overflow(page), `${r} overflow`).toBeLessThanOrEqual(0);
        expect.soft(await page.locator("h1").count(), `${r} h1`).toBe(1);
        expect.soft(await axe(page), `${r} axe`).toEqual([]);
        await page.screenshot({ path: `results/screens/${scheme}-${width}${r === "/" ? "-home" : r.replaceAll("/", "-")}.png`, fullPage: true });
      }
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
}

test("WEB-02 long hashes and addresses wrap at 390px in Operations results and the signing review", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 390, height: 760 } });
  const page = await ctx.newPage();
  await page.goto("/operations");
  await page.getByLabel("Transaction hash", { exact: true }).fill(env.paidTx);
  await page.getByRole("button", { name: "Inspect payment" }).click();
  await expect(page.getByText("Paid event found", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check delivery state" }).click();
  await expect(page.locator('[data-tone="success"]')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expect(page.getByText(env.paidTx, { exact: true }).first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: "results/screens/operations-result-390.png", fullPage: true });

  await injectWallet(page, { connected: true, acct: 2 });
  await page.goto("/app");
  await page.getByRole("button", { name: "Allow merchant" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(env.merchant);
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(await dialog.evaluate((d) => d.scrollWidth - d.clientWidth)).toBeLessThanOrEqual(0);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: "results/screens/review-dialog-390.png" });
  await ctx.close();
});

test("WEB-03 connected console is accessible and does not overflow at each width", async ({ browser }) => {
  for (const width of WIDTHS) {
    for (const colorScheme of ["light", "dark"] as const) {
      const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width, height: 900 }, colorScheme });
      const page = await ctx.newPage();
      await injectWallet(page, { connected: true, acct: 5 });
      await page.goto("/app");
      await expect(page.getByRole("heading", { name: "Posted limits" })).toBeVisible();
      await expect(page.getByRole("list", { name: "On-chain history" })).toBeVisible();
      expect.soft(await overflow(page), `${width}`).toBeLessThanOrEqual(0);
      expect.soft(await axe(page), `${width} ${colorScheme}`).toEqual([]);
      await page.screenshot({ path: `results/screens/console-connected-${colorScheme}-${width}.png`, fullPage: true });
      await ctx.close();
    }
  }
});

test("WEB-04 mobile menu: opens, locks scroll, closes with Escape, and reaches Operations", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 390, height: 760 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator("#mobile-nav")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Operations" }).click();
  await expect(page).toHaveURL(/\/operations$/);
  await expect(page.locator("#mobile-nav")).toHaveCount(0);
  await ctx.close();
});

test("WEB-05 every internal link and in-page anchor resolves", async ({ page, request }) => {
  test.setTimeout(120_000);
  const seen = new Set<string>();
  for (const r of ROUTES) {
    await page.goto(r);
    for (const href of await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
      if (href.startsWith("/") || href.startsWith("#")) seen.add(href.startsWith("#") ? r + href : href);
    }
  }
  const bad: string[] = [];
  for (const link of seen) {
    const [path, anchor] = link.split("#");
    const res = await request.get(path || "/");
    if (res.status() !== 200) bad.push(`${link} ${res.status()}`);
    else if (anchor && !(await res.text()).includes(`id="${anchor}"`)) bad.push(`${link} missing anchor`);
  }
  expect(bad).toEqual([]);
});

test("WEB-06 keyboard: the first Tab reaches a skip link or navigation and focus is visible", async ({ page }) => {
  await page.goto("/operations");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const ok = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const s = getComputedStyle(e); return e !== document.body && (s.outlineStyle !== "none" || s.boxShadow !== "none"); });
    expect(ok, `tab stop ${i + 1}`).toBe(true);
  }
});

test("WEB-07 gateway offline: home, playground and evidence say so and invent nothing", async ({ page }) => {
  await page.route(`${env.gw}/**`, (r) => r.abort("connectionfailed"));
  await page.goto("/");
  await expect(page.getByText("The gate did not answer")).toBeVisible();
  await page.goto("/playground");
  await expect(page.getByText("No results are simulated.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run the paid call" })).toBeDisabled();
  await page.goto("/evidence");
  await expect(page.getByText("Usage counters are unavailable right now")).toBeVisible();
});

test("WEB-08 playground: an unpaid request shows a real 402; a rate limit is not reported as an outage", async ({ page }) => {
  await page.goto("/playground");
  await page.getByRole("button", { name: "Request without paying" }).click();
  await expect(page.getByText("payment_required", { exact: false }).first()).toBeVisible();
  await page.route(`${env.gw}/v1/block-summary`, (r) => r.fulfill({ status: 429, headers: CORS, json: { error: "rate_limited" } }));
  await page.getByRole("button", { name: "Request without paying" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "rate limiting" })).toBeVisible();
  await expect(page.getByText("Reachable", { exact: true })).toBeVisible();
});

test("WEB-09 playground: a run whose answer is lost is an unknown outcome, never 'Refused'", async ({ page }) => {
  await page.route(`${env.gw}/v1/config`, async (r) => { const real = await (await r.fetch()).json(); await r.fulfill({ headers: CORS, json: { ...real, demoEnabled: true } }); });
  await page.route(`${env.gw}/demo/**`, (r) => r.request().url().includes("/run/") ? r.abort("connectionreset")
    : r.fulfill({ headers: CORS, json: r.request().url().endsWith("/challenge") ? { token: "salt.sig", bits: 1, expires: 9e9 } : { enabled: true, runsLast24h: 0, txBudgetRemaining: 5, txBudget: 5, perIpHour: 1, perIpDay: 1, powBits: 1, agentGasOk: true } }));
  await page.goto("/playground");
  await page.getByRole("button", { name: "Run the paid call" }).click();
  await expect(page.getByText("Outcome unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Refused", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Delivered", { exact: true })).toHaveCount(0);
});

test("WEB-09b playground: an unreadable 200 from a run is an unknown outcome too", async ({ page }) => {
  await page.route(`${env.gw}/v1/config`, async (r) => { const real = await (await r.fetch()).json(); await r.fulfill({ headers: CORS, json: { ...real, demoEnabled: true } }); });
  await page.route(`${env.gw}/demo/**`, (r) => r.request().url().includes("/run/") ? r.fulfill({ status: 200, headers: CORS, body: '{"steps":[{"st' })
    : r.fulfill({ headers: CORS, json: r.request().url().endsWith("/challenge") ? { token: "salt.sig", bits: 1, expires: 9e9 } : { enabled: true, runsLast24h: 0, txBudgetRemaining: 5, txBudget: 5, perIpHour: 1, perIpDay: 1, powBits: 1, agentGasOk: true } }));
  await page.goto("/playground");
  await page.getByRole("button", { name: "Run the paid call" }).click();
  await expect(page.getByText("Outcome unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Refused", { exact: true })).toHaveCount(0);
});

test("WEB-10 slow network: the page is usable while the gateway is slow", async ({ page }) => {
  await page.route(`${env.gw}/**`, async (r) => { await new Promise((x) => setTimeout(x, 3000)); await r.continue().catch(() => {}); });
  await page.goto("/operations");
  await expect(page.getByText("Checking", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Transaction hash", { exact: true }).fill(env.paidTx);
  await page.getByRole("button", { name: "Inspect payment" }).click();
  await expect(page.getByText("Paid event found", { exact: true })).toBeVisible();
});

test("WEB-11 nothing sensitive is stored or logged, and framing is refused", async ({ page, request }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("/playground");
  await page.getByRole("button", { name: "Request without paying" }).click();
  await expect(page.getByText("payment_required", { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).toBe("{}");
  expect(logs.join("\n")).not.toMatch(/"?sig"?\s*[:=]|0x[0-9a-f]{64}/i);
  expect((await request.get("/app")).headers()["x-frame-options"]).toBe("DENY");
});
