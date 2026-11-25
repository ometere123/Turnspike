// Narrow imports, so the hosted bundle carries no wallet or payment code.
import { Interface } from "ethers/abi";
import { getAddress } from "ethers/address";
import { ALLOWANCE_ABI, challengeSchema, formatUnits, parseUnits, type Network } from "@turnspike-qie/client/dist/protocol";

/** Read-only operations. Nothing in this file can sign, and it is all the hosted (Cloudflare) version contains. */
export interface Payee { origin: string; merchant: string; maxPrice?: string }
export interface ReadConfig { network: Network; owner?: string; payees: Payee[]; maxPrice: string; fetch?: typeof fetch }

const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
const MAX_BODY = 64 * 1024;
const lc = (s: string) => s.toLowerCase();

/** One JSON-RPC call. Each endpoint must prove its chain id; the next one is tried when one fails. */
export async function rpc(cfg: ReadConfig, calls: { method: string; params: unknown[] }[]): Promise<any[]> {
  let last = "no RPC configured";
  for (const url of cfg.network.rpcUrls) {
    try {
      const one = async (method: string, params: unknown[]) => {
        const r = await (cfg.fetch ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
        const b: any = await r.json();
        if (b.error || !("result" in b)) throw new Error(String(b.error?.message ?? "bad RPC answer").slice(0, 200));
        return b.result;
      };
      if (Number(await one("eth_chainId", [])) !== cfg.network.chainId) throw new Error("the RPC is on another chain");
      return await Promise.all(calls.map((c) => one(c.method, c.params)));
    } catch (e: any) { last = String(e?.message ?? e).slice(0, 200); }
  }
  throw new Error(`QIE could not be read: ${last}`);
}

export async function readAccount(cfg: ReadConfig, who?: string) {
  const owner = who ?? cfg.owner;
  if (!owner) throw new Error("no owner given and none configured");
  const o = getAddress(owner), n = cfg.network;
  const call = (fn: string) => ({ method: "eth_call", params: [{ to: n.contract, data: iface.encodeFunctionData(fn, [o]) }, "latest"] });
  const [a, s] = await rpc(cfg, [call("account"), call("spentToday")]);
  const acct = iface.decodeFunctionResult("account", a)[0], spent = iface.decodeFunctionResult("spentToday", s)[0] as bigint;
  const f = (v: bigint) => formatUnits(v, n.decimals);
  const left = (acct.dailyCap as bigint) > spent ? (acct.dailyCap as bigint) - spent : 0n;
  return { owner: o, currency: "QUSDC", balance: f(acct.balance), paused: acct.paused as boolean, agent: acct.agent as string, perCallCap: f(acct.perCallCap), dailyCap: f(acct.dailyCap), spentToday: f(spent), leftToday: f(left) };
}

export async function verifyTx(cfg: ReadConfig, hash: string) {
  const n = cfg.network;
  const [r, head] = await rpc(cfg, [{ method: "eth_getTransactionReceipt", params: [hash] }, { method: "eth_blockNumber", params: [] }]);
  if (!r) return { found: false as const, txHash: hash };
  const paid = (r.logs as any[]).filter((l) => lc(l.address) === lc(n.contract)).map((l) => { try { return iface.parseLog({ topics: l.topics, data: l.data }); } catch { return null; } }).find((x) => x?.name === "Paid");
  const ok = Number(r.status) === 1;
  return {
    found: true as const, txHash: hash, status: ok ? "success" : "reverted", block: Number(r.blockNumber), confirmations: Number(head) - Number(r.blockNumber) + 1,
    isTurnspikePayment: !!paid && ok,
    payment: paid && ok ? { owner: paid.args.owner as string, agent: paid.args.agent as string, merchant: paid.args.merchant as string, requestId: paid.args.requestId as string, amount: formatUnits(paid.args.amount, n.decimals), currency: "QUSDC" } : null,
    explorer: `${n.explorer}/tx/${hash}`, note: "Shows that QUSDC was paid. It does not show that the API delivered.",
  };
}

const loopback = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

/** The URL, only if the owner listed its origin. Checked before any request, so a model cannot aim this process at other hosts. */
export function allowedUrl(cfg: ReadConfig, raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("not a valid URL"); }
  if (u.username || u.password) throw new Error("URLs with credentials are refused");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback(u.hostname))) throw new Error("only https URLs are allowed (http only for this computer)");
  if (!cfg.payees.some((p) => new URL(p.origin).origin === u.origin)) throw new Error(`refused: ${u.origin} is not on the owner's payee list. Only the owner can add it, in the config file`);
  u.hash = "";
  return u;
}

/** fetch with no redirects (they could leave the allowed origin), a timeout and a size limit. */
export function guardedFetch(cfg: ReadConfig): typeof fetch {
  return (async (input: any, init: RequestInit = {}) => {
    const u = allowedUrl(cfg, String(input));
    // "manual", because workerd has no "error" mode. A redirect is then refused here.
    const r = await (cfg.fetch ?? fetch)(u, { ...init, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) throw new Error("the API answered with a redirect, which is refused");
    const chunks: Uint8Array[] = [];
    let size = 0, cut = false;
    const reader = r.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = MAX_BODY - size;
      chunks.push(value.subarray(0, room)); size += Math.min(value.length, room);
      if (value.length > room) { cut = true; await reader.cancel().catch(() => undefined); break; }
    }
    const headers = new Headers(r.headers);
    for (const h of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(h);
    headers.delete("x-turnspike-mcp-cut");
    if (cut) headers.set("x-turnspike-mcp-cut", "1");
    const body = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { body.set(c, at); at += c.length; }
    return new Response([204, 205, 304].includes(r.status) ? null : body, { status: r.status, headers });
  }) as typeof fetch;
}

export async function probe(cfg: ReadConfig, raw: string) {
  const u = allowedUrl(cfg, raw), n = cfg.network;
  const r = await guardedFetch(cfg)(u.href);
  if (r.status !== 402) return { url: u.href, httpStatus: r.status, paidEndpoint: false as const };
  const c = challengeSchema.safeParse(await r.json().catch(() => null));
  if (!c.success) return { url: u.href, httpStatus: 402, paidEndpoint: false as const, problem: "the 402 answer is not a Turnspike challenge" };
  const ch = c.data, payee = cfg.payees.find((p) => new URL(p.origin).origin === u.origin && lc(p.merchant) === lc(ch.merchant));
  const price = BigInt(ch.priceBase), ceilings = [cfg.maxPrice, payee?.maxPrice].filter((x): x is string => !!x).map((x) => parseUnits(x, n.decimals));
  const checks = {
    networkMatches: ch.chainId === n.chainId && lc(ch.contract) === lc(n.contract) && lc(ch.token) === lc(n.token),
    merchantTrusted: !!payee, withinMaxPrice: ceilings.every((m) => price <= m),
  };
  return { url: u.href, httpStatus: 402, paidEndpoint: true as const, price: formatUnits(price, n.decimals), currency: "QUSDC", merchant: getAddress(ch.merchant), expiresAt: new Date(ch.expiresAt * 1000).toISOString(), checks, allowedByConfig: Object.values(checks).every(Boolean), note: "Nothing was paid." };
}
