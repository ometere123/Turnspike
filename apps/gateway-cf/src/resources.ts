import { topicAddress, TRANSFER_TOPIC, withFailover, type ChainConfig, type Log, type Rpc } from "./chain";

type Ctx = ChainConfig & { token: string };
export interface Resource { resourceId: string; priceBase: string; run: (c: Ctx, signal: AbortSignal) => Promise<unknown> }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_BLOCKS = 50_000, DEFAULT_BLOCKS = 20_000, CHUNK = 5_000;
const SOURCE = "QIE RPC (live)";
const dec = (h: string) => BigInt(h).toString();

/** Priced routes. The resource ids are the same as the Express gateway's, so a proof means the same thing on both. */
export function resolve(url: URL): Resource | { invalid: string } | null {
  const path = url.pathname;
  if (path === "/v1/block-summary") return { resourceId: "block-summary", priceBase: "1000", run: blockSummary };
  const a = /^\/v1\/address\/([^/]+)$/.exec(path);
  if (a) {
    if (!ADDRESS.test(a[1]!)) return { invalid: "invalid_address" };
    return { resourceId: withQuery(`/address/${a[1]}`, url), priceBase: "1000", run: (c, s) => addressReport(c, s, a[1]!) };
  }
  const q = /^\/v1\/qusdc-activity\/([^/]+)$/.exec(path);
  if (q) {
    if (!ADDRESS.test(q[1]!)) return { invalid: "invalid_address" };
    const b = url.searchParams.get("blocks");
    if (b !== null && !(/^[0-9]+$/.test(b) && Number(b) >= 100 && Number(b) <= MAX_BLOCKS)) return { invalid: "blocks_out_of_range" };
    return { resourceId: withQuery(`/qusdc-activity/${q[1]}`, url), priceBase: "2000", run: (c, s) => activity(c, s, q[1]!, Number(b ?? DEFAULT_BLOCKS)) };
  }
  return null;
}

function withQuery(id: string, url: URL): string {
  const pairs = [...url.searchParams.entries()].sort(([a, x], [c, y]) => (a === c ? (x < y ? -1 : 1) : a < c ? -1 : 1));
  return pairs.length ? `${id}?${new URLSearchParams(pairs).toString()}` : id;
}

const blockSummary = (c: Ctx, signal: AbortSignal) => withFailover(c, async (rpc) => {
  const b = await rpc.block("latest");
  if (!b) throw new Error("no block");
  return { blockNumber: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)), txCount: b.transactions.length, chainId: c.chainId, source: SOURCE };
}, signal);

const addressReport = (c: Ctx, signal: AbortSignal, a: string) => withFailover(c, async (rpc: Rpc) => {
  const [qie, nonce, code, qusdc, head] = await Promise.all([
    rpc.call<string>("eth_getBalance", [a, "latest"]), rpc.call<string>("eth_getTransactionCount", [a, "latest"]), rpc.call<string>("eth_getCode", [a, "latest"]),
    rpc.call<string>("eth_call", [{ to: c.token, data: "0x70a08231" + topicAddress(a).slice(2) }, "latest"]), rpc.head(),
  ]);
  return { address: a, qieWei: dec(qie), qusdcBaseUnits: dec(qusdc), nonce: Number(BigInt(nonce)), isContract: code !== "0x", atBlock: head, chainId: c.chainId, source: SOURCE };
}, signal);

/** Largest counterparties by volume, compared as bigint; ties keep address order. */
function rank(peers: Map<string, { in: bigint; out: bigint; count: number }>) {
  return [...peers.entries()].sort(([a, x], [b, y]) => {
    const d = y.in + y.out - (x.in + x.out);
    return d > 0n ? 1 : d < 0n ? -1 : a < b ? -1 : a > b ? 1 : 0;
  }).slice(0, 10).map(([address, p]) => ({ address, inBase: p.in.toString(), outBase: p.out.toString(), transfers: p.count }));
}

const activity = (c: Ctx, signal: AbortSignal, a: string, blocks: number) => withFailover(c, async (rpc) => {
  const head = await rpc.head();
  const from = Math.max(0, head - blocks + 1);
  const pad = topicAddress(a);
  const read = async (topics: (string | null)[]) => {
    const out: Log[] = [];
    for (let f = from; f <= head; f += CHUNK) out.push(...(await rpc.logs({ address: c.token, topics, from: f, to: Math.min(head, f + CHUNK - 1) })));
    return out;
  };
  const [incoming, outgoing] = await Promise.all([read([TRANSFER_TOPIC, null, pad]), read([TRANSFER_TOPIC, pad, null])]);
  const peers = new Map<string, { in: bigint; out: bigint; count: number }>();
  const bump = (who: string, k: "in" | "out", v: bigint) => { const p = peers.get(who) ?? { in: 0n, out: 0n, count: 0 }; p[k] += v; p.count++; peers.set(who, p); };
  for (const l of incoming) bump("0x" + l.topics[1]!.slice(26), "in", BigInt(l.data));
  for (const l of outgoing) bump("0x" + l.topics[2]!.slice(26), "out", BigInt(l.data));
  const total = (ls: Log[]) => ls.reduce((s, l) => s + BigInt(l.data), 0n);
  const inT = total(incoming), outT = total(outgoing);
  const seen = [...incoming, ...outgoing].map((l) => Number(BigInt(l.blockNumber)));
  return {
    address: a, token: c.token, decimals: 6, fromBlock: from, toBlock: head, chainId: c.chainId,
    incoming: { count: incoming.length, totalBase: inT.toString() }, outgoing: { count: outgoing.length, totalBase: outT.toString() }, netBase: (inT - outT).toString(),
    firstActivityBlock: seen.length ? Math.min(...seen) : null, lastActivityBlock: seen.length ? Math.max(...seen) : null,
    topCounterparties: rank(peers), source: "QIE RPC Transfer logs (live)",
  };
}, signal);
