// Runs scenarios against a live gateway the way the website does: fetch a puzzle, solve it, run. Spends real (small) amounts.
// Usage: node scripts/live-demo-check.mjs https://turnpike-qie.fly.dev allowed replay over-cap unauthorized-merchant
import { createHash } from "node:crypto";

const [base, ...scenarios] = process.argv.slice(2);
if (!base || scenarios.length === 0) { console.error("usage: node scripts/live-demo-check.mjs <gateway-url> <scenario...>"); process.exit(1); }

const solve = (token, bits) => {
  const salt = token.split(".")[0];
  for (let n = 0; ; n++) {
    const d = createHash("sha256").update(`${salt}:${n}`).digest();
    let z = 0;
    for (const b of d) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
    if (z >= bits) return String(n);
  }
};

const out = [];
for (const s of scenarios) {
  const ch = await (await fetch(`${base}/demo/challenge`)).json();
  const t0 = Date.now();
  const r = await fetch(`${base}/demo/run/${s}`, { method: "POST", headers: { "x-demo-pow": `${ch.token}.${solve(ch.token, ch.bits)}` } });
  const body = await r.json();
  out.push({ scenario: s, httpStatus: r.status, seconds: Math.round((Date.now() - t0) / 100) / 10, steps: body.steps?.map((x) => ({ step: x.step, ok: x.ok, txHash: x.txHash, name: x.detail?.name })), data: body.data, error: body.error, scope: body.scope });
}
console.log(JSON.stringify({ gateway: base, at: new Date().toISOString(), runs: out, status: await (await fetch(`${base}/demo/status`)).json() }, null, 2));
