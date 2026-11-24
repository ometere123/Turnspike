// Converts a copy of the Express gateway's SQLite file into rows for /admin/import. Reads only; prints JSON to stdout.
//   node apps/gateway-cf/scripts/export-sqlite.mjs backup.sqlite > rows.json      (batches of at most 500 rows are accepted)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"));
const file = process.argv[2];
if (!file) { console.error("usage: export-sqlite.mjs <backup.sqlite>"); process.exit(2); }
const db = new (require("better-sqlite3"))(file, { readonly: true, fileMustExist: true });
const check = db.pragma("integrity_check", { simple: true });
if (check !== "ok") { console.error(`integrity check failed: ${check}`); process.exit(1); }
const rows = db.prepare("SELECT * FROM payments ORDER BY requestId").all().map((r) => ({
  requestId: r.requestId, nonce: r.nonce, resourceId: r.resourceId, merchant: r.merchant, priceBase: r.priceBase, chainId: r.chainId, contract: r.contract, expiresAt: r.expiresAt,
  state: r.state, txHash: r.txHash, blockNumber: r.blockNumber, payer: r.payer, agent: r.agent ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt,
  response: r.state === "DELIVERED" ? { status: r.responseStatus ?? 200, type: r.responseType ?? "application/json", headers: r.responseHeaders ? JSON.parse(r.responseHeaders) : {}, bodyBase64: Buffer.from(r.responseBody ?? "", r.responseEncoding ?? "utf8").toString("base64") } : null,
}));
const states = rows.reduce((m, r) => ({ ...m, [r.state]: (m[r.state] ?? 0) + 1 }), {});
console.error(`${rows.length} rows ${JSON.stringify(states)}`);
process.stdout.write(JSON.stringify({ rows }));
