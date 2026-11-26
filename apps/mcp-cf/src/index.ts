import { createMcpHandler, createServer } from "../../../packages/mcp/src/server";
import { QIE_MAINNET } from "../../../packages/client/src/protocol";
import type { ReadConfig } from "../../../packages/mcp/src/read";

/** The read-only Turnspike MCP server. It holds no key and no secret, and it is never given a payer, so it cannot pay. */
interface Env { GATEWAY: string; MERCHANT: string; RPC_URLS?: string; CHAIN_ID?: string; CONTRACT?: string; TOKEN?: string; LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> } }

const config = (env: Env): ReadConfig => ({
  network: { ...QIE_MAINNET, rpcUrls: env.RPC_URLS?.split(",") ?? QIE_MAINNET.rpcUrls, chainId: Number(env.CHAIN_ID ?? QIE_MAINNET.chainId), contract: env.CONTRACT ?? QIE_MAINNET.contract, token: env.TOKEN ?? QIE_MAINNET.token },
  payees: [{ origin: env.GATEWAY, merchant: env.MERCHANT }], maxPrice: "0.01", fetch: (i, o) => fetch(i, o),
});
const json = (status: number, v: unknown) => Response.json(v, { status, headers: { "cache-control": "no-store" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/healthz") return json(200, { ok: true, payments: false });
    if (path !== "/mcp") return json(404, { error: "not found", mcp: "/mcp" });
    if (env.LIMIT && !(await env.LIMIT.limit({ key: req.headers.get("cf-connecting-ip") ?? "unknown" })).success) return json(429, { error: "too many requests" });
    if (req.method === "POST") {
      const text = await req.text();
      if (text.length > 8192) return json(413, { error: "too large" });
      try { if (Array.isArray(JSON.parse(text))) return json(400, { error: "batches are not accepted" }); } catch { return json(400, { error: "not JSON" }); }
      req = new Request(req.url, { method: "POST", headers: req.headers, body: text });
    }
    return createMcpHandler(() => createServer(config(env)), { maxRequestBodySize: 8192, onerror: (e) => console.error(e.message) }).fetch(req);
  },
};
