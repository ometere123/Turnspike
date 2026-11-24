// Runs the built Worker in workerd (the Cloudflare runtime) through Miniflare, with its Durable Object on disk.
// A separate process, so that a test can kill it without warning and start it again on the same data.
import { Miniflare } from "miniflare";
const o = JSON.parse(process.argv[2]);
const mf = new Miniflare({
  port: o.port, host: "127.0.0.1", modules: true, scriptPath: o.script, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
  bindings: o.bindings, durableObjects: { LEDGER: { className: "Ledger", useSQLite: true } }, durableObjectsPersist: o.persist, unsafeTriggerHandlers: true,
});
await mf.ready;
process.stdout.write("ready\n");
