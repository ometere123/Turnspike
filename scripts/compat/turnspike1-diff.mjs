// turnspike/1 behavioural diff: origin/main vs the current checkout, default middleware configuration, local Hardhat only.
//   node scripts/compat/turnspike1-diff.mjs [--write]
// Checks origin/main out into a temporary git worktree (removed afterwards), runs turnspike1-runner.ts against each
// middleware on its own fresh Hardhat node (so contract addresses match), normalises volatile values (requestIds, sigs,
// tx hashes, times, correlation ids) and prints the differences in status codes, bodies and headers.
// --write also saves the report to docs/x402/TURNSPIKE1_COMPAT.md. Needs: root npm ci, npx hardhat compile, npm ci in packages/x402.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const BASE_REF = process.env.COMPAT_BASE_REF ?? "origin/main";
const PORT = Number(process.env.HARDHAT_PORT ?? 8693);
const RPC = `http://127.0.0.1:${PORT}`;
const win = process.platform === "win32";
const tsx = join(root, "packages/x402/node_modules/tsx/dist/cli.mjs");
const git = (...a) => { const r = spawnSync("git", a, { cwd: root, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };

async function withNode(fn) {
  const node = spawn("npx", ["hardhat", "node", "--port", String(PORT)], { cwd: root, shell: true, stdio: "ignore", detached: !win });
  const stop = () => { try { if (win) spawnSync("taskkill", ["/pid", String(node.pid), "/T", "/F"], { shell: true, stdio: "ignore" }); else process.kill(-node.pid, "SIGKILL"); } catch { /* gone */ } };
  try {
    for (let i = 0; ; i++) {
      try { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }); if ((await r.json()).result === "0x7a69") break; } catch { /* not up */ }
      if (i > 120) throw new Error("hardhat node did not start"); await new Promise((r) => setTimeout(r, 500));
    }
    return await fn();
  } finally { stop(); await new Promise((r) => setTimeout(r, 1000)); }
}

function run(label, entry) {
  const r = spawnSync(process.execPath, [tsx, join(here, "turnspike1-runner.ts")], { cwd: root, encoding: "utf8", env: { ...process.env, RPC_URL: RPC, MW_ENTRY: entry, TURNSPIKE_LOG: "off" }, maxBuffer: 1 << 26 });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("@@RESULT@@"));
  if (r.status !== 0 || !line) throw new Error(`${label} runner failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(line.slice("@@RESULT@@".length));
}

const VOLATILE_HEADERS = new Set(["date", "etag", "x-correlation-id", "keep-alive", "connection"]);
function norm(v, key = "") {
  if (Array.isArray(v)) return v.map((x) => norm(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k], k)]));
  if (typeof v === "number" && /^(expiresAt|paymentDeadline|issuedAt|timestamp|retryAfter|at)$/i.test(key)) return "<time>";
  if (typeof v === "string") {
    if (/^(correlationId|nonce)$/i.test(key)) return `<${key}>`;
    return v.replace(/0x[0-9a-fA-F]{64}/g, "<hash32>").replace(/\b[0-9a-f]{64}\b/g, "<hex64>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
  }
  return v;
}
const normHeaders = (h) => Object.fromEntries(Object.keys(h).filter((k) => !VOLATILE_HEADERS.has(k)).sort().map((k) => [k, norm(h[k])]));

const wt = mkdtempSync(join(tmpdir(), "ts1-main-"));
rmSync(wt, { recursive: true, force: true });
let report;
try {
  const baseSha = git("rev-parse", BASE_REF), headSha = git("rev-parse", "HEAD");
  git("worktree", "add", "--detach", wt, baseSha);
  // the checked-out sources resolve their libraries (ethers, zod, better-sqlite3, express) from this checkout's node_modules
  symlinkSync(join(root, "node_modules"), join(wt, "node_modules"), win ? "junction" : "dir");
  const baseRes = await withNode(() => run(BASE_REF, join(wt, "packages/middleware/src/index.ts")));
  const headRes = await withNode(() => run("HEAD", join(root, "packages/middleware/src/index.ts")));
  const dirty = git("status", "--porcelain", "--", "packages/middleware/src") !== "";

  const lines = [], diffs = [];
  for (let i = 0; i < Math.max(baseRes.length, headRes.length); i++) {
    const a = baseRes[i], b = headRes[i];
    const step = (a ?? b).step;
    const d = [];
    if (a?.status !== b?.status) d.push(`status: ${a?.status} -> ${b?.status}`);
    const ab = JSON.stringify(norm(a?.body)), bb = JSON.stringify(norm(b?.body));
    if (ab !== bb) d.push(`body: ${ab} -> ${bb}`);
    const ah = normHeaders(a?.headers ?? {}), bh = normHeaders(b?.headers ?? {});
    for (const k of [...new Set([...Object.keys(ah), ...Object.keys(bh)])].sort()) {
      if (ah[k] !== bh[k]) d.push(`header ${k}: ${ah[k] === undefined ? "(absent)" : JSON.stringify(ah[k])} -> ${bh[k] === undefined ? "(absent)" : JSON.stringify(bh[k])}`);
    }
    lines.push(`| ${step} | ${a?.status} | ${b?.status} | ${d.length ? "differs" : "identical"} |`);
    if (d.length) diffs.push(`### ${step}\n\n${d.map((x) => `- ${x.replace(/\|/g, "\|")}`).join("\n")}`);
  }
  report = [
    `Base: \`${BASE_REF}\` ${baseSha.slice(0, 7)}. Head: ${headSha.slice(0, 7)}${dirty ? " plus uncommitted changes in packages/middleware/src" : ""}. Default middleware configuration, local Hardhat (31337).`,
    `Normalised before comparing: 32-byte hex values (requestId, tx hash), 64-hex sigs, UUIDs, nonce/correlationId fields, time fields; headers ${[...VOLATILE_HEADERS].join(", ")} are ignored.`,
    "",
    "| Step | Base status | Head status | Result |", "|---|---|---|---|", ...lines, "",
    diffs.length ? `## Differences (${diffs.length} step(s))\n\n${diffs.join("\n\n")}` : "## Differences\n\nNone.",
  ].join("\n");
} finally {
  try { rmSync(join(wt, "node_modules"), { force: true, recursive: false }); } catch { /* junction */ }
  spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
  spawnSync("git", ["worktree", "prune"], { cwd: root });
}
console.log(report);
if (process.argv.includes("--write")) {
  const out = join(root, "docs/x402/TURNSPIKE1_COMPAT.md");
  const head = existsSync(out) ? "" : "";
  writeFileSync(out, head + "# turnspike/1 behavioural diff (generated)\n\nGenerated by `node scripts/compat/turnspike1-diff.mjs --write`.\n\n" + report + "\n");
  console.log(`\nwritten ${out}`);
}
